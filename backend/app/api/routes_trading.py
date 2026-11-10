import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from starlette.concurrency import run_in_threadpool

from app.api.deps import current_user_id
from app.api.schemas import (
    FillOut,
    OrderIn,
    OrderOut,
    PortfolioOut,
    QuoteOut,
    SnapshotOut,
    WatchlistIO,
)
from app.domain.models import OrderType
from app.market.freshness import is_stale
from app.market.universe import UNIVERSE
from app.services import queries

router = APIRouter()


def _known(symbols: list[str]) -> list[str]:
    return [s for s in dict.fromkeys(symbols) if s in UNIVERSE]


@router.get("/quotes", response_model=dict[str, QuoteOut])
async def quotes(request: Request, symbols: str = Query(""), _: int = Depends(current_user_id)):
    wanted = _known([s.strip().upper() for s in symbols.split(",") if s.strip()])
    found = await request.app.state.quote_cache.get_many(wanted)
    now_ms = int(time.time() * 1000)
    return {
        s: QuoteOut(price=q.price, ts_ms=q.ts_ms, as_of_ms=q.as_of_ms, stale=is_stale(q, now_ms))
        for s, q in found.items()
    }


@router.get("/watchlist", response_model=WatchlistIO)
async def read_watchlist(request: Request, user_id: int = Depends(current_user_id)):
    def work():
        with request.app.state.session_factory() as session:
            return queries.get_watchlist(session, user_id)

    return WatchlistIO(symbols=await run_in_threadpool(work))


@router.put("/watchlist", response_model=WatchlistIO)
async def write_watchlist(body: WatchlistIO, request: Request, user_id: int = Depends(current_user_id)):
    if any(s not in UNIVERSE for s in body.symbols):
        raise HTTPException(422, "unknown symbol")

    def work():
        with request.app.state.session_factory() as session:
            return queries.set_watchlist(session, user_id, body.symbols)

    return WatchlistIO(symbols=await run_in_threadpool(work))


@router.post("/orders", status_code=201, response_model=OrderOut)
async def place_order(body: OrderIn, request: Request, user_id: int = Depends(current_user_id)):
    symbol = body.symbol.upper()
    if symbol not in UNIVERSE:
        raise HTTPException(422, "unknown symbol")
    if (body.type is OrderType.MARKET) != (body.price is None):
        raise HTTPException(422, "price is required for LIMIT/STOP and forbidden for MARKET")
    quotes_ = await request.app.state.quote_cache.get_many([symbol])
    if symbol not in quotes_:
        raise HTTPException(503, "no live price available for this symbol")
    if is_stale(quotes_[symbol], int(time.time() * 1000)):
        raise HTTPException(503, "The market is closed, so orders cannot be filled right now. Try again when it reopens.")
    try:
        order = await run_in_threadpool(
            lambda: request.app.state.trading_service.place_order(
                user_id, client_order_id=body.client_order_id, symbol=symbol, side=body.side,
                type=body.type, quantity=body.quantity, price=body.price,
                market_price=quotes_[symbol].price,
            )
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    return OrderOut.model_validate(order)


@router.delete("/orders/{order_id}", status_code=204)
async def cancel_order(order_id: int, request: Request, user_id: int = Depends(current_user_id)):
    cancelled = await run_in_threadpool(request.app.state.trading_service.cancel_order, user_id, order_id)
    if not cancelled:
        raise HTTPException(404, "no open order with that id")
    return Response(status_code=204)


@router.get("/orders", response_model=list[OrderOut])
async def orders(request: Request, limit: int = Query(50, ge=1, le=200), user_id: int = Depends(current_user_id)):
    def work():
        with request.app.state.session_factory() as session:
            return queries.list_orders(session, user_id, limit)

    return await run_in_threadpool(work)


@router.get("/transactions", response_model=list[FillOut])
async def transactions(request: Request, limit: int = Query(50, ge=1, le=500), user_id: int = Depends(current_user_id)):
    def work():
        with request.app.state.session_factory() as session:
            return queries.list_fills(session, user_id, limit)

    return await run_in_threadpool(work)


@router.get("/portfolio", response_model=PortfolioOut)
async def portfolio(request: Request, user_id: int = Depends(current_user_id)):
    quotes_ = await request.app.state.quote_cache.get_many(UNIVERSE)

    def work():
        with request.app.state.session_factory() as session:
            return queries.portfolio_view(session, user_id, quotes_)

    return await run_in_threadpool(work)


@router.get("/snapshot", response_model=SnapshotOut)
async def snapshot(request: Request, user_id: int = Depends(current_user_id)):
    quotes_ = await request.app.state.quote_cache.get_many(UNIVERSE)

    def work():
        with request.app.state.session_factory() as session:
            return SnapshotOut(
                server_time=datetime.now(timezone.utc),
                portfolio=queries.portfolio_view(session, user_id, quotes_),
                orders=queries.list_orders(session, user_id, 100),
                transactions=queries.list_fills(session, user_id, 200),
                watchlist=queries.get_watchlist(session, user_id),
            )

    return await run_in_threadpool(work)
