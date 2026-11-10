"""Opaque refresh tokens grouped into rotation "families".

Each login (or background-token request) starts a family. Using a token rotates it: the old token
is marked rotated and a new one is issued in the same family.

Presenting an already-rotated token again means one of two things:
  * the client never received the response (phone lost signal, app suspended) and is retrying: the
    replacement token it was meant to get has NEVER been used. That is accepted at any later time, a
    fresh replacement is issued, and (after REUSE_GRACE_S, which protects two near-simultaneous
    requests) the undelivered successor is revoked;
  * someone else holds the old token: the legitimate successor HAS been used. That is theft, so the
    whole family (and its child families) is revoked.
Callers must commit the session even when InvalidRefreshToken is raised, so a revocation persists.
"""

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.db.models import RefreshTokenRow

REUSE_GRACE_S = 60


class InvalidRefreshToken(Exception):
    pass


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _add_token(
    session: Session, user_id: int, family_id: str, parent_family_id: str | None, now: datetime, days: int
) -> str:
    raw = secrets.token_urlsafe(32)
    session.add(
        RefreshTokenRow(
            user_id=user_id,
            family_id=family_id,
            parent_family_id=parent_family_id,
            token_hash=hash_token(raw),
            expires_at=now + timedelta(days=days),
        )
    )
    session.flush()
    return raw


def issue_refresh_token(
    session: Session, user_id: int, *, now: datetime, days: int = 30, parent_family_id: str | None = None
) -> str:
    return _add_token(session, user_id, uuid.uuid4().hex, parent_family_id, now, days)


def _lookup(session: Session, raw: str, *, lock: bool) -> RefreshTokenRow | None:
    stmt = select(RefreshTokenRow).where(RefreshTokenRow.token_hash == hash_token(raw))
    return session.scalar(stmt.with_for_update() if lock else stmt)


def _require_live(row: RefreshTokenRow | None, now: datetime) -> RefreshTokenRow:
    if row is None or row.revoked_at is not None or row.expires_at <= now:
        raise InvalidRefreshToken()
    return row


def _successors(session: Session, row: RefreshTokenRow) -> list[RefreshTokenRow]:
    return list(
        session.scalars(
            select(RefreshTokenRow).where(RefreshTokenRow.family_id == row.family_id, RefreshTokenRow.id > row.id)
        )
    )


def issue_child_token(session: Session, parent_raw: str, *, now: datetime, days: int = 30) -> str:
    """Start an independent family whose life is tied to the parent's (logout of the parent revokes it)."""
    parent = _require_live(_lookup(session, parent_raw, lock=False), now)
    if parent.rotated_at is not None:
        # A rotated token is not the family's current credential; honouring it would bypass reuse detection.
        raise InvalidRefreshToken()
    return issue_refresh_token(session, parent.user_id, now=now, days=days, parent_family_id=parent.family_id)


def revoke_family_tree(session: Session, family_id: str, *, now: datetime) -> None:
    families = {family_id}
    frontier = {family_id}
    while frontier:
        children = set(
            session.scalars(
                select(RefreshTokenRow.family_id).where(RefreshTokenRow.parent_family_id.in_(frontier)).distinct()
            )
        )
        frontier = children - families
        families |= children
    session.execute(
        update(RefreshTokenRow)
        .where(RefreshTokenRow.family_id.in_(families), RefreshTokenRow.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    session.flush()


def rotate_refresh_token(session: Session, raw: str, *, now: datetime, days: int = 30) -> tuple[int, str]:
    row = _lookup(session, raw, lock=True)
    if row is None or row.revoked_at is not None or row.expires_at <= now:
        raise InvalidRefreshToken()
    if row.rotated_at is not None:
        successors = _successors(session, row)
        if any(successor.rotated_at is not None for successor in successors):
            revoke_family_tree(session, row.family_id, now=now)  # the real successor was used: theft
            raise InvalidRefreshToken()
        if now - row.rotated_at > timedelta(seconds=REUSE_GRACE_S):
            for successor in successors:  # the undelivered successor must not stay usable
                if successor.revoked_at is None:
                    successor.revoked_at = now
    else:
        row.rotated_at = now
    new_raw = _add_token(session, row.user_id, row.family_id, row.parent_family_id, now, days)
    return row.user_id, new_raw
