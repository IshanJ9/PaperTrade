# PaperTrade (React Native + FastAPI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cross-platform paper-trading app. A React Native (TypeScript) client talks to a FastAPI backend that owns accounts, orders, fills and P&L in PostgreSQL, caches market quotes in Redis, and authenticates with JWT. The client keeps an SQLite copy of the user's data so it opens offline, and syncs in the background.

**Architecture:** The backend is server-authoritative. A pure-Python `domain` package (orders, matcher, portfolio, matching engine) has no framework imports and is unit-tested first. A market loop pulls quotes from a `PriceSource` (simulated now, real later), writes them to Redis, and runs the matching engine for users with resting orders. REST endpoints serve the app; one `GET /snapshot` call returns everything the app needs to refresh its SQLite cache. The mobile app reads from SQLite and writes through the API using idempotency keys.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 (sync) + psycopg 3, PostgreSQL 16, Redis 7, PyJWT, argon2-cffi, pytest, fakeredis, uv, Docker Compose. Mobile: Expo (React Native, TypeScript), expo-sqlite, expo-secure-store, React Navigation, Jest.

**Spec:** No separate spec. Scope is the "Scope" section below. This plan replaces `2026-10-29-papertrade.md` (native Android).

## Global Constraints

- Backend Python is pinned to 3.12 (`requires-python = ">=3.12,<3.13"`). The machine has 3.14, which many binary wheels do not support yet; `uv` installs 3.12 alongside it.
- Money and prices are `Decimal` in Python and **strings** in JSON and TypeScript. Never use floats for money. The app only displays them; all arithmetic happens on the server.
- Postgres columns for money are `Numeric(18, 4)`.
- `app/domain/` must not import FastAPI, SQLAlchemy, Redis or Pydantic.
- Orders are filled by the server only, at the latest Redis quote. If no fresh quote exists (TTL 30 s), the order endpoint returns 503; it never fills at a stale or invented price.
- Every order request carries a client-generated `client_order_id`; the server treats a repeat of the same id for the same user as the same order.
- No short selling. No cash reservation for resting BUY orders: affordability is checked at fill time and an unaffordable fill marks the order `REJECTED`.
- Starting cash: `100000.00`.
- Secrets come from environment variables (`PT_JWT_SECRET`, etc.) loaded from an untracked `backend/.env`. The Postgres and Redis credentials in `docker-compose.yml` are local-development defaults only.
- Passwords are stored as argon2 hashes. Login failures return the same message whether the email or the password was wrong.
- Library versions: let `uv add` and `npx expo install` choose current compatible versions.

## Scope

**Now (Phase 1, ~2.5 to 3 weeks):** Tasks 1 to 13. At the end: register and log in, simulated live prices flowing through Redis, personal watchlist, market/limit/stop orders (resting orders fill when price crosses), portfolio and transaction history with P&L, and an app that shows cached data offline and syncs when online. Runs on Android (emulator or phone) and on an iPhone via Expo Go.

**As time permits:** see the end of the file. Several things your resume entry claims are not in Phase 1; see "Resume claim checklist".

## File Structure

```
docker-compose.yml                 postgres + redis (local dev)
docker/initdb/01-test-db.sql       creates papertrade_test
backend/
  pyproject.toml
  app/
    config.py                      Settings (env)
    main.py                        create_app(...), lifespan
    domain/  models.py matcher.py portfolio.py state.py engine.py
    market/  universe.py price_source.py quote_cache.py loop.py
    db/      models.py repository.py
    services/ trading.py queries.py
    auth/    security.py
    api/     deps.py schemas.py routes_auth.py routes_trading.py
  tests/
    conftest.py helpers.py
    domain/ market/ db/ services/ auth/ api/
mobile/
  src/
    api/ types.ts client.ts
    orders/ validate.ts
    sync/ syncer.ts sqliteStore.ts
    auth/ tokenStorage.ts
    screens/ ...
    __tests__/ validate.test.ts syncer.test.ts
```

---

## Backend

### Task 1: Backend scaffold, Docker services, health check

**Files:**
- Create: `docker-compose.yml`, `docker/initdb/01-test-db.sql`, `backend/pyproject.toml`, `backend/app/__init__.py`, `backend/app/main.py`, `backend/tests/__init__.py`, `.gitignore`
- Test: `backend/tests/test_health.py`

**Interfaces:**
- Produces: `create_app() -> FastAPI` with `GET /health -> {"status": "ok"}` (extended in later tasks); running Postgres on `localhost:5432` (databases `papertrade`, `papertrade_test`, user/password `papertrade`) and Redis on `localhost:6379`.

- [ ] **Step 1: Write the infrastructure files**

`docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: papertrade
      POSTGRES_PASSWORD: papertrade
      POSTGRES_DB: papertrade
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/initdb:/docker-entrypoint-initdb.d:ro
  redis:
    image: redis:7
    ports: ["6379:6379"]
volumes:
  pgdata: {}
```

`docker/initdb/01-test-db.sql`:

```sql
CREATE DATABASE papertrade_test OWNER papertrade;
```

`.gitignore` (repo root):

```
.env
__pycache__/
.venv/
node_modules/
.expo/
*.pyc
```

`backend/pyproject.toml`:

```toml
[project]
name = "papertrade-backend"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
dependencies = [
  "fastapi",
  "uvicorn[standard]",
  "sqlalchemy>=2",
  "psycopg[binary]",
  "pydantic-settings",
  "email-validator",
  "pyjwt",
  "argon2-cffi",
  "redis",
]

[dependency-groups]
dev = ["pytest", "pytest-asyncio", "httpx", "fakeredis"]

[tool.uv]
package = false

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
asyncio_mode = "auto"
```

- [ ] **Step 2: Install and start services**

Run (from repo root):

```bash
git init
docker compose up -d
cd backend
uv python install 3.12
uv sync
```

Expected: `docker compose ps` shows postgres and redis running; `uv sync` finishes without errors.

- [ ] **Step 3: Write the failing test**

`backend/tests/test_health.py`:

```python
from fastapi.testclient import TestClient

from app.main import create_app


def test_health():
    client = TestClient(create_app())
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd backend; uv run pytest tests/test_health.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'app.main'`).

- [ ] **Step 5: Implement**

`backend/app/__init__.py` and `backend/tests/__init__.py`: empty files. (Every `tests/` subfolder in later tasks also gets an empty `__init__.py`, so `from tests.helpers import ...` resolves.)

`backend/app/main.py`:

```python
from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="PaperTrade")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
```

- [ ] **Step 6: Run to verify it passes**

Run: `uv run pytest tests/test_health.py -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: backend scaffold with docker services and health check"
```

---

### Task 2: Order models and the single-order matcher

**Files:**
- Create: `backend/app/domain/__init__.py`, `models.py`, `matcher.py`
- Test: `backend/tests/domain/test_matcher.py`

**Interfaces:**
- Produces:
  - `Side`, `OrderType`, `OrderStatus` (str Enums with values equal to member names)
  - `Order(id: int, symbol: str, side: Side, type: OrderType, quantity: int, price: Decimal | None = None, status: OrderStatus = OPEN)`, frozen dataclass; `price` is the limit price (LIMIT), trigger price (STOP), `None` for MARKET; invalid combinations raise `ValueError`
  - `Fill(order_id: int, symbol: str, side: Side, quantity: int, price: Decimal)`
  - `try_fill(order: Order, market_price: Decimal) -> Fill | None`

- [ ] **Step 1: Write the failing tests**

`backend/tests/domain/test_matcher.py` (also create empty `backend/tests/domain/__init__.py`):

```python
from decimal import Decimal as D

import pytest

from app.domain.matcher import try_fill
from app.domain.models import Order, OrderStatus, OrderType, Side

BUY, SELL = Side.BUY, Side.SELL
MARKET, LIMIT, STOP = OrderType.MARKET, OrderType.LIMIT, OrderType.STOP


def order(side, type_, price, status=OrderStatus.OPEN):
    return Order(1, "AAPL", side, type_, 10, None if price is None else D(price), status)


def test_market_order_fills_at_market_price():
    fill = try_fill(order(BUY, MARKET, None), D("150.25"))
    assert fill is not None
    assert fill.price == D("150.25")
    assert fill.quantity == 10


def test_limit_buy_fills_at_or_below_limit_at_market_price():
    assert try_fill(order(BUY, LIMIT, "100"), D("100.01")) is None
    assert try_fill(order(BUY, LIMIT, "100"), D("100")).price == D("100")
    assert try_fill(order(BUY, LIMIT, "100"), D("98.50")).price == D("98.50")


def test_limit_sell_fills_at_or_above_limit():
    assert try_fill(order(SELL, LIMIT, "100"), D("99.99")) is None
    assert try_fill(order(SELL, LIMIT, "100"), D("101")).price == D("101")


def test_stop_sell_triggers_at_or_below_and_fills_at_gapped_price():
    assert try_fill(order(SELL, STOP, "95"), D("95.01")) is None
    assert try_fill(order(SELL, STOP, "95"), D("95")).price == D("95")
    assert try_fill(order(SELL, STOP, "95"), D("90")).price == D("90")


def test_stop_buy_triggers_at_or_above():
    assert try_fill(order(BUY, STOP, "105"), D("104.99")) is None
    assert try_fill(order(BUY, STOP, "105"), D("108")).price == D("108")


def test_non_open_orders_never_fill():
    assert try_fill(order(BUY, MARKET, None, OrderStatus.CANCELLED), D("1")) is None


def test_market_order_with_price_is_invalid():
    with pytest.raises(ValueError):
        order(BUY, MARKET, "10")


def test_limit_order_without_price_is_invalid():
    with pytest.raises(ValueError):
        order(BUY, LIMIT, None)


def test_non_positive_price_or_quantity_is_invalid():
    with pytest.raises(ValueError):
        order(BUY, LIMIT, "0")
    with pytest.raises(ValueError):
        Order(1, "AAPL", BUY, MARKET, 0)
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/domain/test_matcher.py -v`
Expected: FAIL (`ModuleNotFoundError: app.domain`).

- [ ] **Step 3: Implement**

`backend/app/domain/__init__.py`: empty.

`backend/app/domain/models.py`:

```python
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum


class Side(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class OrderType(str, Enum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"
    STOP = "STOP"


class OrderStatus(str, Enum):
    OPEN = "OPEN"
    FILLED = "FILLED"
    CANCELLED = "CANCELLED"
    REJECTED = "REJECTED"


@dataclass(frozen=True)
class Order:
    id: int
    symbol: str
    side: Side
    type: OrderType
    quantity: int
    price: Decimal | None = None
    status: OrderStatus = OrderStatus.OPEN

    def __post_init__(self) -> None:
        if self.quantity <= 0:
            raise ValueError("quantity must be positive")
        if (self.type is OrderType.MARKET) != (self.price is None):
            raise ValueError("price is required for LIMIT/STOP and forbidden for MARKET")
        if self.price is not None and self.price <= 0:
            raise ValueError("price must be positive")


@dataclass(frozen=True)
class Fill:
    order_id: int
    symbol: str
    side: Side
    quantity: int
    price: Decimal
```

`backend/app/domain/matcher.py`:

