from decimal import Decimal

from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import Account, OrderRow
from app.db.repository import load_state, order_to_domain, save_state
from app.domain.engine import MatchingEngine
from app.domain.models import Order, OrderStatus, OrderType, Side
from app.market.price_source import Quote


class TradingService:
    def __init__(self, session_factory: sessionmaker[Session], engine: MatchingEngine | None = None):
        self._session_factory = session_factory
        self._engine = engine or MatchingEngine()

    def place_order(
        self,
        user_id: int,
        *,
        client_order_id: str,
        symbol: str,
        side: Side,
        type: OrderType,
        quantity: int,
        price: Decimal | None,
        market_price: Decimal,
    ) -> Order:
        Order(0, symbol, side, type, quantity, price)  # raises ValueError if invalid
        with self._session_factory() as session, session.begin():
            if session.get(Account, user_id, with_for_update=True) is None:
                raise LookupError(f"no account for user {user_id}")
            existing = session.scalar(
                select(OrderRow).where(
                    OrderRow.user_id == user_id, OrderRow.client_order_id == client_order_id
                )
            )
            if existing is not None:
                return order_to_domain(existing)
            row = OrderRow(
                user_id=user_id,
                client_order_id=client_order_id,
                symbol=symbol,
                side=side.value,
                type=type.value,
                quantity=quantity,
                price=price,
                status=OrderStatus.OPEN.value,
            )
            session.add(row)
            session.flush()
            state = load_state(session, user_id)
            save_state(session, user_id, self._engine.process(state, symbol, market_price))
            session.refresh(row)
            return order_to_domain(row)

    def cancel_order(self, user_id: int, order_id: int) -> bool:
        with self._session_factory() as session, session.begin():
            session.get(Account, user_id, with_for_update=True)
            result = session.execute(
                update(OrderRow)
                .where(
                    OrderRow.id == order_id,
                    OrderRow.user_id == user_id,
                    OrderRow.status == OrderStatus.OPEN.value,
                )
                .values(status=OrderStatus.CANCELLED.value)
            )
            return result.rowcount == 1

    def on_quote(self, quote: Quote) -> int:
        with self._session_factory() as session:
            user_ids = list(
                session.scalars(
                    select(OrderRow.user_id)
                    .where(OrderRow.symbol == quote.symbol, OrderRow.status == OrderStatus.OPEN.value)
                    .distinct()
                )
            )
        fills = 0
        for user_id in user_ids:
            with self._session_factory() as session, session.begin():
                state = load_state(session, user_id, lock=True)
                next_state = self._engine.process(state, quote.symbol, quote.price)
                if next_state is not state:
                    save_state(session, user_id, next_state)
                    fills += len(next_state.fills)
        return fills
