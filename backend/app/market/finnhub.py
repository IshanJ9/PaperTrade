import asyncio
import itertools
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable
from decimal import ROUND_HALF_UP, Decimal

import httpx

from app.market.price_source import Quote

logger = logging.getLogger(__name__)

_CENT = Decimal("0.01")
BACKOFF_429_S = 5.0


class FinnhubPriceSource:
    """Polls Finnhub's REST /quote endpoint, one symbol per call, under a calls-per-minute budget.

    Outside US market hours Finnhub reports the last/previous-close price, so quotes keep flowing
    but do not move. ts_ms is the fetch time, which keeps the Redis TTL meaning "recently polled".
    """

    def __init__(
        self,
        api_key: str,
        client: httpx.AsyncClient,
        *,
        calls_per_min: int = 40,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._api_key = api_key
        self._client = client
        self._delay_s = 60 / calls_per_min
        self._calls_per_min = calls_per_min
        self._clock = clock
        self._sleep = sleep

    def cycle_s(self, n_symbols: int) -> float:
        return n_symbols * 60 / self._calls_per_min

    async def quotes(self, symbols: Iterable[str]) -> AsyncIterator[Quote]:
        ordered = list(symbols)
        for symbol in itertools.cycle(ordered):
            try:
                response = await self._client.get(
                    "https://finnhub.io/api/v1/quote",
                    params={"symbol": symbol},
                    headers={"X-Finnhub-Token": self._api_key},
                )
            except httpx.HTTPError as exc:
                logger.warning("finnhub request for %s failed: %s", symbol, exc)
                await self._sleep(self._delay_s)
                continue
            if response.status_code == 429:
                logger.warning("finnhub rate limit hit; backing off")
                await self._sleep(BACKOFF_429_S)
                continue
            quote = self._parse(symbol, response)
            if quote is not None:
                yield quote
            await self._sleep(self._delay_s)

    def _parse(self, symbol: str, response: httpx.Response) -> Quote | None:
        if response.status_code != 200:
            logger.warning("finnhub returned %s for %s", response.status_code, symbol)
            return None
        try:
            data = response.json()
        except ValueError:
            return None
        if not isinstance(data, dict):
            return None
        current = data.get("c")
        if isinstance(current, bool) or not isinstance(current, (int, float)) or current <= 0:
            return None
        price = Decimal(str(current)).quantize(_CENT, ROUND_HALF_UP)
        traded = data.get("t")
        as_of_ms = traded * 1000 if isinstance(traded, int) and not isinstance(traded, bool) and traded > 0 else None
        return Quote(symbol, price, int(self._clock() * 1000), as_of_ms)
