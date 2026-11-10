import asyncio
import random
import time
from collections.abc import AsyncIterator, Callable, Iterable, Mapping
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Protocol

_CENT = Decimal("0.01")


@dataclass(frozen=True)
class Quote:
    symbol: str
    price: Decimal
    ts_ms: int
    # When the price was last traded (provider's clock). None for sources that cannot tell (the simulator).
    as_of_ms: int | None = None


class PriceSource(Protocol):
    def quotes(self, symbols: Iterable[str]) -> AsyncIterator[Quote]: ...


class SimulatedPriceSource:
    def __init__(
        self,
        start: Mapping[str, Decimal],
        seed: int = 42,
        tick_s: float = 1.0,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._start = dict(start)
        self._seed = seed
        self._tick_s = tick_s
        self._clock = clock

    async def quotes(self, symbols: Iterable[str]) -> AsyncIterator[Quote]:
        ordered = sorted(symbols)
        rng = random.Random(self._seed)
        prices = {s: self._start[s] for s in ordered}
        while True:
            for symbol in ordered:
                factor = Decimal(str(1 + (rng.random() - 0.5) * 0.004))
                price = (prices[symbol] * factor).quantize(_CENT, ROUND_HALF_UP)
                prices[symbol] = max(price, _CENT)
                yield Quote(symbol, prices[symbol], int(self._clock() * 1000))
            await asyncio.sleep(self._tick_s)
