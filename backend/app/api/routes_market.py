import time
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.api.deps import current_user_id
from app.market.history import RANGES, read_history
from app.market.universe import UNIVERSE

router = APIRouter()
_CENT = Decimal("0.01")


class HistoryPointOut(BaseModel):
    t: int
    p: Decimal


class HistoryOut(BaseModel):
    symbol: str
    range: str
    points: list[HistoryPointOut]


@router.get("/history", response_model=HistoryOut)
async def history(
    request: Request,
    symbol: str = Query(...),
    range: str = Query("1D"),
    _: int = Depends(current_user_id),
):
    symbol = symbol.upper()
    if symbol not in UNIVERSE:
        raise HTTPException(422, "unknown symbol")
    if range not in RANGES:
        raise HTTPException(422, f"range must be one of {', '.join(RANGES)}")
    now_ms = int(time.time() * 1000)

    def work():
        with request.app.state.session_factory() as session:
            return read_history(session, symbol, range, now_ms)

    points = await run_in_threadpool(work)
    return HistoryOut(
        symbol=symbol,
        range=range,
        points=[HistoryPointOut(t=t, p=p.quantize(_CENT, ROUND_HALF_UP)) for t, p in points],
    )
