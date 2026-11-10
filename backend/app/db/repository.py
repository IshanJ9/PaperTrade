from decimal import Decimal

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.db.models import Account, FillRow, OrderRow, PositionRow
from app.domain.models import Order, OrderStatus, OrderType, Side
from app.domain.portfolio import Portfolio, Position
from app.domain.state import TradingState


def create_account(session: Session, user_id: int, cash: Decimal) -> None:
    session.add(Account(user_id=user_id, cash=cash, realized_pnl=Decimal("0")))


def order_to_domain(row: OrderRow) -> Order:
    return Order(
        id=row.id,
        symbol=row.symbol,
        side=Side(row.side),
        type=OrderType(row.type),
        quantity=row.quantity,
        price=row.price,
        status=OrderStatus(row.status),
    )


def load_state(session: Session, user_id: int, *, lock: bool = False) -> TradingState:
    """Portfolio plus OPEN orders. fills is empty: it holds only fills made after loading."""
    account = session.get(Account, user_id, with_for_update=lock)
    if account is None:
        raise LookupError(f"no account for user {user_id}")
    positions = {
        p.symbol: Position(p.symbol, p.quantity, p.avg_cost)
        for p in session.scalars(select(PositionRow).where(PositionRow.user_id == user_id))
    }
    open_orders = session.scalars(
        select(OrderRow)
        .where(OrderRow.user_id == user_id, OrderRow.status == OrderStatus.OPEN.value)
        .order_by(OrderRow.id)
    )
    return TradingState(
        Portfolio(account.cash, positions, account.realized_pnl),
        [order_to_domain(o) for o in open_orders],
        [],
    )


def save_state(session: Session, user_id: int, state: TradingState) -> None:
    account = session.get(Account, user_id)
    account.cash = state.portfolio.cash
    account.realized_pnl = state.portfolio.realized_pnl

    existing = {
        p.symbol: p
        for p in session.scalars(select(PositionRow).where(PositionRow.user_id == user_id))
    }
    for symbol, pos in state.portfolio.positions.items():
        row = existing.pop(symbol, None)
        if row is None:
            session.add(PositionRow(user_id=user_id, symbol=symbol, quantity=pos.quantity, avg_cost=pos.avg_cost))
        else:
            row.quantity, row.avg_cost = pos.quantity, pos.avg_cost
    for stale in existing.values():
        session.delete(stale)

    for order in state.orders:
        session.execute(
            update(OrderRow)
            .where(OrderRow.id == order.id, OrderRow.user_id == user_id)
            .values(status=order.status.value)
        )
    for fill in state.fills:
        session.add(
            FillRow(
                user_id=user_id,
                order_id=fill.order_id,
                symbol=fill.symbol,
                side=fill.side.value,
                quantity=fill.quantity,
                price=fill.price,
            )
        )
    session.flush()
