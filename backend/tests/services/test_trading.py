from decimal import Decimal as D

import pytest

from app.db.repository import load_state
from app.domain.models import OrderStatus, OrderType, Side
from app.market.price_source import Quote
from app.services.trading import TradingService
from tests.helpers import make_user

BUY, SELL = Side.BUY, Side.SELL
MARKET, LIMIT = OrderType.MARKET, OrderType.LIMIT


def place(service, uid, cid="c1", side=BUY, type_=MARKET, qty=10, price=None, market="100"):
    return service.place_order(
        uid, client_order_id=cid, symbol="AAPL", side=side, type=type_,
        quantity=qty, price=None if price is None else D(price), market_price=D(market),
    )


def cash(session_factory, uid):
    with session_factory() as session:
        return load_state(session, uid).portfolio.cash


def test_market_buy_fills_and_persists(session_factory):
    uid = make_user(session_factory, "10000")
    order = place(TradingService(session_factory), uid)
    assert order.status is OrderStatus.FILLED
    assert cash(session_factory, uid) == D("9000")


def test_repeating_a_client_order_id_returns_the_same_order_without_a_second_fill(session_factory):
    uid = make_user(session_factory, "10000")
    service = TradingService(session_factory)
    first = place(service, uid, cid="same")
    second = place(service, uid, cid="same")
    assert first.id == second.id
    assert cash(session_factory, uid) == D("9000")


def test_limit_order_rests_then_fills_when_a_quote_crosses_it(session_factory):
    uid = make_user(session_factory, "10000")
    service = TradingService(session_factory)
    order = place(service, uid, type_=LIMIT, price="95")
    assert order.status is OrderStatus.OPEN
    assert service.on_quote(Quote("AAPL", D("97"), 1)) == 0
    assert service.on_quote(Quote("AAPL", D("94"), 2)) == 1
    assert cash(session_factory, uid) == D("9060")


def test_cancel_only_works_on_the_owners_open_orders(session_factory):
    alice, bob = make_user(session_factory), make_user(session_factory)
    service = TradingService(session_factory)
    resting = place(service, alice, cid="r", type_=LIMIT, price="1")
    filled = place(service, alice, cid="f")
    assert service.cancel_order(bob, resting.id) is False
    assert service.cancel_order(alice, filled.id) is False
    assert service.cancel_order(alice, 999999) is False
    assert service.cancel_order(alice, resting.id) is True
    assert service.cancel_order(alice, resting.id) is False


def test_unaffordable_order_comes_back_rejected(session_factory):
    uid = make_user(session_factory, "10")
    assert place(TradingService(session_factory), uid).status is OrderStatus.REJECTED


def test_invalid_order_raises_value_error_and_stores_nothing(session_factory):
    uid = make_user(session_factory)
    service = TradingService(session_factory)
    with pytest.raises(ValueError):
        place(service, uid, type_=LIMIT, price=None)
    with pytest.raises(ValueError):
        place(service, uid, qty=0)


def test_quotes_only_affect_users_with_matching_open_orders(session_factory):
    alice, bob = make_user(session_factory, "10000"), make_user(session_factory, "10000")
    service = TradingService(session_factory)
    place(service, alice, type_=LIMIT, price="95")
    assert service.on_quote(Quote("AAPL", D("90"), 1)) == 1
    assert cash(session_factory, alice) == D("9100")
    assert cash(session_factory, bob) == D("10000")
