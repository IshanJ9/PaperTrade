from dataclasses import dataclass, field

from app.domain.models import Fill, Order
from app.domain.portfolio import Portfolio


@dataclass(frozen=True)
class TradingState:
    portfolio: Portfolio
    orders: list[Order] = field(default_factory=list)
    fills: list[Fill] = field(default_factory=list)
