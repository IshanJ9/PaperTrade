from decimal import Decimal as D

import fakeredis.aioredis
import pytest

from app.market.price_source import Quote
from app.market.quote_cache import QuoteCache


@pytest.fixture
async def redis():
    r = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield r
    await r.aclose()


async def test_put_then_get_many(redis):
    cache = QuoteCache(redis)
    await cache.put(Quote("AAPL", D("190.12"), 1000))
    got = await cache.get_many(["AAPL", "MSFT"])
    assert got == {"AAPL": Quote("AAPL", D("190.12"), 1000)}


async def test_put_overwrites_with_latest(redis):
    cache = QuoteCache(redis)
    await cache.put(Quote("AAPL", D("1.00"), 1))
    await cache.put(Quote("AAPL", D("2.00"), 2))
    assert (await cache.get_many(["AAPL"]))["AAPL"].price == D("2.00")


async def test_quotes_expire(redis):
    cache = QuoteCache(redis, ttl_s=30)
    await cache.put(Quote("AAPL", D("1.00"), 1))
    assert 0 < await redis.ttl("quote:AAPL") <= 30


async def test_as_of_round_trips_and_defaults_to_none(redis):
    cache = QuoteCache(redis)
    await cache.put(Quote("AAPL", D("1.00"), 5, as_of_ms=123))
    await cache.put(Quote("MSFT", D("2.00"), 6))
    got = await cache.get_many(["AAPL", "MSFT"])
    assert got["AAPL"].as_of_ms == 123
    assert got["MSFT"].as_of_ms is None
