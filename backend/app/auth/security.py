from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def create_token(user_id: int, secret: str, minutes: int = 60, now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    claims = {"sub": str(user_id), "iat": now, "exp": now + timedelta(minutes=minutes)}
    return jwt.encode(claims, secret, algorithm="HS256")


def decode_token(token: str, secret: str) -> int:
    payload = jwt.decode(token, secret, algorithms=["HS256"])
    try:
        return int(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise jwt.InvalidTokenError("bad subject") from exc
