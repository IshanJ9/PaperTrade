from dataclasses import dataclass
from decimal import Decimal
from enum import Enum


class Side(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class OrderType(str, Enum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"
    STOP = "STOP"


class OrderStatus(str, Enum):
    OPEN = "OPEN"
    FILLED = "FILLED"
    CANCELLED = "CANCELLED"
    REJECTED = "REJECTED"


@dataclass(frozen=True)
class Order:
    id: int
    symbol: str
    side: Side
    type: OrderType
    quantity: int
    price: Decimal | None = None
    status: OrderStatus = OrderStatus.OPEN

    def __post_init__(self) -> None:
        if self.quantity <= 0:
            raise ValueError("quantity must be positive")
        if (self.type is OrderType.MARKET) != (self.price is None):
            raise ValueError("price is required for LIMIT/STOP and forbidden for MARKET")
        if self.price is not None and self.price <= 0:
            raise ValueError("price must be positive")


@dataclass(frozen=True)
class Fill:
    order_id: int
    symbol: str
    side: Side
    quantity: int
    price: Decimal
