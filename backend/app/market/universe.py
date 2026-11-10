from decimal import Decimal

# symbol -> starting price. These are only seeds for the simulated feed; live prices come from Finnhub.
UNIVERSE: dict[str, Decimal] = {
    "AAPL": Decimal("190.00"),
    "MSFT": Decimal("420.00"),
    "TSLA": Decimal("250.00"),
    "NVDA": Decimal("900.00"),
    "AMZN": Decimal("180.00"),
    "GOOGL": Decimal("170.00"),
    "META": Decimal("500.00"),
    "NFLX": Decimal("650.00"),
    "AMD": Decimal("160.00"),
    "INTC": Decimal("35.00"),
    "JPM": Decimal("200.00"),
    "V": Decimal("275.00"),
    "DIS": Decimal("110.00"),
    "KO": Decimal("62.00"),
    "NKE": Decimal("95.00"),
}
DEFAULT_WATCHLIST = ["AAPL", "MSFT", "TSLA"]
