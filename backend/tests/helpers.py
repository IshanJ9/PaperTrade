import itertools
from decimal import Decimal

from app.db.models import User
from app.db.repository import create_account

_counter = itertools.count(1)


def make_user(session_factory, cash: str = "100000") -> int:
    with session_factory() as session, session.begin():
        user = User(email=f"user{next(_counter)}@example.com", password_hash="x")
        session.add(user)
        session.flush()
        create_account(session, user.id, Decimal(cash))
        return user.id
