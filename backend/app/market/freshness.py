from app.market.price_source import Quote

# A last trade older than this means the market is closed (or the symbol is halted): the price is a
# previous close, not something an order should be filled at.
MAX_QUOTE_AGE_S = 15 * 60


def is_stale(quote: Quote, now_ms: int, max_age_s: int = MAX_QUOTE_AGE_S) -> bool:
    return quote.as_of_ms is not None and now_ms - quote.as_of_ms > max_age_s * 1000
