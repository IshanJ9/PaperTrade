from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app.auth.security import create_token, decode_token, hash_password, verify_password

SECRET = "test-secret-test-secret-test-secret-123"


def test_password_round_trip_and_wrong_password():
    h = hash_password("correct-horse-1")
    assert h != "correct-horse-1"
    assert verify_password(h, "correct-horse-1") is True
    assert verify_password(h, "wrong") is False


def test_token_round_trip():
    assert decode_token(create_token(42, SECRET), SECRET) == 42


def test_expired_token_is_rejected():
    long_ago = datetime.now(timezone.utc) - timedelta(hours=2)
    token = create_token(42, SECRET, minutes=1, now=long_ago)
    with pytest.raises(jwt.InvalidTokenError):
        decode_token(token, SECRET)


def test_token_signed_with_another_secret_is_rejected():
    token = create_token(42, "another-secret-another-secret-another-1")
    with pytest.raises(jwt.InvalidTokenError):
        decode_token(token, SECRET)


def test_token_without_a_valid_subject_is_rejected():
    token = jwt.encode({"sub": "not-a-number"}, SECRET, algorithm="HS256")
    with pytest.raises(jwt.InvalidTokenError):
        decode_token(token, SECRET)
