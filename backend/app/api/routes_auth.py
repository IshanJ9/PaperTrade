from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import current_user_id, get_session
from app.api.schemas import BackgroundTokenOut, LoginIn, MeOut, RefreshIn, RegisterIn, TokenOut
from app.auth.refresh import (
    InvalidRefreshToken,
    hash_token,
    issue_child_token,
    issue_refresh_token,
    revoke_family_tree,
    rotate_refresh_token,
)
from app.auth.security import create_token, hash_password, verify_password
from app.db.models import RefreshTokenRow, User, WatchlistItem
from app.db.repository import create_account
from app.market.universe import DEFAULT_WATCHLIST

router = APIRouter()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _tokens(request: Request, session: Session, user_id: int) -> TokenOut:
    settings = request.app.state.settings
    refresh = issue_refresh_token(session, user_id, now=_now(), days=settings.refresh_days)
    session.commit()
    return TokenOut(access_token=create_token(user_id, settings.jwt_secret), refresh_token=refresh)


@router.post("/auth/register", status_code=201, response_model=TokenOut)
def register(body: RegisterIn, request: Request, session: Session = Depends(get_session)):
    settings = request.app.state.settings
    user = User(email=body.email.lower(), password_hash=hash_password(body.password))
    session.add(user)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "email already registered")
    create_account(session, user.id, settings.starting_cash)
    for position, symbol in enumerate(DEFAULT_WATCHLIST):
        session.add(WatchlistItem(user_id=user.id, symbol=symbol, position=position))
    session.commit()
    return _tokens(request, session, user.id)


@router.post("/auth/login", response_model=TokenOut)
def login(body: LoginIn, request: Request, session: Session = Depends(get_session)):
    user = session.scalar(select(User).where(User.email == body.email.lower()))
    if user is None or not verify_password(user.password_hash, body.password):
        raise HTTPException(401, "invalid email or password")
    return _tokens(request, session, user.id)


@router.post("/auth/refresh", response_model=TokenOut)
def refresh(body: RefreshIn, request: Request, session: Session = Depends(get_session)):
    settings = request.app.state.settings
    try:
        user_id, new_refresh = rotate_refresh_token(
            session, body.refresh_token, now=_now(), days=settings.refresh_days
        )
    except InvalidRefreshToken:
        session.commit()  # persist a family revocation caused by token reuse
        raise HTTPException(401, "invalid refresh token")
    session.commit()
    return TokenOut(access_token=create_token(user_id, settings.jwt_secret), refresh_token=new_refresh)


@router.post("/auth/background-token", response_model=BackgroundTokenOut)
def background_token(body: RefreshIn, request: Request, session: Session = Depends(get_session)):
    settings = request.app.state.settings
    try:
        child = issue_child_token(session, body.refresh_token, now=_now(), days=settings.refresh_days)
    except InvalidRefreshToken:
        raise HTTPException(401, "invalid refresh token")
    session.commit()
    return BackgroundTokenOut(refresh_token=child)


@router.post("/auth/logout", status_code=204)
def logout(body: RefreshIn, session: Session = Depends(get_session)):
    row = session.scalar(
        select(RefreshTokenRow).where(RefreshTokenRow.token_hash == hash_token(body.refresh_token))
    )
    if row is not None:
        revoke_family_tree(session, row.family_id, now=_now())
        session.commit()
    return Response(status_code=204)


@router.get("/me", response_model=MeOut)
def me(user_id: int = Depends(current_user_id), session: Session = Depends(get_session)):
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(401, "invalid token")
    return MeOut(id=user.id, email=user.email)
