import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import Base

TEST_DB_URL = "postgresql+psycopg://papertrade:papertrade@localhost:55432/papertrade_test"


@pytest.fixture
def db_engine():
    engine = create_engine(TEST_DB_URL)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def session_factory(db_engine):
    return sessionmaker(db_engine, expire_on_commit=False)
