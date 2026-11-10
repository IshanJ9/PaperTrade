from decimal import Decimal

from app.domain.models import Fill, Order, OrderStatus, OrderType, Side


def try_fill(order: Order, market_price: Decimal) -> Fill | None:
    """Fill the whole order at market_price if its condition is met. No partial fills."""
    if order.status is not OrderStatus.OPEN:
        return None
    level = order.price
    if order.type is OrderType.MARKET:
        triggered = True
    elif order.type is OrderType.LIMIT:
        triggered = market_price <= level if order.side is Side.BUY else market_price >= level
    else:  # STOP
        triggered = market_price >= level if order.side is Side.BUY else market_price <= level
    if not triggered:
        return None
    return Fill(order.id, order.symbol, order.side, order.quantity, market_price)