```python
from decimal import Decimal

from app.domain.models import Fill, Order, OrderStatus, OrderType, Side


def try_fill(order: Order, market_price: Decimal) -> Fill | None:
    """Fill the whole order at market_price if its condition is met. No partial fills."""
    if order.status is not OrderStatus.OPEN:
        return None
    level = order.price
    if order.type is OrderType.MARKET:
        triggered = True
    elif order.type is OrderType.LIMIT:
        triggered = market_price <= level if order.side is Side.BUY else market_price >= level
    else:  # STOP
        triggered = market_price >= level if order.side is Side.BUY else market_price <= level
    if not triggered:
        return None
    return Fill(order.id, order.symbol, order.side, order.quantity, market_price)
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/domain/test_matcher.py -v`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(domain): order models and single-order matcher"
```

---

### Task 3: Portfolio and P&L

**Files:**
- Create: `backend/app/domain/portfolio.py`
- Test: `backend/tests/domain/test_portfolio.py`

**Interfaces:**
- Consumes: `Fill`, `Side`.
- Produces:
  - `Position(symbol: str, quantity: int, avg_cost: Decimal)`
  - `Portfolio(cash: Decimal, positions: Mapping[str, Position] = {}, realized_pnl: Decimal = 0)` frozen; `apply_fill(fill) -> Portfolio`, `unrealized_pnl(prices: Mapping[str, Decimal]) -> Decimal`, `equity(prices) -> Decimal`
  - `InsufficientFunds`, `InsufficientShares` (both `Exception`)

- [ ] **Step 1: Write the failing tests**

`backend/tests/domain/test_portfolio.py`:

```python
from decimal import Decimal as D

import pytest

from app.domain.models import Fill, Side
from app.domain.portfolio import InsufficientFunds, InsufficientShares, Portfolio

START = Portfolio(cash=D("10000"))


def fill(side, qty, price):
    return Fill(1, "AAPL", side, qty, D(price))


def test_buy_reduces_cash_and_opens_position():
    p = START.apply_fill(fill(Side.BUY, 10, "100"))
    assert p.cash == D("9000")
    assert p.positions["AAPL"].quantity == 10
    assert p.positions["AAPL"].avg_cost == D("100")


def test_second_buy_averages_cost():
    p = START.apply_fill(fill(Side.BUY, 10, "100")).apply_fill(fill(Side.BUY, 10, "110"))
    assert p.positions["AAPL"].quantity == 20
    assert p.positions["AAPL"].avg_cost == D("105")


def test_buy_beyond_cash_is_rejected():
    with pytest.raises(InsufficientFunds):
        START.apply_fill(fill(Side.BUY, 101, "100"))


def test_partial_sell_realizes_pnl_on_sold_shares_only():
    p = START.apply_fill(fill(Side.BUY, 20, "100")).apply_fill(fill(Side.SELL, 5, "120"))
    assert p.positions["AAPL"].quantity == 15
    assert p.positions["AAPL"].avg_cost == D("100")
    assert p.realized_pnl == D("100")  # (120 - 100) * 5
    assert p.cash == D("8600")  # 10000 - 2000 + 600


def test_selling_whole_position_removes_it():
    p = START.apply_fill(fill(Side.BUY, 10, "100")).apply_fill(fill(Side.SELL, 10, "90"))
    assert "AAPL" not in p.positions
    assert p.realized_pnl == D("-100")
    assert p.cash == D("9900")


def test_selling_more_than_held_is_rejected():
    p = START.apply_fill(fill(Side.BUY, 5, "100"))
    with pytest.raises(InsufficientShares):
        p.apply_fill(fill(Side.SELL, 6, "100"))


def test_selling_with_no_position_is_rejected():
    with pytest.raises(InsufficientShares):
        START.apply_fill(fill(Side.SELL, 1, "100"))


def test_unrealized_pnl_and_equity_use_current_prices():
    p = START.apply_fill(fill(Side.BUY, 10, "100"))
    prices = {"AAPL": D("110")}
    assert p.unrealized_pnl(prices) == D("100")
    assert p.equity(prices) == D("10100")


def test_original_portfolio_is_not_mutated():
    START.apply_fill(fill(Side.BUY, 10, "100"))
    assert START.cash == D("10000")
    assert START.positions == {}
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/domain/test_portfolio.py -v`
Expected: FAIL (`ModuleNotFoundError: app.domain.portfolio`).

- [ ] **Step 3: Implement**

```python
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from decimal import ROUND_HALF_UP, Decimal

from app.domain.models import Fill, Side

ZERO = Decimal("0")
AVG_COST_QUANTUM = Decimal("0.0001")


class InsufficientFunds(Exception):
    pass


class InsufficientShares(Exception):
    pass


@dataclass(frozen=True)
class Position:
    symbol: str
    quantity: int
    avg_cost: Decimal


@dataclass(frozen=True)
class Portfolio:
    cash: Decimal
    positions: Mapping[str, Position] = field(default_factory=dict)
    realized_pnl: Decimal = ZERO

    def apply_fill(self, fill: Fill) -> "Portfolio":
        return self._buy(fill) if fill.side is Side.BUY else self._sell(fill)

    def _buy(self, fill: Fill) -> "Portfolio":
        cost = fill.price * fill.quantity
        if cost > self.cash:
            raise InsufficientFunds(f"need {cost}, have {self.cash}")
        old = self.positions.get(fill.symbol)
        old_qty = old.quantity if old else 0
        old_value = (old.avg_cost if old else ZERO) * old_qty
        new_qty = old_qty + fill.quantity
        new_avg = ((old_value + cost) / new_qty).quantize(AVG_COST_QUANTUM, ROUND_HALF_UP)
        return replace(
            self,
            cash=self.cash - cost,
            positions={**self.positions, fill.symbol: Position(fill.symbol, new_qty, new_avg)},
        )

    def _sell(self, fill: Fill) -> "Portfolio":
        old = self.positions.get(fill.symbol)
        if old is None or old.quantity < fill.quantity:
            held = old.quantity if old else 0
            raise InsufficientShares(f"cannot sell {fill.quantity} {fill.symbol}, hold {held}")
        remaining = old.quantity - fill.quantity
        positions = {k: v for k, v in self.positions.items() if k != fill.symbol}
        if remaining:
            positions[fill.symbol] = replace(old, quantity=remaining)
        return replace(
            self,
            cash=self.cash + fill.price * fill.quantity,
            realized_pnl=self.realized_pnl + (fill.price - old.avg_cost) * fill.quantity,
            positions=positions,
        )

    def unrealized_pnl(self, prices: Mapping[str, Decimal]) -> Decimal:
        return sum(
            ((prices[p.symbol] - p.avg_cost) * p.quantity for p in self.positions.values()),
            ZERO,
        )

    def equity(self, prices: Mapping[str, Decimal]) -> Decimal:
        return self.cash + sum(
            (prices[p.symbol] * p.quantity for p in self.positions.values()), ZERO
        )
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/domain -v`
Expected: PASS (all domain tests so far).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(domain): portfolio with average cost and realized/unrealized P&L"
```

---

### Task 4: Matching engine

**Files:**
- Create: `backend/app/domain/state.py`, `backend/app/domain/engine.py`
- Test: `backend/tests/domain/test_engine.py`

**Interfaces:**
- Consumes: `Order`, `Fill`, `OrderStatus`, `try_fill`, `Portfolio`, `InsufficientFunds`, `InsufficientShares`.
- Produces:
  - `TradingState(portfolio: Portfolio, orders: list[Order] = [], fills: list[Fill] = [])`, frozen. `orders` are the orders being worked (open ones on input; with updated statuses on output); `fills` are fills produced.
  - `MatchingEngine.process(state, symbol, price) -> TradingState`: handles orders for `symbol` in list order; returns the **same object** when nothing changed.

- [ ] **Step 1: Write the failing tests**

```python
from decimal import Decimal as D

from app.domain.engine import MatchingEngine
from app.domain.models import Order, OrderStatus, OrderType, Side
from app.domain.portfolio import Portfolio, Position
from app.domain.state import TradingState

BUY, SELL = Side.BUY, Side.SELL
MARKET, LIMIT, STOP = OrderType.MARKET, OrderType.LIMIT, OrderType.STOP
engine = MatchingEngine()


def order(id_, side, type_, qty, price, symbol="AAPL"):
    return Order(id_, symbol, side, type_, qty, None if price is None else D(price))


def state(cash="10000", orders=(), positions=None):
    return TradingState(Portfolio(D(cash), positions or {}), list(orders))


def test_resting_limit_buy_fills_on_a_later_tick():
    s0 = state(orders=[order(1, BUY, LIMIT, 10, "100")])
    s1 = engine.process(s0, "AAPL", D("101"))
    assert s1 is s0
    s2 = engine.process(s1, "AAPL", D("99.50"))
    assert s2.orders[0].status is OrderStatus.FILLED
    assert s2.portfolio.cash == D("9005.00")
    assert len(s2.fills) == 1


def test_stop_loss_gapping_through_fills_at_gapped_price():
    held = {"AAPL": Position("AAPL", 10, D("100"))}
    s = engine.process(state("0", [order(1, SELL, STOP, 10, "95")], held), "AAPL", D("90"))
    assert s.orders[0].status is OrderStatus.FILLED
    assert s.portfolio.cash == D("900")
    assert s.portfolio.realized_pnl == D("-100")


def test_unaffordable_fill_is_rejected_and_portfolio_unchanged():
    s0 = state("100", [order(1, BUY, MARKET, 10, None)])
    s1 = engine.process(s0, "AAPL", D("50"))
    assert s1.orders[0].status is OrderStatus.REJECTED
    assert s1.portfolio.cash == D("100")
    assert s1.fills == []


def test_selling_unheld_shares_is_rejected():
    s = engine.process(state("100", [order(1, SELL, MARKET, 1, None)]), "AAPL", D("50"))
    assert s.orders[0].status is OrderStatus.REJECTED


def test_ticks_for_other_symbols_do_not_touch_orders():
    s0 = state(orders=[order(1, BUY, MARKET, 1, None, symbol="MSFT")])
    assert engine.process(s0, "AAPL", D("1")) is s0


def test_fills_are_recorded_in_order_sequence():
    s = engine.process(
        state(orders=[order(1, BUY, MARKET, 1, None), order(2, BUY, MARKET, 1, None)]),
        "AAPL",
        D("10"),
    )
    assert [f.order_id for f in s.fills] == [1, 2]


def test_already_filled_orders_are_not_filled_again():
    s1 = engine.process(state(orders=[order(1, BUY, MARKET, 1, None)]), "AAPL", D("10"))
    s2 = engine.process(s1, "AAPL", D("10"))
    assert s2 is s1
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/domain/test_engine.py -v`
Expected: FAIL (`ModuleNotFoundError: app.domain.engine`).

- [ ] **Step 3: Implement**

`state.py`:

```python
from dataclasses import dataclass, field

from app.domain.models import Fill, Order
from app.domain.portfolio import Portfolio


@dataclass(frozen=True)
class TradingState:
    portfolio: Portfolio
    orders: list[Order] = field(default_factory=list)
    fills: list[Fill] = field(default_factory=list)
```

`engine.py`:

