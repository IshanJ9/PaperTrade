import asyncio
import contextlib
import math
import time

import httpx
from fastapi import FastAPI
from redis.asyncio import Redis
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.routes_auth import router as auth_router
from app.api.routes_market import router as market_router
from app.api.routes_trading import router as trading_router
from app.config import Settings
from app.db.models import Base
from app.market.finnhub import FinnhubPriceSource
from app.market.history import HistoryRecorder, run_history_maintenance, seed_simulated_history
from app.market.loop import run_market_loop
from app.market.price_source import SimulatedPriceSource
from app.market.quote_cache import QuoteCache
from app.market.universe import UNIVERSE
from app.services.trading import TradingService


def create_app(*, settings=None, session_factory=None, quote_cache=None, price_source=None) -> FastAPI:
    settings = settings or Settings()
    http_client: httpx.AsyncClient | None = None
    cache_ttl_s = 30
    builtin_simulated = False
    # Start a built-in feed only when the caller injected neither a cache nor a source (i.e. the real server).
    if price_source is None and quote_cache is None:
        if settings.price_source == "finnhub":
            http_client = httpx.AsyncClient(timeout=10)
            price_source = FinnhubPriceSource(
                settings.finnhub_api_key, http_client, calls_per_min=settings.finnhub_calls_per_min
            )
            # Quotes must outlive one full polling cycle, or they would expire between polls.
            cache_ttl_s = max(30, math.ceil(2 * price_source.cycle_s(len(UNIVERSE))))
        else:
            price_source = SimulatedPriceSource(UNIVERSE)
            builtin_simulated = True
    if session_factory is None:
        session_factory = sessionmaker(create_engine(settings.database_url), expire_on_commit=False)
    if quote_cache is None:
        quote_cache = QuoteCache(Redis.from_url(settings.redis_url, decode_responses=True), ttl_s=cache_ttl_s)

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        if settings.auto_create_tables:
            Base.metadata.create_all(session_factory.kw["bind"])
        tasks = []
        if builtin_simulated:  # charts work on day one in demo mode
            await asyncio.to_thread(seed_simulated_history, session_factory, UNIVERSE, int(time.time() * 1000))
        if price_source is not None:
            recorder = HistoryRecorder(session_factory)
            tasks.append(
                asyncio.create_task(
                    run_market_loop(
                        price_source, quote_cache, app.state.trading_service, list(UNIVERSE), recorder
                    )
                )
            )
            tasks.append(asyncio.create_task(run_history_maintenance(session_factory)))
        try:
            yield
        finally:
            for task in tasks:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            if http_client is not None:
                await http_client.aclose()

    app = FastAPI(title="PaperTrade", lifespan=lifespan)
    app.state.settings = settings
    app.state.session_factory = session_factory
    app.state.quote_cache = quote_cache
    app.state.trading_service = TradingService(session_factory)
    app.state.price_source = price_source

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth_router)
    app.include_router(trading_router)
    app.include_router(market_router)
    return app
