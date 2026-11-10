import hashlib
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.auth.refresh import (
    REUSE_GRACE_S,
    InvalidRefreshToken,
    issue_child_token,
    issue_refresh_token,
    revoke_family_tree,
    rotate_refresh_token,
)
from app.db.models import RefreshTokenRow
from tests.helpers import make_user

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


def family_of(session, raw):
    digest = hashlib.sha256(raw.encode()).hexdigest()
    return session.scalar(select(RefreshTokenRow.family_id).where(RefreshTokenRow.token_hash == digest))


def test_rotation_returns_new_token_for_same_user(session_factory):
    uid = make_user(session_factory)
    with session_factory() as s:
        old = issue_refresh_token(s, uid, now=NOW)
        s.commit()
        user_id, new = rotate_refresh_token(s, old, now=NOW + timedelta(minutes=1))
        s.commit()
    assert user_id == uid and new != old


def test_unknown_and_expired_tokens_are_rejected(session_factory):
    uid = make_user(session_factory)
    with session_factory() as s:
        tok = issue_refresh_token(s, uid, now=NOW, days=1)
        s.commit()
        with pytest.raises(InvalidRefreshToken):
            rotate_refresh_token(s, "nope", now=NOW)
        with pytest.raises(InvalidRefreshToken):
            rotate_refresh_token(s, tok, now=NOW + timedelta(days=2))


def test_old_token_within_grace_is_accepted_not_revoked(session_factory):
    uid = make_user(session_factory)
    with session_factory() as s:
        old = issue_refresh_token(s, uid, now=NOW)
        s.commit()
        rotate_refresh_token(s, old, now=NOW)
        s.commit()
        _, second = rotate_refresh_token(s, old, now=NOW + timedelta(seconds=REUSE_GRACE_S - 1))
        s.commit()
        rotate_refresh_token(s, second, now=NOW + timedelta(seconds=REUSE_GRACE_S))  # family still alive


def test_late_retry_after_a_lost_response_is_accepted(session_factory):
    # The server rotated, the response never arrived, the client retries much later with the old token.
    uid = make_user(session_factory)
    with session_factory() as s:
        old = issue_refresh_token(s, uid, now=NOW)
        s.commit()
        _, lost_successor = rotate_refresh_token(s, old, now=NOW)  # the client never saw this token
        s.commit()
        late = NOW + timedelta(hours=6)
        _, replacement = rotate_refresh_token(s, old, now=late)  # still signed in
        s.commit()
        rotate_refresh_token(s, replacement, now=late)  # the replacement works
        s.commit()
        with pytest.raises(InvalidRefreshToken):  # the never-delivered successor was revoked
            rotate_refresh_token(s, lost_successor, now=late)


def test_old_token_after_its_successor_was_used_revokes_the_whole_family(session_factory):
    uid = make_user(session_factory)
    with session_factory() as s:
        old = issue_refresh_token(s, uid, now=NOW)
        s.commit()
        _, first = rotate_refresh_token(s, old, now=NOW)
        s.commit()
        _, second = rotate_refresh_token(s, first, now=NOW + timedelta(minutes=1))  # the successor was used
        s.commit()
        with pytest.raises(InvalidRefreshToken):  # so presenting the old token again is theft
            rotate_refresh_token(s, old, now=NOW + timedelta(minutes=2))
        s.commit()
        with pytest.raises(InvalidRefreshToken):
            rotate_refresh_token(s, second, now=NOW + timedelta(minutes=2))


def test_a_rotated_token_cannot_mint_a_background_token(session_factory):
    uid = make_user(session_factory)
    with session_factory() as s:
        old = issue_refresh_token(s, uid, now=NOW)
        s.commit()
        rotate_refresh_token(s, old, now=NOW)
        s.commit()
        with pytest.raises(InvalidRefreshToken):
            issue_child_token(s, old, now=NOW + timedelta(days=2))


def test_child_family_is_independent_of_its_parent(session_factory):
    uid = make_user(session_factory)
    with session_factory() as s:
        parent = issue_refresh_token(s, uid, now=NOW)
        child = issue_child_token(s, parent, now=NOW)
        s.commit()
        _, child2 = rotate_refresh_token(s, child, now=NOW)  # child rotates on its own
        s.commit()
        rotate_refresh_token(s, child2, now=NOW)  # ...and its successor is used
        s.commit()
        _, parent2 = rotate_refresh_token(s, parent, now=NOW)  # parent rotates on its own
        s.commit()
        late = NOW + timedelta(seconds=REUSE_GRACE_S + 1)
        with pytest.raises(InvalidRefreshToken):  # reuse of the child's old token: theft detection
            rotate_refresh_token(s, child, now=late)
        s.commit()
        rotate_refresh_token(s, parent2, now=late)  # parent family untouched


def test_logging_out_the_parent_kills_its_children(session_factory):
    uid = make_user(session_factory)
    with session_factory() as s:
        parent = issue_refresh_token(s, uid, now=NOW)
        child = issue_child_token(s, parent, now=NOW)
        s.commit()
        revoke_family_tree(s, family_of(s, parent), now=NOW)
        s.commit()
        with pytest.raises(InvalidRefreshToken):
            rotate_refresh_token(s, child, now=NOW)
        with pytest.raises(InvalidRefreshToken):
            rotate_refresh_token(s, parent, now=NOW)


def test_child_token_requires_a_valid_parent(session_factory):
    with session_factory() as s:
        with pytest.raises(InvalidRefreshToken):
            issue_child_token(s, "not-a-token", now=NOW)