```python
from dataclasses import replace
from decimal import Decimal

from app.domain.matcher import try_fill
from app.domain.models import OrderStatus
from app.domain.portfolio import InsufficientFunds, InsufficientShares
from app.domain.state import TradingState


class MatchingEngine:
    def process(self, state: TradingState, symbol: str, price: Decimal) -> TradingState:
        portfolio = state.portfolio
        new_fills = []
        orders = []
        changed = False
        for order in state.orders:
            fill = try_fill(order, price) if order.symbol == symbol else None
            if fill is None:
                orders.append(order)
                continue
            changed = True
            try:
                portfolio = portfolio.apply_fill(fill)
            except (InsufficientFunds, InsufficientShares):
                orders.append(replace(order, status=OrderStatus.REJECTED))
            else:
                new_fills.append(fill)
                orders.append(replace(order, status=OrderStatus.FILLED))
        if not changed:
            return state
        return TradingState(portfolio, orders, [*state.fills, *new_fills])
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/domain -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(domain): matching engine with fill-time affordability rejection"
```

---

### Task 5: Price source, simulated feed, Redis quote cache

**Files:**
- Create: `backend/app/market/__init__.py`, `universe.py`, `price_source.py`, `quote_cache.py`
- Test: `backend/tests/market/test_simulated.py`, `backend/tests/market/test_quote_cache.py`

**Interfaces:**
- Produces:
  - `UNIVERSE: dict[str, Decimal]` (symbol -> starting price) and `DEFAULT_WATCHLIST: list[str]`
  - `Quote(symbol: str, price: Decimal, ts_ms: int)` frozen dataclass
  - `PriceSource` Protocol: `def quotes(self, symbols: Iterable[str]) -> AsyncIterator[Quote]`
  - `SimulatedPriceSource(start: Mapping[str, Decimal], seed: int = 42, tick_s: float = 1.0, clock: Callable[[], float] = time.time)`: one quote per symbol (sorted) per tick; price moves at most ±0.2% per tick, 2 decimals, floor 0.01
  - `QuoteCache(redis, ttl_s: int = 30)` with `async put(quote)` and `async get_many(symbols) -> dict[str, Quote]` (missing or expired symbols are absent)

- [ ] **Step 1: Write the failing tests**

`backend/tests/market/test_simulated.py` (plus empty `tests/market/__init__.py`):

```python
from decimal import Decimal as D

from app.market.price_source import SimulatedPriceSource

START = {"AAPL": D("150.00"), "MSFT": D("300.00")}


async def take(agen, n):
    out = []
    async for item in agen:
        out.append(item)
        if len(out) == n:
            break
    await agen.aclose()
    return out


async def test_same_seed_gives_same_sequence():
    a = await take(SimulatedPriceSource(START, seed=7, tick_s=0).quotes(START), 6)
    b = await take(SimulatedPriceSource(START, seed=7, tick_s=0).quotes(START), 6)
    assert [q.price for q in a] == [q.price for q in b]


async def test_one_quote_per_symbol_per_tick_in_symbol_order():
    quotes = await take(SimulatedPriceSource(START, tick_s=0).quotes(START), 4)
    assert [q.symbol for q in quotes] == ["AAPL", "MSFT", "AAPL", "MSFT"]


async def test_prices_stay_positive_two_decimals_and_within_bound():
    src = SimulatedPriceSource({"AAPL": D("150.00")}, tick_s=0)
    quotes = await take(src.quotes(["AAPL"]), 200)
    prev = D("150.00")
    for q in quotes:
        assert q.price >= D("0.01")
        assert q.price == q.price.quantize(D("0.01"))
        assert abs(q.price - prev) <= prev * D("0.0021")
        prev = q.price
```

`backend/tests/market/test_quote_cache.py`:

```python
from decimal import Decimal as D

import fakeredis.aioredis
import pytest

from app.market.price_source import Quote
from app.market.quote_cache import QuoteCache


@pytest.fixture
async def redis():
    r = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield r
    await r.aclose()


async def test_put_then_get_many(redis):
    cache = QuoteCache(redis)
    await cache.put(Quote("AAPL", D("190.12"), 1000))
    got = await cache.get_many(["AAPL", "MSFT"])
    assert got == {"AAPL": Quote("AAPL", D("190.12"), 1000)}


async def test_put_overwrites_with_latest(redis):
    cache = QuoteCache(redis)
    await cache.put(Quote("AAPL", D("1.00"), 1))
    await cache.put(Quote("AAPL", D("2.00"), 2))
    assert (await cache.get_many(["AAPL"]))["AAPL"].price == D("2.00")


async def test_quotes_expire(redis):
    cache = QuoteCache(redis, ttl_s=30)
    await cache.put(Quote("AAPL", D("1.00"), 1))
    assert 0 < await redis.ttl("quote:AAPL") <= 30
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/market -v`
Expected: FAIL (`ModuleNotFoundError: app.market`).

- [ ] **Step 3: Implement**

`universe.py`:

```python
from decimal import Decimal

UNIVERSE: dict[str, Decimal] = {
    "AAPL": Decimal("190.00"),
    "MSFT": Decimal("420.00"),
    "TSLA": Decimal("250.00"),
    "NVDA": Decimal("900.00"),
    "AMZN": Decimal("180.00"),
}
DEFAULT_WATCHLIST = ["AAPL", "MSFT", "TSLA"]
```

`price_source.py`:

```python
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
```

`quote_cache.py`:

```python
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
            pipe.hset(key, mapping={"price": str(quote.price), "ts": quote.ts_ms})
            pipe.expire(key, self._ttl_s)
            await pipe.execute()

    async def get_many(self, symbols: Iterable[str]) -> dict[str, Quote]:
        symbols = list(symbols)
        rows = await asyncio.gather(*(self._redis.hgetall(self._key(s)) for s in symbols))
        return {
            s: Quote(s, Decimal(row["price"]), int(row["ts"]))
            for s, row in zip(symbols, rows)
            if row
        }
```

(`app/market/__init__.py` is an empty file.)

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/market -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(market): simulated price source and Redis quote cache"
```

---

### Task 6: Database models and repository (PostgreSQL)

**Files:**
- Create: `backend/app/db/__init__.py`, `models.py`, `repository.py`
- Test: `backend/tests/conftest.py`, `backend/tests/helpers.py`, `backend/tests/db/test_repository.py`

**Interfaces:**
- Consumes: domain types from Tasks 2 to 4.
- Produces:
  - SQLAlchemy models: `Base`, `User(id, email, password_hash, created_at)`, `Account(user_id, cash, realized_pnl)`, `PositionRow(user_id, symbol, quantity, avg_cost)`, `OrderRow(id, user_id, client_order_id, symbol, side, type, quantity, price, status, created_at)` with unique `(user_id, client_order_id)`, `FillRow(id, user_id, order_id, symbol, side, quantity, price, created_at)`, `WatchlistItem(user_id, symbol, position)`
  - `create_account(session, user_id: int, cash: Decimal) -> None`
  - `order_to_domain(row: OrderRow) -> Order`
  - `load_state(session, user_id: int, *, lock: bool = False) -> TradingState`: portfolio, **open orders only**, `fills=[]`. `lock=True` takes `SELECT ... FOR UPDATE` on the account row.
  - `save_state(session, user_id: int, state: TradingState) -> None`: writes cash and realized P&L, upserts and deletes positions, updates the status of every order in `state.orders`, inserts every fill in `state.fills`; flushes but does not commit.
  - Test fixtures: `db_engine`, `session_factory` (sessionmaker, `expire_on_commit=False`), helper `make_user(session_factory, cash="100000") -> int`.

- [ ] **Step 1: Write fixtures and the failing tests**

`backend/tests/conftest.py`:

```python
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import Base

TEST_DB_URL = "postgresql+psycopg://papertrade:papertrade@localhost:5432/papertrade_test"


@pytest.fixture
def db_engine():
    engine = create_engine(TEST_DB_URL)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def session_factory(db_engine):
    return sessionmaker(db_engine, expire_on_commit=False)
```

`backend/tests/helpers.py`:

```python
import itertools
from decimal import Decimal

from app.db.models import User
from app.db.repository import create_account

_counter = itertools.count(1)


def make_user(session_factory, cash: str = "100000") -> int:
    with session_factory() as session, session.begin():
        user = User(email=f"user{next(_counter)}@example.com", password_hash="x")
        session.add(user)
        session.flush()
        create_account(session, user.id, Decimal(cash))
        return user.id
```

`backend/tests/db/test_repository.py` (plus empty `tests/db/__init__.py`):

```python
from decimal import Decimal as D

from sqlalchemy import func, select

from app.db.models import FillRow, OrderRow
from app.db.repository import load_state, order_to_domain, save_state
from app.domain.engine import MatchingEngine
from app.domain.models import OrderStatus, OrderType, Side
from tests.helpers import make_user


def add_order(session, user_id, **kw):
    row = OrderRow(
        user_id=user_id,
        client_order_id=kw.get("client_order_id", "c-1"),
        symbol=kw.get("symbol", "AAPL"),
        side=kw.get("side", Side.BUY).value,
        type=kw.get("type", OrderType.MARKET).value,
        quantity=kw.get("quantity", 10),
        price=kw.get("price"),
        status=OrderStatus.OPEN.value,
    )
    session.add(row)
    session.flush()
    return row


def test_new_account_loads_starting_cash_and_no_orders(session_factory):
    uid = make_user(session_factory, "5000")
    with session_factory() as session:
        state = load_state(session, uid)
    assert state.portfolio.cash == D("5000")
    assert state.portfolio.positions == {}
    assert state.orders == [] and state.fills == []


def test_only_open_orders_are_loaded(session_factory):
    uid = make_user(session_factory)
    with session_factory() as session, session.begin():
        add_order(session, uid, client_order_id="a")
        done = add_order(session, uid, client_order_id="b")
        done.status = OrderStatus.CANCELLED.value
    with session_factory() as session:
        state = load_state(session, uid)
    assert [o.status for o in state.orders] == [OrderStatus.OPEN]


def test_save_state_persists_fill_position_cash_and_order_status(session_factory):
    uid = make_user(session_factory)
    with session_factory() as session, session.begin():
        row = add_order(session, uid)
        order_id = row.id
        state = load_state(session, uid, lock=True)
        save_state(session, uid, MatchingEngine().process(state, "AAPL", D("100")))
    with session_factory() as session:
        reloaded = load_state(session, uid)
        assert reloaded.portfolio.cash == D("99000")
        assert reloaded.portfolio.positions["AAPL"].quantity == 10
        assert reloaded.orders == []  # filled, so no longer open
        assert order_to_domain(session.get(OrderRow, order_id)).status is OrderStatus.FILLED
        assert session.scalar(select(func.count()).select_from(FillRow)) == 1


def test_selling_everything_deletes_the_position_row(session_factory):
    uid = make_user(session_factory)
    engine = MatchingEngine()
    with session_factory() as session, session.begin():
        add_order(session, uid, client_order_id="buy")
        save_state(session, uid, engine.process(load_state(session, uid), "AAPL", D("100")))
    with session_factory() as session, session.begin():
        add_order(session, uid, client_order_id="sell", side=Side.SELL)
        save_state(session, uid, engine.process(load_state(session, uid), "AAPL", D("110")))
    with session_factory() as session:
        state = load_state(session, uid)
    assert state.portfolio.positions == {}
    assert state.portfolio.realized_pnl == D("100")
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/db -v`
Expected: FAIL (`ModuleNotFoundError: app.db`). Postgres must be running (`docker compose up -d`).

- [ ] **Step 3: Implement**

`backend/app/db/models.py`:

```python
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

