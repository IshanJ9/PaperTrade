from decimal import Decimal as D

from app.market.price_source import Quote
from tests.api.conftest import auth_headers


def seed(cache, symbol="AAPL", price="100"):
    cache.data[symbol] = Quote(symbol, D(price), 1)


def order_body(**overrides):
    body = {"client_order_id": "order-0001", "symbol": "AAPL", "side": "BUY", "type": "MARKET", "quantity": 10}
    body.update(overrides)
    return body


def test_market_buy_updates_portfolio_and_transactions(client, cache):
    headers = auth_headers(client)
    seed(cache)
    r = client.post("/orders", json=order_body(), headers=headers)
    assert r.status_code == 201
    assert r.json()["status"] == "FILLED"

    portfolio = client.get("/portfolio", headers=headers).json()
    assert D(portfolio["cash"]) == D("99000")
    assert portfolio["positions"][0]["symbol"] == "AAPL"
    assert D(portfolio["equity"]) == D("100000")

    seed(cache, price="110")
    portfolio = client.get("/portfolio", headers=headers).json()
    assert D(portfolio["unrealized_pnl"]) == D("100")
    assert D(portfolio["equity"]) == D("100100")

    fills = client.get("/transactions", headers=headers).json()
    assert len(fills) == 1 and fills[0]["symbol"] == "AAPL" and D(fills[0]["price"]) == D("100")


def test_no_fresh_quote_is_a_503_and_stores_nothing(client):
    headers = auth_headers(client)
    assert client.post("/orders", json=order_body(), headers=headers).status_code == 503
    assert client.get("/orders", headers=headers).json() == []


def test_invalid_orders_are_422(client, cache):
    headers = auth_headers(client)
    seed(cache)
    assert client.post("/orders", json=order_body(symbol="ZZZZ"), headers=headers).status_code == 422
    assert client.post("/orders", json=order_body(type="LIMIT"), headers=headers).status_code == 422
    assert client.post("/orders", json=order_body(quantity=0), headers=headers).status_code == 422


def test_retrying_the_same_client_order_id_does_not_double_fill(client, cache):
    headers = auth_headers(client)
    seed(cache)
    a = client.post("/orders", json=order_body(), headers=headers).json()
    b = client.post("/orders", json=order_body(), headers=headers).json()
    assert a["id"] == b["id"]
    assert D(client.get("/portfolio", headers=headers).json()["cash"]) == D("99000")


def test_cancel_resting_order_and_ownership(client, cache):
    alice, bob = auth_headers(client, "alice@example.com"), auth_headers(client, "bob@example.com")
    seed(cache)
    resting = client.post("/orders", json=order_body(type="LIMIT", price="50"), headers=alice).json()
    assert resting["status"] == "OPEN"
    assert client.delete(f"/orders/{resting['id']}", headers=bob).status_code == 404
    assert client.delete(f"/orders/{resting['id']}", headers=alice).status_code == 204
    assert client.delete(f"/orders/{resting['id']}", headers=alice).status_code == 404


def test_quotes_endpoint_returns_only_fresh_known_symbols(client, cache):
    headers = auth_headers(client)
    seed(cache, "AAPL", "190.12")
    body = client.get("/quotes", params={"symbols": "AAPL,MSFT,ZZZZ"}, headers=headers).json()
    assert body == {"AAPL": {"price": "190.12", "ts_ms": 1, "as_of_ms": None, "stale": False}}


def test_watchlist_defaults_and_updates(client):
    headers = auth_headers(client)
    assert client.get("/watchlist", headers=headers).json()["symbols"] == ["AAPL", "MSFT", "TSLA"]
    r = client.put("/watchlist", json={"symbols": ["NVDA", "AAPL", "NVDA"]}, headers=headers)
    assert r.json()["symbols"] == ["NVDA", "AAPL"]
    assert client.get("/watchlist", headers=headers).json()["symbols"] == ["NVDA", "AAPL"]
    assert client.put("/watchlist", json={"symbols": ["ZZZZ"]}, headers=headers).status_code == 422


def test_snapshot_contains_everything_the_app_caches(client, cache):
    headers = auth_headers(client)
    seed(cache)
    client.post("/orders", json=order_body(), headers=headers)
    snap = client.get("/snapshot", headers=headers).json()
    assert set(snap) == {"server_time", "portfolio", "orders", "transactions", "watchlist"}
    assert len(snap["orders"]) == 1 and len(snap["transactions"]) == 1


def test_trading_routes_require_auth(client):
    for method, path in [("get", "/portfolio"), ("get", "/snapshot"), ("post", "/orders"), ("get", "/quotes")]:
        assert getattr(client, method)(path).status_code == 401


def test_orders_are_refused_while_the_market_is_closed(client, cache):
    headers = auth_headers(client)
    cache.data["AAPL"] = Quote("AAPL", D("100"), 1, as_of_ms=1)  # last trade in 1970
    r = client.post("/orders", json=order_body(), headers=headers)
    assert r.status_code == 503
    assert "closed" in r.json()["detail"].lower()
    assert client.get("/orders", headers=headers).json() == []


def test_quotes_endpoint_flags_stale_quotes(client, cache):
    headers = auth_headers(client)
    cache.data["AAPL"] = Quote("AAPL", D("100"), 1, as_of_ms=1)
    body = client.get("/quotes", params={"symbols": "AAPL"}, headers=headers).json()
    assert body["AAPL"]["stale"] is True and body["AAPL"]["as_of_ms"] == 1
