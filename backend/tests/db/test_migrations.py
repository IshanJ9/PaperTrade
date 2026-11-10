from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text

from app.db.models import Base

BACKEND = Path(__file__).resolve().parents[2]
SERVER = "postgresql+psycopg://papertrade:papertrade@localhost:55432"
SCRATCH_DB = "papertrade_migrations_test"


@pytest.fixture
def migrated_engine():
    admin = create_engine(f"{SERVER}/postgres", isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f"DROP DATABASE IF EXISTS {SCRATCH_DB} WITH (FORCE)"))
        conn.execute(text(f"CREATE DATABASE {SCRATCH_DB}"))
    url = f"{SERVER}/{SCRATCH_DB}"
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "head")
    engine = create_engine(url)
    yield engine
    engine.dispose()
    with admin.connect() as conn:
        conn.execute(text(f"DROP DATABASE IF EXISTS {SCRATCH_DB} WITH (FORCE)"))
    admin.dispose()


def test_upgrade_creates_every_model_table(migrated_engine):
    assert set(inspect(migrated_engine).get_table_names()) == set(Base.metadata.tables) | {"alembic_version"}


def test_migrations_match_models(migrated_engine):
    with migrated_engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn, opts={"compare_type": True}), Base.metadata)
    assert diff == []


@pytest.mark.parametrize("auto_create, expect_tables", [(False, False), (True, True)])
def test_startup_creates_tables_only_when_asked(auto_create, expect_tables):
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import sessionmaker

    from app.config import Settings
    from app.main import create_app
    from tests.api.conftest import InMemoryQuoteCache

    name = "papertrade_startup_test"
    admin = create_engine(f"{SERVER}/postgres", isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)"))
        conn.execute(text(f"CREATE DATABASE {name}"))
    engine = create_engine(f"{SERVER}/{name}")
    try:
        settings = Settings(_env_file=None, jwt_secret="x" * 40, auto_create_tables=auto_create)
        app = create_app(
            settings=settings,
            session_factory=sessionmaker(engine, expire_on_commit=False),
            quote_cache=InMemoryQuoteCache(),
        )
        with TestClient(app):
            pass
        assert bool(inspect(engine).get_table_names()) is expect_tables
    finally:
        engine.dispose()
        with admin.connect() as conn:
            conn.execute(text(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)"))
        admin.dispose()
