from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, DateTime, ForeignKey, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

MONEY = Numeric(18, 4)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Account(Base):
    __tablename__ = "accounts"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    cash: Mapped[Decimal] = mapped_column(MONEY)
    realized_pnl: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0"))


class PositionRow(Base):
    __tablename__ = "positions"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    symbol: Mapped[str] = mapped_column(String(16), primary_key=True)
    quantity: Mapped[int]
    avg_cost: Mapped[Decimal] = mapped_column(MONEY)


class OrderRow(Base):
    __tablename__ = "orders"
    __table_args__ = (UniqueConstraint("user_id", "client_order_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    client_order_id: Mapped[str] = mapped_column(String(64))
    symbol: Mapped[str] = mapped_column(String(16), index=True)
    side: Mapped[str] = mapped_column(String(8))
    type: Mapped[str] = mapped_column(String(8))
    quantity: Mapped[int]
    price: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    status: Mapped[str] = mapped_column(String(10), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FillRow(Base):
    __tablename__ = "fills"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"))
    symbol: Mapped[str] = mapped_column(String(16))
    side: Mapped[str] = mapped_column(String(8))
    quantity: Mapped[int]
    price: Mapped[Decimal] = mapped_column(MONEY)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PricePoint(Base):
    """One downsampled price per symbol per minute, the source for charts."""

    __tablename__ = "price_points"
    symbol: Mapped[str] = mapped_column(String(16), primary_key=True)
    minute_ts: Mapped[int] = mapped_column(BigInteger, primary_key=True)  # epoch minutes
    price: Mapped[Decimal] = mapped_column(MONEY)


class RefreshTokenRow(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    family_id: Mapped[str] = mapped_column(String(32), index=True)
    parent_family_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    symbol: Mapped[str] = mapped_column(String(16), primary_key=True)
    position: Mapped[int]
