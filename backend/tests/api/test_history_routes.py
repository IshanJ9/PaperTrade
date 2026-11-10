import time
from decimal import Decimal as D

from app.db.models import PricePoint
from tests.api.conftest import auth_headers

MIN = 60_000
HOUR = 60 * MIN


def add_point(session_factory, symbol, ts_ms, price="10"):
    with session_factory() as s, s.begin():
        s.add(PricePoint(symbol=symbol, minute_ts=ts_ms // MIN, price=D(price)))


def test_history_endpoint_requires_auth_and_validates_inputs(client):
    assert client.get("/history", params={"symbol": "AAPL", "range": "1D"}).status_code == 401
    headers = auth_headers(client)
    assert client.get("/history", params={"symbol": "ZZZZ", "range": "1D"}, headers=headers).status_code == 422
    assert client.get("/history", params={"symbol": "AAPL", "range": "5Y"}, headers=headers).status_code == 422


def test_history_endpoint_returns_points_in_the_documented_shape(client, session_factory):
    headers = auth_headers(client)
    now_ms = int(time.time() * 1000)
    add_point(session_factory, "AAPL", now_ms - HOUR, "190.1234")
    add_point(session_factory, "AAPL", now_ms - 2 * HOUR, "189.00")
    body = client.get("/history", params={"symbol": "aapl", "range": "1D"}, headers=headers).json()
    assert body["symbol"] == "AAPL" and body["range"] == "1D"
    assert [p["p"] for p in body["points"]] == ["189.00", "190.12"]
    assert all(isinstance(p["t"], int) for p in body["points"])
    assert body["points"][0]["t"] < body["points"][1]["t"]


def test_history_for_a_symbol_with_no_data_is_an_empty_list(client):
    headers = auth_headers(client)
    body = client.get("/history", params={"symbol": "NKE", "range": "1M"}, headers=headers).json()
    assert body["points"] == []
