from decimal import Decimal
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="PT_", extra="ignore")

    # Docker Postgres is published on host port 55432 (5432 is taken by a Windows service here).
    database_url: str = "postgresql+psycopg://papertrade:papertrade@localhost:55432/papertrade"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str
    starting_cash: Decimal = Decimal("100000.00")
    refresh_days: int = 30
    price_source: Literal["simulated", "finnhub"] = "simulated"
    finnhub_api_key: str | None = None
    finnhub_calls_per_min: int = 40
    # Production/dev schema comes from `alembic upgrade head`; set true only for throwaway databases.
    auto_create_tables: bool = False

    @model_validator(mode="after")
    def _finnhub_needs_a_key(self) -> "Settings":
        if self.price_source == "finnhub" and not self.finnhub_api_key:
            raise ValueError("PT_PRICE_SOURCE=finnhub requires PT_FINNHUB_API_KEY")
        return self
