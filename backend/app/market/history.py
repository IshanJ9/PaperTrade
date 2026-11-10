import asyncio
import logging
import random
import time
from collections.abc import Awaitable, Callable, Mapping
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, sessionmaker
from starlette.concurrency import run_in_threadpool

from app.db.models import PricePoint
from app.market.price_source import Quote

logger = logging.getLogger(__name__)

MINUTE_MS = 60_000
RANGES = {"1D": 24 * 3600 * 1000, "1W": 7 * 86400 * 1000, "1M": 30 * 86400 * 1000}
RETENTION_MS = 35 * 86400 * 1000
_CENT = Decimal("0.01")

Point = tuple[int, Decimal]  # (epoch milliseconds, price)


def downsample(points: list[Point], max_points: int = 200) -> list[Point]:
    """Reduce a time-sorted series to at most max_points, keeping the first and last point and the
    last point of each evenly sized time slice in between."""
    if len(points) <= max_points:
        return list(points)
    first, last = points[0], points[-1]
    if first[0] == last[0]:
        return [last]
    slots = max(max_points - 2, 1)
    span = last[0] - first[0]
    chosen: dict[int, Point] = {}
    for t, price in points[1:-1]:
        chosen[min(int((t - first[0]) * slots / span), slots - 1)] = (t, price)
    merged = {first[0]: first}
    for idx in sorted(chosen):
        merged[chosen[idx][0]] = chosen[idx]
    merged[last[0]] = last
    return [merged[t] for t in sorted(merged)]


class HistoryRecorder:
    """Writes at most one point per symbol every throttle_s seconds; same-minute writes overwrite."""

    def __init__(
        self,
        session_factory: sessionmaker[Session],
        *,
        throttle_s: float = 15,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._session_factory = session_factory
        self._throttle_s = throttle_s
        self._clock = clock
        self._last_write: dict[str, float] = {}

    def record(self, quote: Quote) -> bool:
        now = self._clock()
        last = self._last_write.get(quote.symbol)
        if last is not None and now - last < self._throttle_s:
            return False
        stmt = insert(PricePoint).values(
            symbol=quote.symbol, minute_ts=quote.ts_ms // MINUTE_MS, price=quote.price
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[PricePoint.symbol, PricePoint.minute_ts], set_={"price": stmt.excluded.price}
        )
        with self._session_factory() as session, session.begin():
            session.execute(stmt)
        self._last_write[quote.symbol] = now
        return True


def read_history(session: Session, symbol: str, range_key: str, now_ms: int) -> list[Point]:
    cutoff = (now_ms - RANGES[range_key]) // MINUTE_MS
    rows = session.execute(
        select(PricePoint.minute_ts, PricePoint.price)
        .where(PricePoint.symbol == symbol, PricePoint.minute_ts >= cutoff)
        .order_by(PricePoint.minute_ts)
    )
    return downsample([(minute * MINUTE_MS, price) for minute, price in rows])


def prune_history(session: Session, older_than_ms: int) -> int:
    result = session.execute(delete(PricePoint).where(PricePoint.minute_ts < older_than_ms // MINUTE_MS))
    session.commit()
    return result.rowcount


def seed_simulated_history(
    session_factory: sessionmaker[Session],
    start: Mapping[str, Decimal],
    now_ms: int,
    days: int = 7,
    seed: int = 42,
) -> int:
    """Fill an empty table with a deterministic 5-minute random walk so charts work on day one.
    Only meant for the simulated price source; returns the number of rows inserted."""
    with session_factory() as session, session.begin():
        if session.scalar(select(func.count()).select_from(PricePoint)):
            return 0
        rng = random.Random(seed)
        steps = days * 288
        end_minute = now_ms // MINUTE_MS
        rows = []
        for symbol in sorted(start):
            walk = []
            price = start[symbol]
            for _ in range(steps):
                price = price * Decimal(str(1 + (rng.random() - 0.5) * 0.01))
                walk.append(price)
            # Rescale so the walk ENDS at the start price: the live simulated feed starts there too,
            # and the chart must not jump where the history meets live data.
            scale = start[symbol] / walk[-1]
            for i, value in enumerate(walk):
                rows.append(
                    {
                        "symbol": symbol,
                        "minute_ts": end_minute - (steps - 1 - i) * 5,
                        "price": max((value * scale).quantize(_CENT, ROUND_HALF_UP), _CENT),
                    }
                )
        session.execute(insert(PricePoint), rows)
        return len(rows)


async def run_history_maintenance(
    session_factory: sessionmaker[Session],
    *,
    interval_s: float = 3600,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    clock: Callable[[], float] = time.time,
) -> None:
    """Delete points older than the retention window, then repeat every interval_s."""
    while True:
        try:
            cutoff = int(clock() * 1000) - RETENTION_MS

            def work() -> int:
                with session_factory() as session:
                    return prune_history(session, cutoff)

            removed = await run_in_threadpool(work)
            if removed:
                logger.info("pruned %d old price points", removed)
        except Exception:
            logger.exception("history pruning failed")
        await sleep(interval_s)
