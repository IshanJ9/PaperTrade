from decimal import Decimal as D

from app.market.freshness import MAX_QUOTE_AGE_S, is_stale
from app.market.price_source import Quote

NOW = 1_800_000_000_000


def quote(as_of_ms):
    return Quote("AAPL", D("1"), NOW, as_of_ms=as_of_ms)


def test_a_quote_without_a_last_trade_time_is_never_stale():
    assert is_stale(quote(None), NOW) is False


def test_recent_last_trade_is_fresh_and_old_one_is_stale():
    assert is_stale(quote(NOW - 5_000), NOW) is False
    assert is_stale(quote(NOW - MAX_QUOTE_AGE_S * 1000), NOW) is False  # exactly at the limit
    assert is_stale(quote(NOW - MAX_QUOTE_AGE_S * 1000 - 1), NOW) is True
