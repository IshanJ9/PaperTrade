from decimal import Decimal as D

from sqlalchemy import func, select

from app.db.models import FillRow, OrderRow
from app.db.repository import load_state, order_to_domain, save_state
from app.domain.engine import MatchingEngine
from app.domain.models import OrderStatus, OrderType, Side
from tests.helpers import make_user


def add_order(session, user_id, **kw):
    row = OrderRow(
        user_id=user_id,
        client_order_id=kw.get("client_order_id", "c-1"),
        symbol=kw.get("symbol", "AAPL"),
        side=kw.get("side", Side.BUY).value,
        type=kw.get("type", OrderType.MARKET).value,
        quantity=kw.get("quantity", 10),
        price=kw.get("price"),
        status=OrderStatus.OPEN.value,
    )
    session.add(row)
    session.flush()
    return row


def test_new_account_loads_starting_cash_and_no_orders(session_factory):
    uid = make_user(session_factory, "5000")
    with session_factory() as session:
        state = load_state(session, uid)
    assert state.portfolio.cash == D("5000")
    assert state.portfolio.positions == {}
    assert state.orders == [] and state.fills == []


def test_only_open_orders_are_loaded(session_factory):
    uid = make_user(session_factory)
    with session_factory() as session, session.begin():
        add_order(session, uid, client_order_id="a")
        done = add_order(session, uid, client_order_id="b")
        done.status = OrderStatus.CANCELLED.value
    with session_factory() as session:
        state = load_state(session, uid)
    assert [o.status for o in state.orders] == [OrderStatus.OPEN]


def test_save_state_persists_fill_position_cash_and_order_status(session_factory):
    uid = make_user(session_factory)
    with session_factory() as session, session.begin():
        row = add_order(session, uid)
        order_id = row.id
        state = load_state(session, uid, lock=True)
        save_state(session, uid, MatchingEngine().process(state, "AAPL", D("100")))
    with session_factory() as session:
        reloaded = load_state(session, uid)
        assert reloaded.portfolio.cash == D("99000")
        assert reloaded.portfolio.positions["AAPL"].quantity == 10
        assert reloaded.orders == []  # filled, so no longer open
        assert order_to_domain(session.get(OrderRow, order_id)).status is OrderStatus.FILLED
        assert session.scalar(select(func.count()).select_from(FillRow)) == 1


def test_selling_everything_deletes_the_position_row(session_factory):
    uid = make_user(session_factory)
    engine = MatchingEngine()
    with session_factory() as session, session.begin():
        add_order(session, uid, client_order_id="buy")
        save_state(session, uid, engine.process(load_state(session, uid), "AAPL", D("100")))
    with session_factory() as session, session.begin():
        add_order(session, uid, client_order_id="sell", side=Side.SELL)
        save_state(session, uid, engine.process(load_state(session, uid), "AAPL", D("110")))
    with session_factory() as session:
        state = load_state(session, uid)
    assert state.portfolio.positions == {}
    assert state.portfolio.realized_pnl == D("100")
