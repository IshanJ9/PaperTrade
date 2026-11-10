import asyncio
from collections.abc import Iterable
from decimal import Decimal

from redis.asyncio import Redis

from app.market.price_source import Quote


class QuoteCache:
    def __init__(self, redis: Redis, ttl_s: int = 30) -> None:
        self._redis = redis
        self._ttl_s = ttl_s

    @staticmethod
    def _key(symbol: str) -> str:
        return f"quote:{symbol}"

    async def put(self, quote: Quote) -> None:
        key = self._key(quote.symbol)
        async with self._redis.pipeline(transaction=False) as pipe:
            mapping = {"price": str(quote.price), "ts": quote.ts_ms}
            if quote.as_of_ms is not None:
                mapping["as_of"] = quote.as_of_ms
            pipe.delete(key)  # drop a stale "as_of" left by an earlier quote
            pipe.hset(key, mapping=mapping)
            pipe.expire(key, self._ttl_s)
            await pipe.execute()

    async def get_many(self, symbols: Iterable[str]) -> dict[str, Quote]:
        symbols = list(symbols)
        rows = await asyncio.gather(*(self._redis.hgetall(self._key(s)) for s in symbols))
        return {
            s: Quote(s, Decimal(row["price"]), int(row["ts"]), int(row["as_of"]) if "as_of" in row else None)
            for s, row in zip(symbols, rows)
            if row
        }
