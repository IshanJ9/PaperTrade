from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from decimal import ROUND_HALF_UP, Decimal

from app.domain.models import Fill, Side

ZERO = Decimal("0")
AVG_COST_QUANTUM = Decimal("0.0001")


class InsufficientFunds(Exception):
    pass


class InsufficientShares(Exception):
    pass


@dataclass(frozen=True)
class Position:
    symbol: str
    quantity: int
    avg_cost: Decimal


@dataclass(frozen=True)
class Portfolio:
    cash: Decimal
    positions: Mapping[str, Position] = field(default_factory=dict)
    realized_pnl: Decimal = ZERO

    def apply_fill(self, fill: Fill) -> "Portfolio":
        return self._buy(fill) if fill.side is Side.BUY else self._sell(fill)

    def _buy(self, fill: Fill) -> "Portfolio":
        cost = fill.price * fill.quantity
        if cost > self.cash:
            raise InsufficientFunds(f"need {cost}, have {self.cash}")
        old = self.positions.get(fill.symbol)
        old_qty = old.quantity if old else 0
        old_value = (old.avg_cost if old else ZERO) * old_qty
        new_qty = old_qty + fill.quantity
        new_avg = ((old_value + cost) / new_qty).quantize(AVG_COST_QUANTUM, ROUND_HALF_UP)
        return replace(
            self,
            cash=self.cash - cost,
            positions={**self.positions, fill.symbol: Position(fill.symbol, new_qty, new_avg)},
        )

    def _sell(self, fill: Fill) -> "Portfolio":
        old = self.positions.get(fill.symbol)
        if old is None or old.quantity < fill.quantity:
            held = old.quantity if old else 0
            raise InsufficientShares(f"cannot sell {fill.quantity} {fill.symbol}, hold {held}")
        remaining = old.quantity - fill.quantity
        positions = {k: v for k, v in self.positions.items() if k != fill.symbol}
        if remaining:
            positions[fill.symbol] = replace(old, quantity=remaining)
        return replace(
            self,
            cash=self.cash + fill.price * fill.quantity,
            realized_pnl=self.realized_pnl + (fill.price - old.avg_cost) * fill.quantity,
            positions=positions,
        )

    def unrealized_pnl(self, prices: Mapping[str, Decimal]) -> Decimal:
        return sum(
            ((prices[p.symbol] - p.avg_cost) * p.quantity for p in self.positions.values()),
            ZERO,
        )

    def equity(self, prices: Mapping[str, Decimal]) -> Decimal:
        return self.cash + sum(
            (prices[p.symbol] * p.quantity for p in self.positions.values()), ZERO
        )
