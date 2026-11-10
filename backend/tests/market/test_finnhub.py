from decimal import Decimal as D

import httpx
import pytest
from pydantic import ValidationError

from app.config import Settings
from app.market.finnhub import FinnhubPriceSource
from app.market.price_source import Quote


class Stop(Exception):
    """Raised by the fake sleep to end the otherwise endless quote loop."""


def make_source(handler, *, max_sleeps, calls_per_min=40, clock=lambda: 1_700_000_000.0):
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        if len(sleeps) >= max_sleeps:
            raise Stop

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://finnhub.io/api/v1")
    source = FinnhubPriceSource("secret-key", client, calls_per_min=calls_per_min, clock=clock, sleep=fake_sleep)
    return source, sleeps


async def collect(source, symbols):
    out: list[Quote] = []
    try:
        async for quote in source.quotes(symbols):
            out.append(quote)
    except Stop:
        pass
    return out


async def test_yields_quote_with_two_decimal_price_and_clock_timestamp():
    source, _ = make_source(lambda req: httpx.Response(200, json={"c": 190.1234}), max_sleeps=1)
    quotes = await collect(source, ["AAPL"])
    assert quotes == [Quote("AAPL", D("190.12"), 1_700_000_000_000)]


async def test_api_key_is_sent_in_header_not_url():
    seen = []

    def handler(req: httpx.Request):
        seen.append(req)
        return httpx.Response(200, json={"c": 10})

    source, _ = make_source(handler, max_sleeps=1)
    await collect(source, ["AAPL"])
    assert seen[0].headers["X-Finnhub-Token"] == "secret-key"
    assert "secret-key" not in str(seen[0].url)
    assert seen[0].url.params["symbol"] == "AAPL"


@pytest.mark.parametrize("payload", [{"c": 0}, {}, {"c": None}, {"c": "x"}, {"c": -3}, {"c": True}])
async def test_zero_or_missing_price_is_skipped(payload):
    source, _ = make_source(lambda req: httpx.Response(200, json=payload), max_sleeps=2)
    assert await collect(source, ["AAPL"]) == []


async def test_bad_symbol_does_not_stop_later_symbols():
    def handler(req: httpx.Request):
        return httpx.Response(200, json={"c": 0 if req.url.params["symbol"] == "ZZZZ" else 5})

    source, _ = make_source(handler, max_sleeps=2)
    quotes = await collect(source, ["ZZZZ", "AAPL"])
    assert [q.symbol for q in quotes] == ["AAPL"]


async def test_calls_are_spaced_by_the_rate_budget():
    source, sleeps = make_source(lambda req: httpx.Response(200, json={"c": 10}), max_sleeps=3, calls_per_min=40)
    await collect(source, ["AAPL", "MSFT"])
    assert sleeps == [1.5, 1.5, 1.5]


async def test_429_backs_off_and_does_not_yield():
    responses = iter([httpx.Response(429), httpx.Response(200, json={"c": 7})])
    source, sleeps = make_source(lambda req: next(responses), max_sleeps=1)
    assert await collect(source, ["AAPL"]) == []  # the 429 itself yields nothing
    assert sleeps == [5]

    responses = iter([httpx.Response(429), httpx.Response(200, json={"c": 7})])
    source, sleeps = make_source(lambda req: next(responses), max_sleeps=2)
    quotes = await collect(source, ["AAPL"])  # ...and the next call proceeds normally
    assert sleeps == [5, 1.5]
    assert [q.price for q in quotes] == [D("7.00")]


async def test_network_error_for_one_symbol_does_not_stop_the_loop():
    def handler(req: httpx.Request):
        if req.url.params["symbol"] == "AAPL":
            raise httpx.ConnectError("down")
        return httpx.Response(200, json={"c": 9})

    source, _ = make_source(handler, max_sleeps=2)
    quotes = await collect(source, ["AAPL", "MSFT"])
    assert [q.symbol for q in quotes] == ["MSFT"]


async def test_server_error_is_skipped():
    source, _ = make_source(lambda req: httpx.Response(500, text="oops"), max_sleeps=2)
    assert await collect(source, ["AAPL"]) == []


def test_cycle_seconds():
    source, _ = make_source(lambda req: httpx.Response(200), max_sleeps=1, calls_per_min=40)
    assert source.cycle_s(15) == 22.5


def test_finnhub_without_key_fails_settings_validation():
    with pytest.raises(ValidationError, match="PT_FINNHUB_API_KEY"):
        Settings(_env_file=None, jwt_secret="x" * 40, price_source="finnhub")


def test_finnhub_with_key_is_accepted_and_simulated_is_the_default():
    assert Settings(_env_file=None, jwt_secret="x" * 40).price_source == "simulated"
    ok = Settings(_env_file=None, jwt_secret="x" * 40, price_source="finnhub", finnhub_api_key="k")
    assert ok.finnhub_api_key == "k"


@pytest.mark.parametrize("payload", [[], None, "text", 5])
async def test_a_json_body_that_is_not_an_object_is_skipped(payload):
    source, _ = make_source(lambda req: httpx.Response(200, json=payload), max_sleeps=2)
    assert await collect(source, ["AAPL"]) == []


async def test_last_trade_time_becomes_as_of_ms():
    source, _ = make_source(lambda req: httpx.Response(200, json={"c": 10, "t": 1_700_000_000}), max_sleeps=1)
    (quote,) = await collect(source, ["AAPL"])
    assert quote.as_of_ms == 1_700_000_000_000


@pytest.mark.parametrize("t", [None, 0, "x", -5])
async def test_missing_or_invalid_last_trade_time_means_unknown(t):
    source, _ = make_source(lambda req: httpx.Response(200, json={"c": 10, "t": t}), max_sleeps=1)
    (quote,) = await collect(source, ["AAPL"])
    assert quote.as_of_ms is None