MONEY = Numeric(18, 4)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Account(Base):
    __tablename__ = "accounts"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    cash: Mapped[Decimal] = mapped_column(MONEY)
    realized_pnl: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0"))


class PositionRow(Base):
    __tablename__ = "positions"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    symbol: Mapped[str] = mapped_column(String(16), primary_key=True)
    quantity: Mapped[int]
    avg_cost: Mapped[Decimal] = mapped_column(MONEY)


class OrderRow(Base):
    __tablename__ = "orders"
    __table_args__ = (UniqueConstraint("user_id", "client_order_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    client_order_id: Mapped[str] = mapped_column(String(64))
    symbol: Mapped[str] = mapped_column(String(16), index=True)
    side: Mapped[str] = mapped_column(String(8))
    type: Mapped[str] = mapped_column(String(8))
    quantity: Mapped[int]
    price: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    status: Mapped[str] = mapped_column(String(10), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FillRow(Base):
    __tablename__ = "fills"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"))
    symbol: Mapped[str] = mapped_column(String(16))
    side: Mapped[str] = mapped_column(String(8))
    quantity: Mapped[int]
    price: Mapped[Decimal] = mapped_column(MONEY)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    symbol: Mapped[str] = mapped_column(String(16), primary_key=True)
    position: Mapped[int]
```

`backend/app/db/repository.py`:

```python
from decimal import Decimal

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.db.models import Account, FillRow, OrderRow, PositionRow
from app.domain.models import Order, OrderStatus, OrderType, Side
from app.domain.portfolio import Portfolio, Position
from app.domain.state import TradingState


def create_account(session: Session, user_id: int, cash: Decimal) -> None:
    session.add(Account(user_id=user_id, cash=cash, realized_pnl=Decimal("0")))


def order_to_domain(row: OrderRow) -> Order:
    return Order(
        id=row.id,
        symbol=row.symbol,
        side=Side(row.side),
        type=OrderType(row.type),
        quantity=row.quantity,
        price=row.price,
        status=OrderStatus(row.status),
    )


def load_state(session: Session, user_id: int, *, lock: bool = False) -> TradingState:
    """Portfolio plus OPEN orders. fills is empty: it holds only fills made after loading."""
    account = session.get(Account, user_id, with_for_update=lock)
    if account is None:
        raise LookupError(f"no account for user {user_id}")
    positions = {
        p.symbol: Position(p.symbol, p.quantity, p.avg_cost)
        for p in session.scalars(select(PositionRow).where(PositionRow.user_id == user_id))
    }
    open_orders = session.scalars(
        select(OrderRow)
        .where(OrderRow.user_id == user_id, OrderRow.status == OrderStatus.OPEN.value)
        .order_by(OrderRow.id)
    )
    return TradingState(
        Portfolio(account.cash, positions, account.realized_pnl),
        [order_to_domain(o) for o in open_orders],
        [],
    )


def save_state(session: Session, user_id: int, state: TradingState) -> None:
    account = session.get(Account, user_id)
    account.cash = state.portfolio.cash
    account.realized_pnl = state.portfolio.realized_pnl

    existing = {
        p.symbol: p
        for p in session.scalars(select(PositionRow).where(PositionRow.user_id == user_id))
    }
    for symbol, pos in state.portfolio.positions.items():
        row = existing.pop(symbol, None)
        if row is None:
            session.add(PositionRow(user_id=user_id, symbol=symbol, quantity=pos.quantity, avg_cost=pos.avg_cost))
        else:
            row.quantity, row.avg_cost = pos.quantity, pos.avg_cost
    for stale in existing.values():
        session.delete(stale)

    for order in state.orders:
        session.execute(
            update(OrderRow)
            .where(OrderRow.id == order.id, OrderRow.user_id == user_id)
            .values(status=order.status.value)
        )
    for fill in state.fills:
        session.add(
            FillRow(
                user_id=user_id,
                order_id=fill.order_id,
                symbol=fill.symbol,
                side=fill.side.value,
                quantity=fill.quantity,
                price=fill.price,
            )
        )
    session.flush()
```

(`app/db/__init__.py` is an empty file.)

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/db -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): SQLAlchemy models and state repository"
```

---

### Task 7: TradingService (idempotent orders, per-user locking, quote-driven fills)

**Files:**
- Create: `backend/app/services/__init__.py`, `backend/app/services/trading.py`
- Test: `backend/tests/services/test_trading.py`

**Interfaces:**
- Consumes: `MatchingEngine`, `load_state`, `save_state`, `order_to_domain`, `OrderRow`, `Account`, `Quote`.
- Produces: `TradingService(session_factory, engine: MatchingEngine | None = None)` with
  - `place_order(user_id, *, client_order_id: str, symbol: str, side: Side, type: OrderType, quantity: int, price: Decimal | None, market_price: Decimal) -> Order`: validates (raises `ValueError`), locks the account row, returns the existing order if `client_order_id` was seen, otherwise stores the order and runs the engine at `market_price`. Returns the order with its resulting status.
  - `cancel_order(user_id, order_id: int) -> bool`: true only if the user's order was OPEN.
  - `on_quote(quote: Quote) -> int`: runs the engine for every user with an OPEN order in `quote.symbol`, one transaction each; returns the number of fills.

- [ ] **Step 1: Write the failing tests**

`backend/tests/services/test_trading.py` (plus empty `tests/services/__init__.py`):

```python
from decimal import Decimal as D

import pytest

from app.db.repository import load_state
from app.domain.models import OrderStatus, OrderType, Side
from app.market.price_source import Quote
from app.services.trading import TradingService
from tests.helpers import make_user

BUY, SELL = Side.BUY, Side.SELL
MARKET, LIMIT = OrderType.MARKET, OrderType.LIMIT


def place(service, uid, cid="c1", side=BUY, type_=MARKET, qty=10, price=None, market="100"):
    return service.place_order(
        uid, client_order_id=cid, symbol="AAPL", side=side, type=type_,
        quantity=qty, price=None if price is None else D(price), market_price=D(market),
    )


def cash(session_factory, uid):
    with session_factory() as session:
        return load_state(session, uid).portfolio.cash


def test_market_buy_fills_and_persists(session_factory):
    uid = make_user(session_factory, "10000")
    order = place(TradingService(session_factory), uid)
    assert order.status is OrderStatus.FILLED
    assert cash(session_factory, uid) == D("9000")


def test_repeating_a_client_order_id_returns_the_same_order_without_a_second_fill(session_factory):
    uid = make_user(session_factory, "10000")
    service = TradingService(session_factory)
    first = place(service, uid, cid="same")
    second = place(service, uid, cid="same")
    assert first.id == second.id
    assert cash(session_factory, uid) == D("9000")


def test_limit_order_rests_then_fills_when_a_quote_crosses_it(session_factory):
    uid = make_user(session_factory, "10000")
    service = TradingService(session_factory)
    order = place(service, uid, type_=LIMIT, price="95")
    assert order.status is OrderStatus.OPEN
    assert service.on_quote(Quote("AAPL", D("97"), 1)) == 0
    assert service.on_quote(Quote("AAPL", D("94"), 2)) == 1
    assert cash(session_factory, uid) == D("9060")


def test_cancel_only_works_on_the_owners_open_orders(session_factory):
    alice, bob = make_user(session_factory), make_user(session_factory)
    service = TradingService(session_factory)
    resting = place(service, alice, cid="r", type_=LIMIT, price="1")
    filled = place(service, alice, cid="f")
    assert service.cancel_order(bob, resting.id) is False
    assert service.cancel_order(alice, filled.id) is False
    assert service.cancel_order(alice, 999999) is False
    assert service.cancel_order(alice, resting.id) is True
    assert service.cancel_order(alice, resting.id) is False


def test_unaffordable_order_comes_back_rejected(session_factory):
    uid = make_user(session_factory, "10")
    assert place(TradingService(session_factory), uid).status is OrderStatus.REJECTED


def test_invalid_order_raises_value_error_and_stores_nothing(session_factory):
    uid = make_user(session_factory)
    service = TradingService(session_factory)
    with pytest.raises(ValueError):
        place(service, uid, type_=LIMIT, price=None)
    with pytest.raises(ValueError):
        place(service, uid, qty=0)


def test_quotes_only_affect_users_with_matching_open_orders(session_factory):
    alice, bob = make_user(session_factory, "10000"), make_user(session_factory, "10000")
    service = TradingService(session_factory)
    place(service, alice, type_=LIMIT, price="95")
    assert service.on_quote(Quote("AAPL", D("90"), 1)) == 1
    assert cash(session_factory, alice) == D("9100")
    assert cash(session_factory, bob) == D("10000")
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/services -v`
Expected: FAIL (`ModuleNotFoundError: app.services`).

- [ ] **Step 3: Implement**

```python
from decimal import Decimal

from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import Account, OrderRow
from app.db.repository import load_state, order_to_domain, save_state
from app.domain.engine import MatchingEngine
from app.domain.models import Order, OrderStatus, OrderType, Side
from app.market.price_source import Quote


class TradingService:
    def __init__(self, session_factory: sessionmaker[Session], engine: MatchingEngine | None = None):
        self._session_factory = session_factory
        self._engine = engine or MatchingEngine()

    def place_order(
        self,
        user_id: int,
        *,
        client_order_id: str,
        symbol: str,
        side: Side,
        type: OrderType,
        quantity: int,
        price: Decimal | None,
        market_price: Decimal,
    ) -> Order:
        Order(0, symbol, side, type, quantity, price)  # raises ValueError if invalid
        with self._session_factory() as session, session.begin():
            if session.get(Account, user_id, with_for_update=True) is None:
                raise LookupError(f"no account for user {user_id}")
            existing = session.scalar(
                select(OrderRow).where(
                    OrderRow.user_id == user_id, OrderRow.client_order_id == client_order_id
                )
            )
            if existing is not None:
                return order_to_domain(existing)
            row = OrderRow(
                user_id=user_id,
                client_order_id=client_order_id,
                symbol=symbol,
                side=side.value,
                type=type.value,
                quantity=quantity,
                price=price,
                status=OrderStatus.OPEN.value,
            )
            session.add(row)
            session.flush()
            state = load_state(session, user_id)
            save_state(session, user_id, self._engine.process(state, symbol, market_price))
            session.refresh(row)
            return order_to_domain(row)

    def cancel_order(self, user_id: int, order_id: int) -> bool:
        with self._session_factory() as session, session.begin():
            session.get(Account, user_id, with_for_update=True)
            result = session.execute(
                update(OrderRow)
                .where(
                    OrderRow.id == order_id,
                    OrderRow.user_id == user_id,
                    OrderRow.status == OrderStatus.OPEN.value,
                )
                .values(status=OrderStatus.CANCELLED.value)
            )
            return result.rowcount == 1

    def on_quote(self, quote: Quote) -> int:
        with self._session_factory() as session:
            user_ids = list(
                session.scalars(
                    select(OrderRow.user_id)
                    .where(OrderRow.symbol == quote.symbol, OrderRow.status == OrderStatus.OPEN.value)
                    .distinct()
                )
            )
        fills = 0
        for user_id in user_ids:
            with self._session_factory() as session, session.begin():
                state = load_state(session, user_id, lock=True)
                next_state = self._engine.process(state, quote.symbol, quote.price)
                if next_state is not state:
                    save_state(session, user_id, next_state)
                    fills += len(next_state.fills)
        return fills
```

(`app/services/__init__.py` is an empty file.)

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests -v`
Expected: PASS (everything so far).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(services): idempotent TradingService with per-user locking"
```

---

### Task 8: Password hashing and JWT

**Files:**
- Create: `backend/app/auth/__init__.py`, `backend/app/auth/security.py`
- Test: `backend/tests/auth/__init__.py` (empty), `backend/tests/auth/test_security.py`

**Interfaces:**
- Produces:
  - `hash_password(password: str) -> str`, `verify_password(password_hash: str, password: str) -> bool`
  - `create_token(user_id: int, secret: str, minutes: int = 60, now: datetime | None = None) -> str`
  - `decode_token(token: str, secret: str) -> int`: returns the user id; raises `jwt.InvalidTokenError` (including expiry and a missing or non-integer subject).

- [ ] **Step 1: Write the failing tests**

```python
from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app.auth.security import create_token, decode_token, hash_password, verify_password

SECRET = "test-secret-test-secret-test-secret-123"


def test_password_round_trip_and_wrong_password():
    h = hash_password("correct-horse-1")
    assert h != "correct-horse-1"
    assert verify_password(h, "correct-horse-1") is True
    assert verify_password(h, "wrong") is False


def test_token_round_trip():
    assert decode_token(create_token(42, SECRET), SECRET) == 42


def test_expired_token_is_rejected():
    long_ago = datetime.now(timezone.utc) - timedelta(hours=2)
    token = create_token(42, SECRET, minutes=1, now=long_ago)
    with pytest.raises(jwt.InvalidTokenError):
        decode_token(token, SECRET)


def test_token_signed_with_another_secret_is_rejected():
    token = create_token(42, "another-secret-another-secret-another-1")
    with pytest.raises(jwt.InvalidTokenError):
        decode_token(token, SECRET)


def test_token_without_a_valid_subject_is_rejected():
    token = jwt.encode({"sub": "not-a-number"}, SECRET, algorithm="HS256")
    with pytest.raises(jwt.InvalidTokenError):
        decode_token(token, SECRET)
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/auth -v`
Expected: FAIL (`ModuleNotFoundError: app.auth`).

- [ ] **Step 3: Implement**

```python
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def create_token(user_id: int, secret: str, minutes: int = 60, now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    claims = {"sub": str(user_id), "iat": now, "exp": now + timedelta(minutes=minutes)}
    return jwt.encode(claims, secret, algorithm="HS256")


def decode_token(token: str, secret: str) -> int:
    payload = jwt.decode(token, secret, algorithms=["HS256"])
    try:
        return int(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise jwt.InvalidTokenError("bad subject") from exc
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/auth -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(auth): argon2 password hashing and JWT helpers"
```

---

### Task 9: App factory, settings, register/login/me

**Files:**
- Create: `backend/app/config.py`, `backend/app/api/__init__.py`, `deps.py`, `schemas.py`, `routes_auth.py`, `backend/.env` (untracked)
- Modify: `backend/app/main.py`
- Test: `backend/tests/api/conftest.py`, `backend/tests/api/test_auth_routes.py`

**Interfaces:**
- Consumes: `hash_password`, `verify_password`, `create_token`, `decode_token`, models, `create_account`, `DEFAULT_WATCHLIST`.
- Produces:
  - `Settings(database_url, redis_url, jwt_secret (required), starting_cash=100000.00)` read from `PT_*` env vars and `.env`
  - `create_app(*, settings=None, session_factory=None, quote_cache=None, price_source=None) -> FastAPI`; stores `settings`, `session_factory`, `quote_cache`, `trading_service` on `app.state`
  - `POST /auth/register {email, password(min 8)} -> 201 {access_token, token_type}`; duplicate email 409
  - `POST /auth/login {email, password} -> 200 {access_token, token_type}`; any failure 401
  - `GET /me -> {id, email}` (needs `Authorization: Bearer`; otherwise 401)
  - `deps.current_user_id` dependency; `deps.get_session` dependency
  - Test helpers: `InMemoryQuoteCache` (same `put` / `get_many` interface as `QuoteCache`, with a public `data: dict[str, Quote]`), fixtures `cache`, `client`, function `auth_headers(client, email="a@example.com")`

- [ ] **Step 1: Write fixtures and the failing tests**

`backend/tests/api/conftest.py` (plus empty `tests/api/__init__.py`):

```python
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.market.price_source import Quote


class InMemoryQuoteCache:
    """Same interface as QuoteCache; the Redis version is covered in tests/market."""

    def __init__(self) -> None:
        self.data: dict[str, Quote] = {}

    async def put(self, quote: Quote) -> None:
        self.data[quote.symbol] = quote

    async def get_many(self, symbols):
        return {s: self.data[s] for s in symbols if s in self.data}


@pytest.fixture
def cache():
    return InMemoryQuoteCache()


@pytest.fixture
def client(session_factory, cache):
    settings = Settings(jwt_secret="test-secret-test-secret-test-secret-123")
    app = create_app(settings=settings, session_factory=session_factory, quote_cache=cache)
    with TestClient(app) as test_client:
        yield test_client


def auth_headers(client, email="a@example.com", password="correct-horse-1"):
    response = client.post("/auth/register", json={"email": email, "password": password})
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}
```

`backend/tests/api/test_auth_routes.py`:

```python
from tests.api.conftest import auth_headers


def test_register_returns_a_token_that_works_on_me(client):
    headers = auth_headers(client, "new@example.com")
    me = client.get("/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email"] == "new@example.com"


def test_duplicate_email_is_a_conflict(client):
    auth_headers(client, "dup@example.com")
    again = client.post("/auth/register", json={"email": "DUP@example.com", "password": "correct-horse-1"})
    assert again.status_code == 409


def test_short_password_is_rejected(client):
    r = client.post("/auth/register", json={"email": "s@example.com", "password": "short"})
    assert r.status_code == 422


def test_login_success_and_failures(client):
    auth_headers(client, "login@example.com", "correct-horse-1")
    ok = client.post("/auth/login", json={"email": "login@example.com", "password": "correct-horse-1"})
    assert ok.status_code == 200 and ok.json()["access_token"]
    bad_pw = client.post("/auth/login", json={"email": "login@example.com", "password": "nope-nope-1"})
    no_user = client.post("/auth/login", json={"email": "ghost@example.com", "password": "nope-nope-1"})
    assert bad_pw.status_code == 401 and no_user.status_code == 401
    assert bad_pw.json() == no_user.json()


def test_protected_route_needs_a_valid_token(client):
    assert client.get("/me").status_code == 401
    assert client.get("/me", headers={"Authorization": "Bearer garbage"}).status_code == 401
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/api -v`
Expected: FAIL (`ModuleNotFoundError: app.config`).

- [ ] **Step 3: Implement**

`backend/app/config.py`:

```python
from decimal import Decimal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="PT_", extra="ignore")

    database_url: str = "postgresql+psycopg://papertrade:papertrade@localhost:5432/papertrade"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str
    starting_cash: Decimal = Decimal("100000.00")
```

`backend/app/api/schemas.py`:

```python
from pydantic import BaseModel, EmailStr, Field


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeOut(BaseModel):
    id: int
    email: str
```

`backend/app/api/deps.py`:

```python
from collections.abc import Iterator

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth.security import decode_token

_bearer = HTTPBearer(auto_error=False)
_UNAUTHORIZED = {"WWW-Authenticate": "Bearer"}


def get_session(request: Request) -> Iterator[Session]:
    with request.app.state.session_factory() as session:
        yield session


def current_user_id(
    request: Request, creds: HTTPAuthorizationCredentials | None = Depends(_bearer)
) -> int:
    if creds is None:
        raise HTTPException(401, "missing token", headers=_UNAUTHORIZED)
    try:
        return decode_token(creds.credentials, request.app.state.settings.jwt_secret)
    except jwt.InvalidTokenError:
        raise HTTPException(401, "invalid token", headers=_UNAUTHORIZED)
```

`backend/app/api/routes_auth.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import current_user_id, get_session
from app.api.schemas import LoginIn, MeOut, RegisterIn, TokenOut
from app.auth.security import create_token, hash_password, verify_password
from app.db.models import User, WatchlistItem
from app.db.repository import create_account
from app.market.universe import DEFAULT_WATCHLIST

router = APIRouter()


@router.post("/auth/register", status_code=201, response_model=TokenOut)
def register(body: RegisterIn, request: Request, session: Session = Depends(get_session)):
    settings = request.app.state.settings
    user = User(email=body.email.lower(), password_hash=hash_password(body.password))
    session.add(user)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "email already registered")
    create_account(session, user.id, settings.starting_cash)
    for position, symbol in enumerate(DEFAULT_WATCHLIST):
        session.add(WatchlistItem(user_id=user.id, symbol=symbol, position=position))
    session.commit()
    return TokenOut(access_token=create_token(user.id, settings.jwt_secret))


@router.post("/auth/login", response_model=TokenOut)
def login(body: LoginIn, request: Request, session: Session = Depends(get_session)):
    user = session.scalar(select(User).where(User.email == body.email.lower()))
    if user is None or not verify_password(user.password_hash, body.password):
        raise HTTPException(401, "invalid email or password")
    return TokenOut(access_token=create_token(user.id, request.app.state.settings.jwt_secret))


@router.get("/me", response_model=MeOut)
def me(user_id: int = Depends(current_user_id), session: Session = Depends(get_session)):
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(401, "invalid token")
    return MeOut(id=user.id, email=user.email)
```

`backend/app/main.py` (replace):

```python
from fastapi import FastAPI
from redis.asyncio import Redis
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.routes_auth import router as auth_router
from app.config import Settings
from app.market.quote_cache import QuoteCache
from app.services.trading import TradingService


def create_app(*, settings=None, session_factory=None, quote_cache=None, price_source=None) -> FastAPI:
    settings = settings or Settings()
    if session_factory is None:
        session_factory = sessionmaker(create_engine(settings.database_url), expire_on_commit=False)
    if quote_cache is None:
        quote_cache = QuoteCache(Redis.from_url(settings.redis_url, decode_responses=True))

    app = FastAPI(title="PaperTrade")
    app.state.settings = settings
    app.state.session_factory = session_factory
    app.state.quote_cache = quote_cache
    app.state.trading_service = TradingService(session_factory)
    app.state.price_source = price_source

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth_router)
    return app
```

Create `backend/.env` (never commit it):

```bash
python -c "import secrets; print('PT_JWT_SECRET=' + secrets.token_urlsafe(48))" > backend/.env
```

Update `tests/test_health.py` to build the app with explicit settings:

```python
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_health(session_factory):
    app = create_app(settings=Settings(jwt_secret="x" * 40), session_factory=session_factory, quote_cache=object())
    assert TestClient(app).get("/health").json() == {"status": "ok"}
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests -v`
Expected: PASS. Also run `uv run uvicorn app.main:create_app --factory` once and open `http://127.0.0.1:8000/docs` to confirm the API starts against real Postgres/Redis (tables do not exist yet outside tests; Task 10 adds startup table creation).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): app factory, settings, register/login/me"
```

---

### Task 10: Trading API, snapshot, and the market loop

**Files:**
- Create: `backend/app/services/queries.py`, `backend/app/market/loop.py`, `backend/app/api/routes_trading.py`
- Modify: `backend/app/api/schemas.py`, `backend/app/main.py`
- Test: `backend/tests/api/test_trading_routes.py`, `backend/tests/market/test_loop.py`

**Interfaces:**
- Consumes: `TradingService`, `QuoteCache`-like `app.state.quote_cache`, `UNIVERSE`, repository and models.
- Produces (all require `Authorization: Bearer`):
  - `GET /quotes?symbols=AAPL,MSFT -> {"AAPL": {"price": "190.12", "ts_ms": 1}, ...}` (omits symbols without a fresh quote; unknown symbols are ignored)
  - `GET /watchlist -> {"symbols": [...]}`; `PUT /watchlist {"symbols": [...]} -> same` (422 for symbols outside `UNIVERSE`, duplicates removed, order kept)
  - `POST /orders {client_order_id(8-64 chars), symbol, side, type, quantity>0, price?} -> 201 OrderOut`; 422 invalid or unknown symbol; 503 when no fresh quote
  - `DELETE /orders/{id} -> 204`, or 404 when not the user's open order
  - `GET /orders?limit=50 -> list[OrderOut]` (newest first); `GET /transactions?limit=50 -> list[FillOut]`
  - `GET /portfolio -> PortfolioOut`: `cash, realized_pnl, unrealized_pnl, equity, positions[{symbol, quantity, avg_cost, last_price, unrealized_pnl}]`; `last_price` falls back to `avg_cost` when no quote exists
  - `GET /snapshot -> {server_time, portfolio, orders (latest 100), transactions (latest 200), watchlist}`
  - `run_market_loop(source, cache, service, symbols)`: for each quote, store it, then run `service.on_quote` in a worker thread; an exception in matching is logged and the loop continues
  - App lifespan: creates tables (`Base.metadata.create_all`) and, when `price_source` is given, starts the loop for all `UNIVERSE` symbols

- [ ] **Step 1: Write the failing tests**

`backend/tests/market/test_loop.py`:

```python
from decimal import Decimal as D

from app.db.repository import load_state
from app.domain.models import OrderType, Side
from app.market.loop import run_market_loop
from app.market.price_source import Quote
from app.services.trading import TradingService
from tests.api.conftest import InMemoryQuoteCache
from tests.helpers import make_user


class FiniteSource:
    def __init__(self, quotes):
        self._quotes = quotes

    async def quotes(self, symbols):
        for q in self._quotes:
            yield q


async def test_loop_caches_quotes_and_fills_resting_orders(session_factory):
    uid = make_user(session_factory, "10000")
    service = TradingService(session_factory)
    service.place_order(
        uid, client_order_id="resting-1", symbol="AAPL", side=Side.BUY, type=OrderType.LIMIT,
        quantity=10, price=D("95"), market_price=D("100"),
    )
    cache = InMemoryQuoteCache()
    source = FiniteSource([Quote("AAPL", D("97"), 1), Quote("AAPL", D("94"), 2)])

    await run_market_loop(source, cache, service, ["AAPL"])

    assert cache.data["AAPL"].price == D("94")
    with session_factory() as session:
        assert load_state(session, uid).portfolio.cash == D("9060")


async def test_loop_survives_a_matching_error(session_factory):
    class ExplodingService:
        def __init__(self):
            self.calls = 0

        def on_quote(self, quote):
            self.calls += 1
            raise RuntimeError("boom")

    cache, service = InMemoryQuoteCache(), ExplodingService()
    await run_market_loop(FiniteSource([Quote("AAPL", D("1"), 1), Quote("AAPL", D("2"), 2)]), cache, service, ["AAPL"])
    assert service.calls == 2
    assert cache.data["AAPL"].price == D("2")
```

`backend/tests/api/test_trading_routes.py`:

```python
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
    assert body == {"AAPL": {"price": "190.12", "ts_ms": 1}}


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
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/api/test_trading_routes.py tests/market/test_loop.py -v`
Expected: FAIL (`ModuleNotFoundError: app.market.loop`, 404s on `/orders`).

- [ ] **Step 3: Implement**

Append to `backend/app/api/schemas.py`:

```python
from datetime import datetime
from decimal import Decimal

from pydantic import ConfigDict

from app.domain.models import OrderStatus, OrderType, Side


class OrderIn(BaseModel):
    client_order_id: str = Field(min_length=8, max_length=64)
    symbol: str
    side: Side
    type: OrderType
    quantity: int = Field(gt=0)
    price: Decimal | None = None


class OrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    symbol: str
    side: Side
    type: OrderType
    quantity: int
    price: Decimal | None
    status: OrderStatus


class FillOut(BaseModel):
    id: int
    order_id: int
    symbol: str
    side: str
    quantity: int
    price: Decimal
    created_at: datetime


class PositionOut(BaseModel):
    symbol: str
    quantity: int
    avg_cost: Decimal
    last_price: Decimal
    unrealized_pnl: Decimal


class PortfolioOut(BaseModel):
    cash: Decimal
    realized_pnl: Decimal
    unrealized_pnl: Decimal
    equity: Decimal
    positions: list[PositionOut]


class WatchlistIO(BaseModel):
    symbols: list[str]


class QuoteOut(BaseModel):
    price: Decimal
    ts_ms: int


class SnapshotOut(BaseModel):
    server_time: datetime
    portfolio: PortfolioOut
    orders: list[OrderOut]
    transactions: list[FillOut]
    watchlist: list[str]
```

(Move the `from datetime ...`, `Decimal`, `ConfigDict`, and domain imports to the top of the file when editing.)

`backend/app/services/queries.py`:

```python
from collections.abc import Mapping
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.schemas import FillOut, OrderOut, PortfolioOut, PositionOut
from app.db.models import FillRow, OrderRow, WatchlistItem
from app.db.repository import load_state, order_to_domain
from app.market.price_source import Quote


def portfolio_view(session: Session, user_id: int, quotes: Mapping[str, Quote]) -> PortfolioOut:
    portfolio = load_state(session, user_id).portfolio
    prices = {
        p.symbol: quotes[p.symbol].price if p.symbol in quotes else p.avg_cost
        for p in portfolio.positions.values()
    }
    return PortfolioOut(
        cash=portfolio.cash,
        realized_pnl=portfolio.realized_pnl,
        unrealized_pnl=portfolio.unrealized_pnl(prices),
        equity=portfolio.equity(prices),
        positions=[
            PositionOut(
                symbol=p.symbol,
                quantity=p.quantity,
                avg_cost=p.avg_cost,
                last_price=prices[p.symbol],
                unrealized_pnl=(prices[p.symbol] - p.avg_cost) * p.quantity,
            )
            for p in portfolio.positions.values()
        ],
    )


def list_orders(session: Session, user_id: int, limit: int) -> list[OrderOut]:
    rows = session.scalars(
        select(OrderRow).where(OrderRow.user_id == user_id).order_by(OrderRow.id.desc()).limit(limit)
    )
    return [OrderOut.model_validate(order_to_domain(r)) for r in rows]


def list_fills(session: Session, user_id: int, limit: int) -> list[FillOut]:
    rows = session.scalars(
        select(FillRow).where(FillRow.user_id == user_id).order_by(FillRow.id.desc()).limit(limit)
    )
    return [
        FillOut(id=r.id, order_id=r.order_id, symbol=r.symbol, side=r.side,
                quantity=r.quantity, price=r.price, created_at=r.created_at)
        for r in rows
    ]


def get_watchlist(session: Session, user_id: int) -> list[str]:
    return list(
        session.scalars(
            select(WatchlistItem.symbol)
            .where(WatchlistItem.user_id == user_id)
            .order_by(WatchlistItem.position)
        )
    )


def set_watchlist(session: Session, user_id: int, symbols: list[str]) -> list[str]:
    unique = list(dict.fromkeys(symbols))
    session.execute(delete(WatchlistItem).where(WatchlistItem.user_id == user_id))
    for position, symbol in enumerate(unique):
        session.add(WatchlistItem(user_id=user_id, symbol=symbol, position=position))
    session.commit()
    return unique
```

`backend/app/market/loop.py`:

```python
import logging
from collections.abc import Iterable

from starlette.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)


async def run_market_loop(source, cache, service, symbols: Iterable[str]) -> None:
    async for quote in source.quotes(symbols):
        await cache.put(quote)
        try:
            await run_in_threadpool(service.on_quote, quote)
        except Exception:
            logger.exception("matching failed for %s", quote.symbol)
```

`backend/app/api/routes_trading.py`:

```python
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from starlette.concurrency import run_in_threadpool

from app.api.deps import current_user_id
from app.api.schemas import OrderIn, OrderOut, QuoteOut, SnapshotOut, WatchlistIO
from app.domain.models import OrderType
from app.market.universe import UNIVERSE
from app.services import queries

router = APIRouter()


def _known(symbols: list[str]) -> list[str]:
    return [s for s in dict.fromkeys(symbols) if s in UNIVERSE]


@router.get("/quotes", response_model=dict[str, QuoteOut])
async def quotes(request: Request, symbols: str = Query(""), _: int = Depends(current_user_id)):
    wanted = _known([s.strip().upper() for s in symbols.split(",") if s.strip()])
    found = await request.app.state.quote_cache.get_many(wanted)
    return {s: QuoteOut(price=q.price, ts_ms=q.ts_ms) for s, q in found.items()}


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


@router.get("/transactions")
async def transactions(request: Request, limit: int = Query(50, ge=1, le=500), user_id: int = Depends(current_user_id)):
    def work():
        with request.app.state.session_factory() as session:
            return queries.list_fills(session, user_id, limit)

    return await run_in_threadpool(work)


@router.get("/portfolio")
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
```

(Adjust `transactions` and `portfolio` to use `response_model=list[FillOut]` / `PortfolioOut` by importing those schemas.)

Modify `backend/app/main.py`: import `asyncio`, `contextlib`, `Base`, `UNIVERSE`, `run_market_loop`, `routes_trading.router`; pass a `lifespan` to `FastAPI(...)`:

```python
@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(session_factory.kw["bind"])
    task = None
    if price_source is not None:
        task = asyncio.create_task(
            run_market_loop(price_source, quote_cache, app.state.trading_service, list(UNIVERSE))
        )
    try:
        yield
    finally:
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
```

and add `app.include_router(trading_router)`. For the real server, start the simulated feed only when nothing was injected: add `simulate_prices: bool = True` to `Settings`, and in `create_app`, before building the cache, set

```python
if price_source is None and quote_cache is None and settings.simulate_prices:
    price_source = SimulatedPriceSource(UNIVERSE)
```

Tests inject a `quote_cache`, so they never start the feed.

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests -v`
Expected: PASS (all backend tests).

Then run the real stack once:

```bash
docker compose up -d
cd backend
uv run uvicorn app.main:create_app --factory --reload
```

Open `http://127.0.0.1:8000/docs`, register, authorize with the token, and call `GET /quotes?symbols=AAPL`. Expected: a price that changes about once a second.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): trading endpoints, snapshot, and market loop"
```

---

## Mobile

### Task 11: Expo scaffold and order-input validation

**Files:**
- Create: `mobile/` (via `create-expo-app`), `mobile/src/orders/validate.ts`
- Modify: `mobile/package.json`
- Test: `mobile/src/__tests__/validate.test.ts`

**Interfaces:**
- Produces:
  - `type OrderType = 'MARKET' | 'LIMIT' | 'STOP'`, `type Side = 'BUY' | 'SELL'`
  - `validateOrderInput(input: { type: OrderType; quantity: string; price: string }): { ok: boolean; errors: { quantity?: string; price?: string } }`: quantity must be a positive integer; LIMIT/STOP need a positive price with at most 2 decimals; MARKET ignores price.

- [ ] **Step 1: Scaffold and install**

Run (repo root):

```bash
npx create-expo-app@latest mobile --template blank-typescript
cd mobile
npx expo install expo-sqlite expo-secure-store expo-crypto react-native-screens react-native-safe-area-context
npm install @react-navigation/native @react-navigation/bottom-tabs @react-navigation/native-stack
npm install --save-dev jest-expo jest @types/jest
```

In `package.json` add `"test": "jest"` under `scripts` and:

```json
"jest": { "preset": "jest-expo" }
```

Expected: `npx expo start` shows a QR code and the default screen opens in Expo Go or an emulator.

- [ ] **Step 2: Write the failing tests**

`mobile/src/__tests__/validate.test.ts`:

```ts
import { validateOrderInput } from '../orders/validate';

