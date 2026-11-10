import asyncio
import logging
import time
from collections.abc import Awaitable, Callable, Iterable

from starlette.concurrency import run_in_threadpool

from app.market.freshness import is_stale

logger = logging.getLogger(__name__)


async def run_market_loop(
    source,
    cache,
    service,
    symbols: Iterable[str],
    recorder=None,
    *,
    retry_delay_s: float = 5.0,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> None:
    """Feed quotes into the cache, match resting orders and record history.

    One bad quote, a Redis blip or a crashing source must not end price updates for good (every order
    would then answer 503 until a restart), so each step is guarded and a crashed source is restarted.
    The loop returns only when the source ends normally; cancelling the task still stops it.
    """
    symbols = list(symbols)
    while True:
        try:
            async for quote in source.quotes(symbols):
                try:
                    await cache.put(quote)
                except Exception:
                    logger.exception("could not cache the quote for %s", quote.symbol)
                    continue
                if is_stale(quote, int(time.time() * 1000)):
                    continue  # market closed: shown to users, but never matched or charted
                try:
                    await run_in_threadpool(service.on_quote, quote)
                except Exception:
                    logger.exception("matching failed for %s", quote.symbol)
                if recorder is not None:
                    try:
                        await run_in_threadpool(recorder.record, quote)
                    except Exception:
                        logger.exception("history recording failed for %s", quote.symbol)
            return
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("price source crashed; restarting in %.0fs", retry_delay_s)
            await sleep(retry_delay_s)
