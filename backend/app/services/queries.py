from collections.abc import Mapping

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.schemas import FillOut, OrderOut, PortfolioOut, PositionOut
from app.db.models import FillRow, OrderRow, WatchlistItem
from app.db.repository import load_state, order_to_domain
from app.market.price_source import Quote


def portfolio_view(session: Session, user_id: int, quotes: Mapping[str, Quote]) -> PortfolioOut:
    portfolio = load_state(session, user_id).portfolio
    prices = {
        p.symbol: quotes[p.symbol].price if p.symbol in quotes else p.avg_cost
        for p in portfolio.positions.values()
    }
    return PortfolioOut(
        cash=portfolio.cash,
        realized_pnl=portfolio.realized_pnl,
        unrealized_pnl=portfolio.unrealized_pnl(prices),
        equity=portfolio.equity(prices),
        positions=[
            PositionOut(
                symbol=p.symbol,
                quantity=p.quantity,
                avg_cost=p.avg_cost,
                last_price=prices[p.symbol],
                unrealized_pnl=(prices[p.symbol] - p.avg_cost) * p.quantity,
            )
            for p in portfolio.positions.values()
        ],
    )


def list_orders(session: Session, user_id: int, limit: int) -> list[OrderOut]:
    rows = session.scalars(
        select(OrderRow).where(OrderRow.user_id == user_id).order_by(OrderRow.id.desc()).limit(limit)
    )
    return [OrderOut.model_validate(order_to_domain(r)) for r in rows]


def list_fills(session: Session, user_id: int, limit: int) -> list[FillOut]:
    rows = session.scalars(
        select(FillRow).where(FillRow.user_id == user_id).order_by(FillRow.id.desc()).limit(limit)
    )
    return [
        FillOut(id=r.id, order_id=r.order_id, symbol=r.symbol, side=r.side,
                quantity=r.quantity, price=r.price, created_at=r.created_at)
        for r in rows
    ]


def get_watchlist(session: Session, user_id: int) -> list[str]:
    return list(
        session.scalars(
            select(WatchlistItem.symbol)
            .where(WatchlistItem.user_id == user_id)
            .order_by(WatchlistItem.position)
        )
    )


def set_watchlist(session: Session, user_id: int, symbols: list[str]) -> list[str]:
    unique = list(dict.fromkeys(symbols))
    session.execute(delete(WatchlistItem).where(WatchlistItem.user_id == user_id))
    for position, symbol in enumerate(unique):
        session.add(WatchlistItem(user_id=user_id, symbol=symbol, position=position))
    session.commit()
    return unique
