from collections.abc import Iterator

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth.security import decode_token

_bearer = HTTPBearer(auto_error=False)
_UNAUTHORIZED = {"WWW-Authenticate": "Bearer"}


def get_session(request: Request) -> Iterator[Session]:
    with request.app.state.session_factory() as session:
        yield session


def current_user_id(
    request: Request, creds: HTTPAuthorizationCredentials | None = Depends(_bearer)
) -> int:
    if creds is None:
        raise HTTPException(401, "missing token", headers=_UNAUTHORIZED)
    try:
        return decode_token(creds.credentials, request.app.state.settings.jwt_secret)
    except jwt.InvalidTokenError:
        raise HTTPException(401, "invalid token", headers=_UNAUTHORIZED)
