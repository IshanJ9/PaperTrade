from decimal import Decimal as D

from app.market.price_source import SimulatedPriceSource

START = {"AAPL": D("150.00"), "MSFT": D("300.00")}


async def take(agen, n):
    out = []
    async for item in agen:
        out.append(item)
        if len(out) == n:
            break
    await agen.aclose()
    return out


async def test_same_seed_gives_same_sequence():
    a = await take(SimulatedPriceSource(START, seed=7, tick_s=0).quotes(START), 6)
    b = await take(SimulatedPriceSource(START, seed=7, tick_s=0).quotes(START), 6)
    assert [q.price for q in a] == [q.price for q in b]


async def test_one_quote_per_symbol_per_tick_in_symbol_order():
    quotes = await take(SimulatedPriceSource(START, tick_s=0).quotes(START), 4)
    assert [q.symbol for q in quotes] == ["AAPL", "MSFT", "AAPL", "MSFT"]


async def test_prices_stay_positive_two_decimals_and_within_bound():
    src = SimulatedPriceSource({"AAPL": D("150.00")}, tick_s=0)
    quotes = await take(src.quotes(["AAPL"]), 200)
    prev = D("150.00")
    for q in quotes:
        assert q.price >= D("0.01")
        assert q.price == q.price.quantize(D("0.01"))
        assert abs(q.price - prev) <= prev * D("0.0021")
        prev = q.price
