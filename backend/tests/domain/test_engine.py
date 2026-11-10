from decimal import Decimal as D

from app.domain.engine import MatchingEngine
from app.domain.models import Order, OrderStatus, OrderType, Side
from app.domain.portfolio import Portfolio, Position
from app.domain.state import TradingState

BUY, SELL = Side.BUY, Side.SELL
MARKET, LIMIT, STOP = OrderType.MARKET, OrderType.LIMIT, OrderType.STOP
engine = MatchingEngine()


def order(id_, side, type_, qty, price, symbol="AAPL"):
    return Order(id_, symbol, side, type_, qty, None if price is None else D(price))


def state(cash="10000", orders=(), positions=None):
    return TradingState(Portfolio(D(cash), positions or {}), list(orders))


def test_resting_limit_buy_fills_on_a_later_tick():
    s0 = state(orders=[order(1, BUY, LIMIT, 10, "100")])
    s1 = engine.process(s0, "AAPL", D("101"))
    assert s1 is s0
    s2 = engine.process(s1, "AAPL", D("99.50"))
    assert s2.orders[0].status is OrderStatus.FILLED
    assert s2.portfolio.cash == D("9005.00")
    assert len(s2.fills) == 1


def test_stop_loss_gapping_through_fills_at_gapped_price():
    held = {"AAPL": Position("AAPL", 10, D("100"))}
    s = engine.process(state("0", [order(1, SELL, STOP, 10, "95")], held), "AAPL", D("90"))
    assert s.orders[0].status is OrderStatus.FILLED
    assert s.portfolio.cash == D("900")
    assert s.portfolio.realized_pnl == D("-100")


def test_unaffordable_fill_is_rejected_and_portfolio_unchanged():
    s0 = state("100", [order(1, BUY, MARKET, 10, None)])
    s1 = engine.process(s0, "AAPL", D("50"))
    assert s1.orders[0].status is OrderStatus.REJECTED
    assert s1.portfolio.cash == D("100")
    assert s1.fills == []


def test_selling_unheld_shares_is_rejected():
    s = engine.process(state("100", [order(1, SELL, MARKET, 1, None)]), "AAPL", D("50"))
    assert s.orders[0].status is OrderStatus.REJECTED


def test_ticks_for_other_symbols_do_not_touch_orders():
    s0 = state(orders=[order(1, BUY, MARKET, 1, None, symbol="MSFT")])
    assert engine.process(s0, "AAPL", D("1")) is s0


def test_fills_are_recorded_in_order_sequence():
    s = engine.process(
        state(orders=[order(1, BUY, MARKET, 1, None), order(2, BUY, MARKET, 1, None)]),
        "AAPL",
        D("10"),
    )
    assert [f.order_id for f in s.fills] == [1, 2]


def test_already_filled_orders_are_not_filled_again():
    s1 = engine.process(state(orders=[order(1, BUY, MARKET, 1, None)]), "AAPL", D("10"))
    s2 = engine.process(s1, "AAPL", D("10"))
    assert s2 is s1
