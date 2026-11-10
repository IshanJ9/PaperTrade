from decimal import Decimal as D

from app.db.repository import load_state
from app.domain.models import OrderType, Side
from app.market.loop import run_market_loop
from app.market.price_source import Quote
from app.services.trading import TradingService
from tests.api.conftest import InMemoryQuoteCache
from tests.helpers import make_user


class FiniteSource:
    def __init__(self, quotes):
        self._quotes = quotes

    async def quotes(self, symbols):
        for q in self._quotes:
            yield q


async def test_loop_caches_quotes_and_fills_resting_orders(session_factory):
    uid = make_user(session_factory, "10000")
    service = TradingService(session_factory)
    service.place_order(
        uid, client_order_id="resting-1", symbol="AAPL", side=Side.BUY, type=OrderType.LIMIT,
        quantity=10, price=D("95"), market_price=D("100"),
    )
    cache = InMemoryQuoteCache()
    source = FiniteSource([Quote("AAPL", D("97"), 1), Quote("AAPL", D("94"), 2)])

    await run_market_loop(source, cache, service, ["AAPL"])

    assert cache.data["AAPL"].price == D("94")
    with session_factory() as session:
        assert load_state(session, uid).portfolio.cash == D("9060")


async def test_loop_survives_a_matching_error(session_factory):
    class ExplodingService:
        def __init__(self):
            self.calls = 0

        def on_quote(self, quote):
            self.calls += 1
            raise RuntimeError("boom")

    cache, service = InMemoryQuoteCache(), ExplodingService()
    await run_market_loop(FiniteSource([Quote("AAPL", D("1"), 1), Quote("AAPL", D("2"), 2)]), cache, service, ["AAPL"])
    assert service.calls == 2
    assert cache.data["AAPL"].price == D("2")


async def test_loop_survives_a_cache_failure(session_factory):
    class FlakyCache(InMemoryQuoteCache):
        def __init__(self):
            super().__init__()
            self.failed_once = False

        async def put(self, quote):
            if not self.failed_once:
                self.failed_once = True
                raise ConnectionError("redis blip")
            await super().put(quote)

    cache = FlakyCache()
    service = TradingService(session_factory)
    await run_market_loop(FiniteSource([Quote("AAPL", D("1"), 1), Quote("AAPL", D("2"), 2)]), cache, service, ["AAPL"])
    assert cache.data["AAPL"].price == D("2")


async def test_loop_restarts_a_source_that_crashes(session_factory):
    class CrashOnce:
        def __init__(self):
            self.runs = 0

        async def quotes(self, symbols):
            self.runs += 1
            if self.runs == 1:
                yield Quote("AAPL", D("1"), 1)
                raise RuntimeError("source died")
            yield Quote("AAPL", D("7"), 2)

    slept = []

    async def fake_sleep(seconds):
        slept.append(seconds)

    source, cache = CrashOnce(), InMemoryQuoteCache()
    await run_market_loop(
        source, cache, TradingService(session_factory), ["AAPL"], retry_delay_s=3, sleep=fake_sleep
    )
    assert source.runs == 2 and slept == [3]
    assert cache.data["AAPL"].price == D("7")


async def test_loop_does_not_match_orders_against_stale_quotes(session_factory):
    class CountingService:
        def __init__(self):
            self.seen = []

        def on_quote(self, quote):
            self.seen.append(quote.price)
            return 0

    service, cache = CountingService(), InMemoryQuoteCache()
    stale = Quote("AAPL", D("1"), 1, as_of_ms=1)  # last trade in 1970: the market is closed
    fresh = Quote("AAPL", D("2"), 2)
    await run_market_loop(FiniteSource([stale, fresh]), cache, service, ["AAPL"])
    assert service.seen == [D("2")]
    assert cache.data["AAPL"].price == D("2")  # stale quotes are still cached for display
