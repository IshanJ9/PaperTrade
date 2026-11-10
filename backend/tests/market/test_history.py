import time
from decimal import Decimal as D

import pytest
from sqlalchemy import func, select

from app.db.models import PricePoint
from app.market.history import (
    RANGES,
    HistoryRecorder,
    downsample,
    prune_history,
    read_history,
    run_history_maintenance,
    seed_simulated_history,
)
from app.market.price_source import Quote

MIN = 60_000
HOUR = 60 * MIN
DAY = 24 * HOUR


# ---- downsample ------------------------------------------------------------------------------

def test_downsample_small_input_is_unchanged():
    pts = [(i, D(i)) for i in range(1, 11)]
    assert downsample(pts, 200) == pts


def test_downsample_keeps_first_and_last_and_caps_length():
    pts = [(i, D(i)) for i in range(1, 1001)]
    out = downsample(pts, 200)
    assert out[0] == pts[0] and out[-1] == pts[-1]
    assert len(out) <= 200
    times = [t for t, _ in out]
    assert times == sorted(set(times))


def test_downsample_handles_empty_single_and_identical_timestamps():
    assert downsample([], 10) == []
    assert downsample([(5, D(1))], 10) == [(5, D(1))]
    same_time = [(5, D(i)) for i in range(50)]
    out = downsample(same_time, 10)
    assert len(out) == 1 and out[0][0] == 5


# ---- recorder --------------------------------------------------------------------------------

def points(session_factory):
    with session_factory() as s:
        return list(s.scalars(select(PricePoint).order_by(PricePoint.minute_ts)))


def test_recorder_upserts_the_same_minute_and_throttles(session_factory):
    now = [1_000.0]
    rec = HistoryRecorder(session_factory, throttle_s=15, clock=lambda: now[0])
    base_ms = 1_700_000_000_000
    assert rec.record(Quote("AAPL", D("100.00"), base_ms)) is True
    now[0] += 5
    assert rec.record(Quote("AAPL", D("101.00"), base_ms + 5_000)) is False  # throttled
    now[0] += 20
    assert rec.record(Quote("AAPL", D("102.00"), base_ms + 25_000)) is True  # same minute: overwrites
    rows = points(session_factory)
    assert len(rows) == 1 and rows[0].price == D("102.00")
    now[0] += 20
    assert rec.record(Quote("MSFT", D("5.00"), base_ms)) is True  # throttle is per symbol
    assert len(points(session_factory)) == 2


# ---- read / prune / seed ---------------------------------------------------------------------

def add_point(session_factory, symbol, ts_ms, price="10"):
    with session_factory() as s, s.begin():
        s.add(PricePoint(symbol=symbol, minute_ts=ts_ms // MIN, price=D(price)))


def test_history_ranges_filter_by_age(session_factory):
    now = 1_700_000_000_000
    add_point(session_factory, "AAPL", now - 2 * HOUR)
    add_point(session_factory, "AAPL", now - 3 * DAY)
    add_point(session_factory, "AAPL", now - 20 * DAY)
    with session_factory() as s:
        assert len(read_history(s, "AAPL", "1D", now)) == 1
        assert len(read_history(s, "AAPL", "1W", now)) == 2
        assert len(read_history(s, "AAPL", "1M", now)) == 3
        assert read_history(s, "MSFT", "1M", now) == []
    assert set(RANGES) == {"1D", "1W", "1M"}


def test_prune_removes_only_old_rows(session_factory):
    now = 1_700_000_000_000
    add_point(session_factory, "AAPL", now - 40 * DAY)
    add_point(session_factory, "AAPL", now - 1 * DAY)
    with session_factory() as s:
        assert prune_history(s, now - 35 * DAY) == 1
    assert len(points(session_factory)) == 1


def test_seed_runs_once_and_is_deterministic(session_factory):
    now = 1_700_000_000_000
    start = {"AAPL": D("190.00"), "MSFT": D("420.00")}
    inserted = seed_simulated_history(session_factory, start, now, days=2)
    assert inserted == 2 * 2 * 288
    assert seed_simulated_history(session_factory, start, now, days=2) == 0  # table not empty
    first = [(p.symbol, p.minute_ts, p.price) for p in points(session_factory)]
    with session_factory() as s, s.begin():
        s.query(PricePoint).delete()
    seed_simulated_history(session_factory, start, now, days=2)
    assert first == [(p.symbol, p.minute_ts, p.price) for p in points(session_factory)]
    assert all(p.price >= D("0.01") for p in points(session_factory))


async def test_maintenance_prunes_old_rows_then_sleeps(session_factory):
    add_point(session_factory, "AAPL", 0)  # 1970: far older than 35 days
    add_point(session_factory, "AAPL", int(time.time() * 1000))
    slept: list[float] = []

    class Stop(Exception):
        pass

    async def fake_sleep(seconds):
        slept.append(seconds)
        raise Stop

    with pytest.raises(Stop):
        await run_history_maintenance(session_factory, interval_s=3600, sleep=fake_sleep)
    assert slept == [3600]
    assert len(points(session_factory)) == 1


def test_seeded_history_ends_at_the_symbols_start_price(session_factory):
    # The live simulated feed starts from the same price, so the chart must not jump where history meets live data.
    now = 1_700_000_000_000
    seed_simulated_history(session_factory, {"AAPL": D("190.00"), "MSFT": D("420.00")}, now, days=3)
    for symbol, expected in (("AAPL", D("190.00")), ("MSFT", D("420.00"))):
        with session_factory() as s:
            last = s.scalar(
                select(PricePoint.price).where(PricePoint.symbol == symbol).order_by(PricePoint.minute_ts.desc()).limit(1)
            )
        assert abs(last - expected) <= D("0.01")
