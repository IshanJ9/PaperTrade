from dataclasses import replace
from decimal import Decimal

from app.domain.matcher import try_fill
from app.domain.models import OrderStatus
from app.domain.portfolio import InsufficientFunds, InsufficientShares
from app.domain.state import TradingState


class MatchingEngine:
    def process(self, state: TradingState, symbol: str, price: Decimal) -> TradingState:
        portfolio = state.portfolio
        new_fills = []
        orders = []
        changed = False
        for order in state.orders:
            fill = try_fill(order, price) if order.symbol == symbol else None
            if fill is None:
                orders.append(order)
                continue
            changed = True
            try:
                portfolio = portfolio.apply_fill(fill)
            except (InsufficientFunds, InsufficientShares):
                orders.append(replace(order, status=OrderStatus.REJECTED))
            else:
                new_fills.append(fill)
                orders.append(replace(order, status=OrderStatus.FILLED))
        if not changed:
            return state
        return TradingState(portfolio, orders, [*state.fills, *new_fills])
