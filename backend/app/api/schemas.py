from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.domain.models import OrderStatus, OrderType, Side


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshIn(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=512)


class BackgroundTokenOut(BaseModel):
    refresh_token: str


class MeOut(BaseModel):
    id: int
    email: str


class OrderIn(BaseModel):
    client_order_id: str = Field(min_length=8, max_length=64)
    symbol: str
    side: Side
    type: OrderType
    quantity: int = Field(gt=0)
    price: Decimal | None = None


class OrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    symbol: str
    side: Side
    type: OrderType
    quantity: int
    price: Decimal | None
    status: OrderStatus


class FillOut(BaseModel):
    id: int
    order_id: int
    symbol: str
    side: str
    quantity: int
    price: Decimal
    created_at: datetime


class PositionOut(BaseModel):
    symbol: str
    quantity: int
    avg_cost: Decimal
    last_price: Decimal
    unrealized_pnl: Decimal


class PortfolioOut(BaseModel):
    cash: Decimal
    realized_pnl: Decimal
    unrealized_pnl: Decimal
    equity: Decimal
    positions: list[PositionOut]


class WatchlistIO(BaseModel):
    symbols: list[str]


class QuoteOut(BaseModel):
    price: Decimal
    ts_ms: int
    as_of_ms: int | None = None
    stale: bool = False


class SnapshotOut(BaseModel):
    server_time: datetime
    portfolio: PortfolioOut
    orders: list[OrderOut]
    transactions: list[FillOut]
    watchlist: list[str]