describe('validateOrderInput', () => {
  it('accepts a market order and ignores the price field', () => {
    expect(validateOrderInput({ type: 'MARKET', quantity: '10', price: 'abc' })).toEqual({ ok: true, errors: {} });
  });

  it.each(['', '0', '-1', '1.5', 'abc', '01'])('rejects quantity %p', (quantity) => {
    const r = validateOrderInput({ type: 'MARKET', quantity, price: '' });
    expect(r.ok).toBe(false);
    expect(r.errors.quantity).toBeDefined();
  });

  it('requires a price for limit and stop orders', () => {
    expect(validateOrderInput({ type: 'LIMIT', quantity: '1', price: '' }).errors.price).toBeDefined();
    expect(validateOrderInput({ type: 'STOP', quantity: '1', price: '' }).errors.price).toBeDefined();
  });

  it.each(['0', '0.00', '-5', '1.234', 'x'])('rejects price %p', (price) => {
    expect(validateOrderInput({ type: 'LIMIT', quantity: '1', price }).errors.price).toBeDefined();
  });

  it.each(['95', '95.5', '0.01', '1000.25'])('accepts price %p', (price) => {
    expect(validateOrderInput({ type: 'LIMIT', quantity: '1', price })).toEqual({ ok: true, errors: {} });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- validate`
Expected: FAIL (`Cannot find module '../orders/validate'`).

- [ ] **Step 4: Implement**

`mobile/src/orders/validate.ts`:

```ts
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP';
export type Side = 'BUY' | 'SELL';

export interface OrderInput {
  type: OrderType;
  quantity: string;
  price: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: { quantity?: string; price?: string };
}

const POSITIVE_INT = /^[1-9]\d*$/;
const PRICE = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

export function validateOrderInput({ type, quantity, price }: OrderInput): ValidationResult {
  const errors: ValidationResult['errors'] = {};
  if (!POSITIVE_INT.test(quantity)) errors.quantity = 'Enter a whole number of shares, 1 or more';
  if (type !== 'MARKET') {
    if (!PRICE.test(price) || Number(price) <= 0) errors.price = 'Enter a price above 0 with up to 2 decimals';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(mobile): Expo scaffold and order input validation"
```

---

### Task 12: API client, local store, and sync

**Files:**
- Create: `mobile/src/api/types.ts`, `client.ts`, `mobile/src/auth/tokenStorage.ts`, `mobile/src/sync/syncer.ts`, `mobile/src/sync/sqliteStore.ts`
- Test: `mobile/src/__tests__/syncer.test.ts`

**Interfaces:**
- Produces:
  - DTO types matching the backend (`Snapshot`, `PortfolioDto`, `PositionDto`, `OrderDto`, `TransactionDto`); money fields are `string`
  - `LocalStore { replaceSnapshot(snapshot, syncedAt: number): Promise<void>; readSnapshot(): Promise<{ snapshot: Snapshot; syncedAt: number } | null>; clear(): Promise<void> }`
  - `createSyncer(api: { snapshot(): Promise<Snapshot> }, store: LocalStore, now?: () => number): () => Promise<{ ok: true } | { ok: false; error: string }>`: concurrent calls share one in-flight request; a failed fetch leaves the stored snapshot untouched and returns the error
  - `createApi(getToken)`: `register`, `login`, `me`, `quotes(symbols)`, `snapshot`, `placeOrder`, `cancelOrder`, `setWatchlist`; throws `ApiError(status, message)` on non-2xx
  - `openSqliteStore(): Promise<LocalStore>` (expo-sqlite)

- [ ] **Step 1: Write the DTO types**

`mobile/src/api/types.ts`:

```ts
import type { OrderType, Side } from '../orders/validate';

export interface PositionDto { symbol: string; quantity: number; avg_cost: string; last_price: string; unrealized_pnl: string }
export interface PortfolioDto { cash: string; realized_pnl: string; unrealized_pnl: string; equity: string; positions: PositionDto[] }
export interface OrderDto { id: number; symbol: string; side: Side; type: OrderType; quantity: number; price: string | null; status: 'OPEN' | 'FILLED' | 'CANCELLED' | 'REJECTED' }
export interface TransactionDto { id: number; order_id: number; symbol: string; side: Side; quantity: number; price: string; created_at: string }
export interface Snapshot { server_time: string; portfolio: PortfolioDto; orders: OrderDto[]; transactions: TransactionDto[]; watchlist: string[] }
export interface QuoteDto { price: string; ts_ms: number }
```

- [ ] **Step 2: Write the failing tests**

`mobile/src/__tests__/syncer.test.ts`:

```ts
import type { Snapshot } from '../api/types';
import { createSyncer, type LocalStore } from '../sync/syncer';

const snap = (cash: string): Snapshot => ({
  server_time: '2026-11-08T00:00:00Z',
  portfolio: { cash, realized_pnl: '0', unrealized_pnl: '0', equity: cash, positions: [] },
  orders: [], transactions: [], watchlist: ['AAPL'],
});

function fakeStore(): LocalStore & { saved: { snapshot: Snapshot; syncedAt: number } | null } {
  return {
    saved: null,
    async replaceSnapshot(snapshot, syncedAt) { this.saved = { snapshot, syncedAt }; },
    async readSnapshot() { return this.saved; },
    async clear() { this.saved = null; },
  };
}

it('stores the fetched snapshot with the sync time', async () => {
  const store = fakeStore();
  const sync = createSyncer({ snapshot: async () => snap('100') }, store, () => 1234);
  expect(await sync()).toEqual({ ok: true });
  expect(store.saved).toEqual({ snapshot: snap('100'), syncedAt: 1234 });
});

it('keeps the old data and reports the error when the fetch fails', async () => {
  const store = fakeStore();
  await createSyncer({ snapshot: async () => snap('100') }, store, () => 1)();
  const result = await createSyncer({ snapshot: async () => { throw new Error('offline'); } }, store, () => 2)();
  expect(result).toEqual({ ok: false, error: 'offline' });
  expect(store.saved?.snapshot.portfolio.cash).toBe('100');
  expect(store.saved?.syncedAt).toBe(1);
});

it('shares one in-flight request between concurrent calls', async () => {
  const store = fakeStore();
  const snapshot = jest.fn(async () => snap('100'));
  const sync = createSyncer({ snapshot }, store);
  await Promise.all([sync(), sync(), sync()]);
  expect(snapshot).toHaveBeenCalledTimes(1);
  await sync();
  expect(snapshot).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- syncer`
Expected: FAIL (`Cannot find module '../sync/syncer'`).

- [ ] **Step 4: Implement the syncer**

`mobile/src/sync/syncer.ts`:

```ts
import type { Snapshot } from '../api/types';

export interface LocalStore {
  replaceSnapshot(snapshot: Snapshot, syncedAt: number): Promise<void>;
  readSnapshot(): Promise<{ snapshot: Snapshot; syncedAt: number } | null>;
  clear(): Promise<void>;
}

export type SyncResult = { ok: true } | { ok: false; error: string };

export function createSyncer(
  api: { snapshot(): Promise<Snapshot> },
  store: LocalStore,
  now: () => number = Date.now,
): () => Promise<SyncResult> {
  let inFlight: Promise<SyncResult> | null = null;

  const run = async (): Promise<SyncResult> => {
    try {
      const snapshot = await api.snapshot();
      await store.replaceSnapshot(snapshot, now());
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  return () => {
    if (!inFlight) inFlight = run().finally(() => { inFlight = null; });
    return inFlight;
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Implement the API client, token storage and SQLite store**

`mobile/src/auth/tokenStorage.ts`:

```ts
import * as SecureStore from 'expo-secure-store';

const KEY = 'papertrade.token';
export const getToken = () => SecureStore.getItemAsync(KEY);
export const setToken = (token: string) => SecureStore.setItemAsync(KEY, token);
export const clearToken = () => SecureStore.deleteItemAsync(KEY);
```

`mobile/src/api/client.ts`:

```ts
import type { OrderType, Side } from '../orders/validate';
import type { OrderDto, QuoteDto, Snapshot } from './types';

// Android emulator reaches the host machine at 10.0.2.2. On a phone, set EXPO_PUBLIC_API_URL
// to http://<your-computer-LAN-IP>:8000 (and run uvicorn with --host 0.0.0.0).
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8000';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function createApi(getToken: () => Promise<string | null>) {
  async function request<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (init.auth !== false) {
      const token = await getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${BASE_URL}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, typeof data.detail === 'string' ? data.detail : `HTTP ${res.status}`);
    return data as T;
  }

  return {
    register: (email: string, password: string) =>
      request<{ access_token: string }>('/auth/register', { method: 'POST', auth: false, body: { email, password } }),
    login: (email: string, password: string) =>
      request<{ access_token: string }>('/auth/login', { method: 'POST', auth: false, body: { email, password } }),
    me: () => request<{ id: number; email: string }>('/me'),
    quotes: (symbols: string[]) => request<Record<string, QuoteDto>>(`/quotes?symbols=${symbols.join(',')}`),
    snapshot: () => request<Snapshot>('/snapshot'),
    placeOrder: (o: { client_order_id: string; symbol: string; side: Side; type: OrderType; quantity: number; price?: string }) =>
      request<OrderDto>('/orders', { method: 'POST', body: o }),
    cancelOrder: (id: number) => request<void>(`/orders/${id}`, { method: 'DELETE' }),
    setWatchlist: (symbols: string[]) => request<{ symbols: string[] }>('/watchlist', { method: 'PUT', body: { symbols } }),
  };
}

export type Api = ReturnType<typeof createApi>;
```

`mobile/src/sync/sqliteStore.ts`:

```ts
import * as SQLite from 'expo-sqlite';
import type { Snapshot } from '../api/types';
import type { LocalStore } from './syncer';

export async function openSqliteStore(): Promise<LocalStore> {
  const db = await SQLite.openDatabaseAsync('papertrade.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS positions (symbol TEXT PRIMARY KEY, quantity INTEGER NOT NULL, avg_cost TEXT NOT NULL, last_price TEXT NOT NULL, unrealized_pnl TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, symbol TEXT NOT NULL, side TEXT NOT NULL, type TEXT NOT NULL, quantity INTEGER NOT NULL, price TEXT, status TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, quantity INTEGER NOT NULL, price TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS watchlist (symbol TEXT PRIMARY KEY, position INTEGER NOT NULL);
  `);

  const wipe = async () => {
    for (const table of ['meta', 'positions', 'orders', 'transactions', 'watchlist']) {
      await db.runAsync(`DELETE FROM ${table}`);
    }
  };

  return {
    async replaceSnapshot(s, syncedAt) {
      await db.withTransactionAsync(async () => {
        await wipe();
        for (const p of s.portfolio.positions) {
          await db.runAsync('INSERT INTO positions VALUES (?,?,?,?,?)', p.symbol, p.quantity, p.avg_cost, p.last_price, p.unrealized_pnl);
        }
        for (const o of s.orders) {
          await db.runAsync('INSERT INTO orders VALUES (?,?,?,?,?,?,?)', o.id, o.symbol, o.side, o.type, o.quantity, o.price, o.status);
        }
        for (const t of s.transactions) {
          await db.runAsync('INSERT INTO transactions VALUES (?,?,?,?,?,?,?)', t.id, t.order_id, t.symbol, t.side, t.quantity, t.price, t.created_at);
        }
        for (const [i, symbol] of s.watchlist.entries()) {
          await db.runAsync('INSERT INTO watchlist VALUES (?,?)', symbol, i);
        }
        const { positions: _omit, ...summary } = s.portfolio;
        await db.runAsync('INSERT INTO meta VALUES (?,?)', 'summary', JSON.stringify({ ...summary, server_time: s.server_time }));
        await db.runAsync('INSERT INTO meta VALUES (?,?)', 'synced_at', String(syncedAt));
      });
    },

    async readSnapshot() {
      const summaryRow = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = 'summary'");
      const syncedRow = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = 'synced_at'");
      if (!summaryRow || !syncedRow) return null;
      const { server_time, ...summary } = JSON.parse(summaryRow.value);
      const snapshot: Snapshot = {
        server_time,
        portfolio: { ...summary, positions: await db.getAllAsync('SELECT * FROM positions ORDER BY symbol') },
        orders: await db.getAllAsync('SELECT * FROM orders ORDER BY id DESC'),
        transactions: await db.getAllAsync('SELECT * FROM transactions ORDER BY id DESC'),
        watchlist: (await db.getAllAsync<{ symbol: string }>('SELECT symbol FROM watchlist ORDER BY position')).map((r) => r.symbol),
      };
      return { snapshot, syncedAt: Number(syncedRow.value) };
    },

    clear: wipe,
  };
}
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (The SQLite store needs a device to exercise; it is checked in Task 13.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(mobile): API client, SQLite store, and single-flight syncer"
```

---

### Task 13: Screens, navigation, and end-to-end run

UI is verified by running the app. The logic it relies on is tested in Tasks 2 to 12.

**Files:**
- Create: `mobile/src/AppContext.tsx`, `mobile/src/screens/AuthScreen.tsx`, `WatchlistScreen.tsx`, `OrderTicket.tsx`, `PortfolioScreen.tsx`, `ActivityScreen.tsx`, `mobile/src/format.ts`
- Modify: `mobile/App.tsx`

**Interfaces:**
- Consumes: `createApi`, `openSqliteStore`, `createSyncer`, `validateOrderInput`, token storage, `expo-crypto`'s `randomUUID`.
- Produces: `useApp()` returning `{ api, store, snapshot, syncedAt, syncError, sync(), signIn(token), signOut() }`.

- [ ] **Step 1: App context**

`AppContext.tsx` creates the API client, opens the SQLite store once, and owns the cached `snapshot`:
- on start: read the token; if present, load `store.readSnapshot()` into state first (so cached data shows immediately, even offline), then call `sync()`;
- `sync()` runs the single-flight syncer, then re-reads the store into state; on failure it sets `syncError` and keeps showing the cached data;
- `AppState` listener: call `sync()` whenever the app returns to the foreground; also `setInterval(sync, 30_000)` while signed in;
- `signIn(token)`: `store.clear()`, `setToken`, `sync()`; `signOut()`: `clearToken`, `store.clear()`, reset state. (Clearing on sign-in prevents one user seeing another user's cached data.)
- a 401 from any call triggers `signOut()`.

- [ ] **Step 2: Screens**

- `AuthScreen`: email + password fields, a Login / Register toggle, error text from `ApiError.message`; on success `signIn(access_token)`.
- `WatchlistScreen`: symbols come from `snapshot.watchlist`. While the screen is focused, poll `api.quotes(watchlist)` every 2 s into local state and show price with green/red color versus the previous poll; if polling fails, show the last-known prices dimmed with an "Offline" badge. Tapping a row opens `OrderTicket`. An "Edit" action lets the user add or remove symbols from the supported list and calls `api.setWatchlist`, then `sync()`.
- `OrderTicket` (modal): Buy/Sell toggle, Market/Limit/Stop chips, quantity input, price input (hidden for Market). The Confirm button is disabled unless `validateOrderInput(...).ok`. On confirm: `api.placeOrder({ client_order_id: randomUUID(), ... })`, then `sync()`, then show the resulting status (Filled / Open / Rejected). A 503 shows "No live price right now, try again". Keep the same `client_order_id` if the user taps Retry after a network error, so a retry cannot double-fill.
- `PortfolioScreen`: header with equity, cash, realized and unrealized P&L (green/red), a pull-to-refresh that calls `sync()`, a positions list, and a footer "Last synced <time>" using `syncedAt`.
- `ActivityScreen`: two sections, Orders (with a Cancel button on OPEN rows calling `api.cancelOrder` then `sync()`) and Transactions.
- `format.ts`: `formatMoney(s: string)` using `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })` for display only.

- [ ] **Step 3: Navigation**

`App.tsx`: wrap in `AppProvider`; if there is no token show `AuthScreen`; otherwise a bottom-tab navigator (Watchlist, Portfolio, Activity) with a sign-out button in the Portfolio header.

- [ ] **Step 4: Run everything and check behavior**

Terminal 1: `docker compose up -d`, then `cd backend; uv run uvicorn app.main:create_app --factory --host 0.0.0.0 --reload`
Terminal 2: `cd mobile; npx expo start`, open on an Android emulator (uses `10.0.2.2`) or on a phone with Expo Go (set `EXPO_PUBLIC_API_URL` to `http://<LAN-IP>:8000`).

Check:
1. Register; the watchlist shows AAPL, MSFT, TSLA with prices ticking about every 2 s.
2. Market buy 5 AAPL: portfolio cash drops, a position appears, Activity shows one FILLED order and one transaction.
3. Limit buy 5% below market stays OPEN; within a few minutes (or after cancelling) the state matches expectations in Activity; cancelling an OPEN order works.
4. Stop the backend (Ctrl+C), force-close and reopen the app: portfolio, orders, transactions and watchlist still show from SQLite, with the Offline badge and an old "Last synced" time.
5. Restart the backend, return to the app: data refreshes within one sync interval.
6. Sign out and register a second user: none of the first user's data appears.
7. Open the same app on an iPhone in Expo Go (same Wi-Fi) and repeat steps 1 and 2 to confirm iOS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(mobile): auth, watchlist, order ticket, portfolio, activity, offline sync"
```

---

## Resume claim checklist

Say each thing on the resume only once the task named here is done and verified.

| Resume claim | Made true by | Status after Phase 1 |
|---|---|---|
| Cross-platform, Android and iOS | Tasks 11 to 13, step 7 of the Task 13 run | True once you've run it on an iPhone (Expo Go) |
| Virtual funds, personalized watchlists | Tasks 6, 9, 10, 13 | True |
| Market and limit orders (plus stop) | Tasks 2 to 4, 7, 10, 13 | True |
| Portfolio, transaction history, real-time P&L | Tasks 3, 10, 13 | True |
| FastAPI, JWT, PostgreSQL | Tasks 6 to 10 | True |
| Redis caching for market data | Tasks 5, 10 | True (quotes are cached and read from Redis) |
| SQLite offline persistence + sync with the backend | Task 12, 13 | True for cached reads and foreground sync (on resume and every 30 s) |
| **Background** synchronization | Phase 2, item 5 | Not yet: OS-level background sync is not built |
| **Live** market prices | Phase 2, item 1 | Not yet: Phase 1 prices are simulated |
| **Interactive charts** | Phase 2, item 2 | Not yet |
| Kotlin | Phase 3, item 8 (optional) | Not in the plan: drop it from the resume or build the native module |

## As time permits

**Phase 2: make the resume claims fully true (~1 to 1.5 weeks)**
1. **Real quotes:** `FinnhubPriceSource` (or Alpaca) implementing `PriceSource`, polling REST on an interval that respects the free-tier rate limit, writing to the Redis cache. Check the provider's current limits and terms first. Keep the simulated source for tests and demos.
2. **Interactive charts:** store a downsampled price history per symbol (Redis list or a Postgres table), `GET /history?symbol=&range=1D|1W|1M`, and a line chart in the app using `react-native-svg` with a touch crosshair and range chips.
3. **Alembic migrations** replacing `create_all` at startup.
4. **Offline order outbox:** queue orders made while offline in SQLite with their `client_order_id`, and replay on reconnect (the idempotency key already makes this safe).
5. **Background sync:** `expo-background-task` to refresh the snapshot while the app is closed.
6. **CI and README:** GitHub Actions running `pytest` (with Postgres and Redis services) and `jest`, plus screenshots in the README for your GitHub link.

**Phase 3: depth (~1 week)**
7. Performance summary (win rate, best and worst trade, return over time) and a risk view (concentration, max drawdown) as pure Python functions with tests, plus an equity snapshot job.
8. Optional Kotlin: an Expo native module (Android) for biometric lock or a WorkManager sync. Only keep "Kotlin" on the resume if this exists.
9. Price alerts with `expo-notifications`; refresh tokens and logout-everywhere; rate limiting on auth routes.

**Phase 4: stretch**
10. Margin simulation (borrowing power, interest, margin-call warning), written test-first in `domain/` before any UI.
11. Deployment: backend on Render or Fly, Neon/Supabase Postgres, Upstash Redis; EAS Build for installable Android and iOS builds (an iOS store build needs an Apple Developer account).
12. Partial fills, short selling, cash reservation for resting BUY orders.

## Decisions to confirm before starting

1. **Python 3.12 via `uv`** instead of the installed 3.14: needed so binary dependencies install cleanly.
2. **Expo instead of bare React Native:** fastest path to Android and iOS on a Windows machine; iOS testing happens through Expo Go on a real iPhone since there is no Mac.
3. **Data provider** for Phase 2 (Finnhub vs Alpaca): not needed for Phase 1.
