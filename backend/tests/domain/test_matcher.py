from decimal import Decimal as D

import pytest

from app.domain.matcher import try_fill
from app.domain.models import Order, OrderStatus, OrderType, Side

BUY, SELL = Side.BUY, Side.SELL
MARKET, LIMIT, STOP = OrderType.MARKET, OrderType.LIMIT, OrderType.STOP


def order(side, type_, price, status=OrderStatus.OPEN):
    return Order(1, "AAPL", side, type_, 10, None if price is None else D(price), status)


def test_market_order_fills_at_market_price():
    fill = try_fill(order(BUY, MARKET, None), D("150.25"))
    assert fill is not None
    assert fill.price == D("150.25")
    assert fill.quantity == 10


def test_limit_buy_fills_at_or_below_limit_at_market_price():
    assert try_fill(order(BUY, LIMIT, "100"), D("100.01")) is None
    assert try_fill(order(BUY, LIMIT, "100"), D("100")).price == D("100")
    assert try_fill(order(BUY, LIMIT, "100"), D("98.50")).price == D("98.50")


def test_limit_sell_fills_at_or_above_limit():
    assert try_fill(order(SELL, LIMIT, "100"), D("99.99")) is None
    assert try_fill(order(SELL, LIMIT, "100"), D("101")).price == D("101")


def test_stop_sell_triggers_at_or_below_and_fills_at_gapped_price():
    assert try_fill(order(SELL, STOP, "95"), D("95.01")) is None
    assert try_fill(order(SELL, STOP, "95"), D("95")).price == D("95")
    assert try_fill(order(SELL, STOP, "95"), D("90")).price == D("90")


def test_stop_buy_triggers_at_or_above():
    assert try_fill(order(BUY, STOP, "105"), D("104.99")) is None
    assert try_fill(order(BUY, STOP, "105"), D("108")).price == D("108")


def test_non_open_orders_never_fill():
    assert try_fill(order(BUY, MARKET, None, OrderStatus.CANCELLED), D("1")) is None


def test_market_order_with_price_is_invalid():
    with pytest.raises(ValueError):
        order(BUY, MARKET, "10")


def test_limit_order_without_price_is_invalid():
    with pytest.raises(ValueError):
        order(BUY, LIMIT, None)


def test_non_positive_price_or_quantity_is_invalid():
    with pytest.raises(ValueError):
        order(BUY, LIMIT, "0")
    with pytest.raises(ValueError):
        Order(1, "AAPL", BUY, MARKET, 0)
