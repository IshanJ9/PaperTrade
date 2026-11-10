# PaperTrade (complete, resume-matching) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cross-platform (Android + iOS) paper-trading app in which every sentence of the owner's resume entry is true: virtual funds, live prices, interactive charts, watchlists, market/limit orders, portfolio, transaction history, real-time P&L, SQLite offline persistence, background sync with a FastAPI backend (Kotlin on Android), JWT auth, PostgreSQL, Redis.

**Architecture:** Server-authoritative. FastAPI + PostgreSQL own accounts, orders, fills and P&L; a market loop pulls Finnhub quotes into Redis and runs the matching engine. The React Native (Expo, TypeScript) app reads a SQLite copy of one `/snapshot` document, so it opens offline; it syncs in the foreground from JavaScript, and in the background through a Kotlin WorkManager worker (Android) or `expo-background-task` (iOS). Refresh-token "families" give the Kotlin worker its own credentials.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 + psycopg 3, Alembic, PostgreSQL 16, Redis 7, httpx, PyJWT, argon2-cffi, pytest, uv, Docker Compose. Mobile: Expo (React Native, TypeScript), expo-sqlite, expo-secure-store, expo-dev-client, expo-background-task, react-native-svg, Jest. Kotlin: Expo Modules API, WorkManager, OkHttp, JUnit, MockWebServer.

**Spec:** `docs/superpowers/specs/2026-11-08-papertrade-resume-match-design.md`

**Relationship to the base plan:** `docs/superpowers/plans/2026-11-08-papertrade-fullstack.md` is **Part 1** of this plan. Execute its Tasks 1 to 13 exactly as written, in order, then execute Tasks 14 to 27 below. Its "As time permits" and "Decisions to confirm" sections are superseded by this file. The older native-Android plan (`2026-10-29-papertrade.md`) stays dead.

## Global Constraints

- Money and prices are `Decimal` in Python and **strings** in JSON and TypeScript; only the server does money arithmetic. Chart code may convert a price string to a number to compute pixel positions and a display-only percentage, never to store or send.
- Python pinned to 3.12 via `uv`. Postgres money columns `Numeric(18, 4)`.
- `app/domain/` imports no FastAPI, SQLAlchemy, Redis or Pydantic.
- Orders fill only at a fresh Redis quote (TTL-bound); no fresh quote means HTTP 503, never an invented or zero price.
- Every order carries a client-generated `client_order_id`; a repeat for the same user is the same order.
- No short selling; no cash reservation for resting BUY orders; starting cash `100000.00`.
- Access token 60 minutes. Refresh token 30 days, opaque, stored only as a SHA-256 hash.
- Secrets (`PT_JWT_SECRET`, `PT_FINNHUB_API_KEY`) come from untracked `.env` files; `.env.example` files hold placeholders only. Never commit a key.
- Android application id and iOS bundle identifier: `com.ishan.papertrade`.
- Local development reaches the backend over plain HTTP on the LAN (Android debug builds allow cleartext). Any build that talks to a deployed backend must use HTTPS.
- The Kotlin module is Android-only; JavaScript must work unchanged when it is absent (iOS, Expo Go, tests).
- Background sync is **read-only**: it pulls the snapshot and never places or flushes orders.
- The README may name only technologies that are actually used in the code.

## Review Focus

Failure modes the spec implies but the base plan's tests do not exercise, most likely first. Each has a named test in the owning task.

1. **Rotated refresh token lost in transit.** The server rotates, the response never arrives, the client retries with the old token. Expected: still signed in, not logged out forever. (Task 14 grace window; Task 23 `networkErrorOnRefreshKeepsTokenAndRetries`.)
2. **Offline-queued orders.** A queued MARKET order sent hours later, or sent as a different user. Expected: orders older than 24 h are never sent; the queue is wiped on sign-out and sign-in. (Task 22.)
3. **Market closed or bad quote.** Finnhub returns `c = 0` for unknown symbols, previous close off-hours, and HTTP 429 when throttled. Expected: no zero-price quotes, no crash, calls stay under the limit. (Task 15.)
4. **Empty or tiny chart history.** A new symbol, one point, or a flat price. Expected: a friendly empty state, no NaN path, no crash. (Tasks 16 and 21.)
5. **Two writers on one SQLite file / garbage into the cache.** The worker writes while the app reads, or the server returns an HTML error page. Expected: readers keep working, and a non-snapshot body is never cached. (Tasks 19, 23, 24.)

## Resume coverage matrix

Nothing in the resume entry is left to chance. Each phrase maps to the task that makes it true and the check that proves it (Task 27 runs all the checks).

| Resume phrase | Built by | Proven by |
|---|---|---|
| Cross-platform, Android and iOS | 11 to 13, 24, 25 | Task 27 steps 9 and 10 |
| Virtual funds | 3, 6, 9 | Task 13 step 4, check 2 |
| Live market prices | 5, 10, 15 | Task 27 step 3 |
| Interactive charts | 16, 21 | Task 27 step 5 |
| Personalized watchlists | 6, 10, 13 | Task 13 step 4, check 1 |
| Market and limit orders | 2, 4, 7, 10, 13 | Task 13 step 4, checks 2 and 3 |
| Portfolio tracking | 3, 10, 13 | Task 27 step 4 |
| Transaction history | 6, 10, 13 | Task 27 step 4 |
| Real-time profit/loss | 3, 10, 20 | Task 27 step 4 |
| SQLite persistence, data available across sessions | 12, 19 | Task 27 step 6 |
| Offline-friendly | 19, 22 | Task 27 steps 6 and 7 |
| Background synchronization | 23, 24, 25 | Task 27 steps 8 and 10 |
| FastAPI | 1, 9, 10 | `pytest` |
| JWT-based authentication | 8, 9, 14, 18 | `pytest`, Task 18 tests |
| PostgreSQL for persistent financial records | 6, 7, 17 | Task 17 migration test |
| Redis caching for frequently accessed market data | 5, 10, 15 | Task 27 step 3 (`redis-cli`) |
| Kotlin | 23, 24 | Task 23 JVM tests, Task 27 step 8 |
| TypeScript, React Native | 11 to 13, 18 to 22, 25 | `tsc --noEmit`, `npm test` |

## File structure (additions to the base plan)

```
backend/
  alembic.ini
  migrations/env.py, versions/0001_initial.py
  app/
    auth/refresh.py                       refresh-token families
    market/finnhub.py                     FinnhubPriceSource
    market/history.py                     HistoryRecorder, downsample, read/prune, simulated seed
    api/routes_market.py                  GET /history
  tests/auth/test_refresh.py  tests/api/test_auth_refresh.py
  tests/market/test_finnhub.py  tests/market/test_history.py  tests/db/test_migrations.py
shared/snapshot.fixture.json              one snapshot used by Jest and Kotlin tests
mobile/
  src/api/client.ts (rewritten)  src/auth/tokenStorage.ts (rewritten)
  src/sync/sqliteStore.ts (rewritten)  src/sync/background.ts  src/sync/backgroundTask.ts
  src/chart/geometry.ts  src/chart/PriceChart.tsx
  src/orders/outbox.ts  src/orders/outboxStore.ts
  src/screens/SymbolScreen.tsx
  src/liveStatus.ts
  src/__tests__/ client.test.ts sqliteStore.test.ts geometry.test.ts outbox.test.ts
                 liveStatus.test.ts background.test.ts helpers/nodeSqlite.ts
  modules/papertrade-sync/
    index.ts, src/PapertradeSyncModule.ts, src/__tests__/index.test.ts
    android/src/main/java/expo/modules/papertradesync/
      SyncEngine.kt HttpSyncApi.kt KeystoreTokenVault.kt SqliteSnapshotCache.kt
      SyncWorker.kt SyncScheduler.kt PapertradeSyncModule.kt
    android/src/test/java/expo/modules/papertradesync/ SyncEngineTest.kt HttpSyncApiTest.kt
.github/workflows/ci.yml  README.md  backend/.env.example  mobile/.env.example
docs/acceptance.md  docs/screenshots/
```

---

## Part 1: Tasks 1 to 13

Execute Tasks 1 to 13 of `2026-11-08-papertrade-fullstack.md` exactly as written. If the folder is not yet a git repository, run `git init` before Task 1's first commit. When Task 13's end-to-end run (steps 1 to 6) passes, continue below. (Its step 7, the iPhone run, is repeated in Task 27.)

Where later tasks rewrite files from Part 1, they say so: `client.ts`, `tokenStorage.ts`, `sqliteStore.ts`, `AppContext.tsx`, `main.py` lifespan, `universe.py`, `config.py`.

---

## Backend additions

### Task 14: Refresh tokens (families, rotation, grace window, background tokens)

**Files:**
- Create: `backend/app/auth/refresh.py`, `backend/tests/auth/test_refresh.py`, `backend/tests/api/test_auth_refresh.py`
- Modify: `backend/app/db/models.py`, `backend/app/config.py`, `backend/app/api/routes_auth.py`, `backend/app/api/schemas.py`

**Interfaces:**
- Consumes: `Base`, `User`, `session_factory` fixture and `make_user` helper (import as the Task 7 tests do), `create_token`.
- Produces:
  - `RefreshTokenRow(id, user_id, family_id: str, parent_family_id: str | None, token_hash: str unique, expires_at, rotated_at: datetime | None, revoked_at: datetime | None)`
  - `REUSE_GRACE_S = 60`; `class InvalidRefreshToken(Exception)`
  - `issue_refresh_token(session, user_id: int, *, now: datetime, days: int = 30, parent_family_id: str | None = None) -> str` starts a new family.
  - `issue_child_token(session, parent_raw: str, *, now: datetime, days: int = 30) -> str`: validates the parent token (without rotating it) and starts a new family whose `parent_family_id` is the parent's family.
  - `rotate_refresh_token(session, raw: str, *, now: datetime, days: int = 30) -> tuple[int, str]`: returns `(user_id, new_raw)` in the same family. Takes `SELECT ... FOR UPDATE` on the row. An unknown, expired or revoked token raises `InvalidRefreshToken`. A token already rotated **within `REUSE_GRACE_S`** is accepted and yields another new token in the same family; **after** the grace period the family and its children are revoked and `InvalidRefreshToken` is raised.
  - `revoke_family_tree(session, family_id: str, *, now: datetime) -> None`: revokes the family and every family whose `parent_family_id` is in the tree.
  - Endpoints: `register` and `login` now return `{access_token, refresh_token, token_type}`; `POST /auth/refresh {refresh_token} -> {access_token, refresh_token, token_type}`, 401 on any failure; `POST /auth/background-token {refresh_token} -> {refresh_token}` (child family), 401 on failure; `POST /auth/logout {refresh_token} -> 204` always (revokes the family tree).
  - `Settings.refresh_days: int = 30`.

- [ ] **Step 1: Write the failing unit tests**

`backend/tests/auth/test_refresh.py` (`NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)`):

```python
def test_rotation_returns_new_token_for_same_user(session_factory):
    uid = make_user(session_factory)
    with session_factory() as s:
        old = issue_refresh_token(s, uid, now=NOW); s.commit()
        user_id, new = rotate_refresh_token(s, old, now=NOW + timedelta(minutes=1)); s.commit()
    assert user_id == uid and new != old

def test_unknown_and_expired_tokens_are_rejected(session_factory):
    uid = make_user(session_factory)
    with session_factory() as s:
        tok = issue_refresh_token(s, uid, now=NOW, days=1); s.commit()
        with pytest.raises(InvalidRefreshToken): rotate_refresh_token(s, "nope", now=NOW)
        with pytest.raises(InvalidRefreshToken): rotate_refresh_token(s, tok, now=NOW + timedelta(days=2))

def test_old_token_within_grace_is_accepted_not_revoked(session_factory):
    uid = make_user(session_factory)
    with session_factory() as s:
        old = issue_refresh_token(s, uid, now=NOW); s.commit()
        _, first = rotate_refresh_token(s, old, now=NOW); s.commit()
        _, second = rotate_refresh_token(s, old, now=NOW + timedelta(seconds=REUSE_GRACE_S - 1)); s.commit()
        rotate_refresh_token(s, second, now=NOW + timedelta(seconds=REUSE_GRACE_S))  # family still alive

def test_old_token_after_grace_revokes_whole_family(session_factory):
    uid = make_user(session_factory)
    with session_factory() as s:
        old = issue_refresh_token(s, uid, now=NOW); s.commit()
        _, newest = rotate_refresh_token(s, old, now=NOW); s.commit()
        late = NOW + timedelta(seconds=REUSE_GRACE_S + 1)
        with pytest.raises(InvalidRefreshToken): rotate_refresh_token(s, old, now=late)
        s.commit()
        with pytest.raises(InvalidRefreshToken): rotate_refresh_token(s, newest, now=late)

def test_child_family_is_independent_but_dies_with_parent(session_factory):
    uid = make_user(session_factory)
    with session_factory() as s:
        parent = issue_refresh_token(s, uid, now=NOW)
        child = issue_child_token(s, parent, now=NOW); s.commit()
        rotate_refresh_token(s, child, now=NOW); s.commit()          # parent token unaffected
        rotate_refresh_token(s, parent, now=NOW); s.commit()
        # theft detection on the child must not touch the parent
        late = NOW + timedelta(seconds=REUSE_GRACE_S + 1)
        with pytest.raises(InvalidRefreshToken): rotate_refresh_token(s, child, now=late)
        s.commit()
        rotate_refresh_token(s, parent, now=late)
        # logging out the parent kills the child
        revoke_family_tree(s, family_of(s, parent), now=late); s.commit()
        with pytest.raises(InvalidRefreshToken): rotate_refresh_token(s, child, now=late)
```

(`family_of(session, raw)` is a small test helper that hashes `raw` and reads `RefreshTokenRow.family_id`.)

`backend/tests/api/test_auth_refresh.py`: `test_register_and_login_return_refresh_token`; `test_refresh_returns_working_access_token` (new access token calls `GET /me` -> 200); `test_refresh_with_garbage_is_401`; `test_logout_then_refresh_is_401`; `test_background_token_works_and_logout_of_parent_revokes_it`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend; uv run pytest tests/auth/test_refresh.py tests/api/test_auth_refresh.py -v`
Expected: FAIL with `ModuleNotFoundError: app.auth.refresh`.

- [ ] **Step 3: Implement `refresh.py`, the model, schemas and routes**

Raw tokens are `secrets.token_urlsafe(32)`; store `hashlib.sha256(raw).hexdigest()`. Family ids are `uuid4().hex`. Add `RefreshTokenRow` to `db/models.py` (index on `user_id`, unique on `token_hash`). Keep the response `access_token` / `token_type` fields unchanged so Part 1's tests stay green.

- [ ] **Step 4: Run to verify they pass, plus the whole suite**

Run: `cd backend; uv run pytest -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(auth): refresh-token families with rotation, grace window and background tokens"
```

---

### Task 15: Live quotes from Finnhub

**Files:**
- Create: `backend/app/market/finnhub.py`, `backend/tests/market/test_finnhub.py`
- Modify: `backend/app/market/universe.py`, `backend/app/config.py`, `backend/app/main.py`, `backend/pyproject.toml` (add `httpx`), `backend/.env.example`

**Interfaces:**
- Consumes: `Quote`, `PriceSource` Protocol, `QuoteCache`.
- Produces:
  - `FinnhubPriceSource(api_key: str, client: httpx.AsyncClient, *, calls_per_min: int = 40, clock: Callable[[], float] = time.time, sleep: Callable[[float], Awaitable[None]] = asyncio.sleep)`; `quotes(symbols)` loops forever over the symbols in order, one `GET https://finnhub.io/api/v1/quote?symbol=X` per call with the key in the `X-Finnhub-Token` header (never in the URL), waiting `60 / calls_per_min` seconds between calls. `cycle_s(n_symbols: int) -> float` = `n_symbols * 60 / calls_per_min`.
  - Yields `Quote(symbol, Decimal(str(c)).quantize(Decimal("0.01")), ts_ms=int(clock()*1000))` only when the JSON field `c` is a number greater than 0. HTTP 429 sleeps 5 s and continues; any other HTTP or network error is logged and skipped. One failing symbol never stops the loop.
  - `Settings.price_source: Literal["simulated", "finnhub"] = "simulated"`, `Settings.finnhub_api_key: str | None = None`. `price_source="finnhub"` without a key fails startup with a message naming `PT_FINNHUB_API_KEY`.
  - `UNIVERSE` grows to 15 US symbols (for example AAPL, MSFT, TSLA, NVDA, AMZN, GOOGL, META, NFLX, AMD, INTC, JPM, V, DIS, KO, NKE); the values are only seeds for the simulated source. `DEFAULT_WATCHLIST` is unchanged.
  - `main.py` builds `QuoteCache(ttl_s=max(30, ceil(2 * cycle_s)))` when Finnhub is selected (15 symbols at 40 calls/min gives a 22.5 s cycle and a 45 s TTL), so quotes never expire between polls.
- Free-tier facts (re-verify at https://finnhub.io/pricing before building): 60 API calls per minute; `/quote` returns `c` (current), `pc` (previous close), `t` (last trade time). Outside market hours `c` is the last/previous-close price, so paper orders fill at it. The README must say so.

- [ ] **Step 1: Write the failing tests** (`httpx.MockTransport`, fake `sleep` that records durations, fake clock)

```python
async def test_yields_quote_with_two_decimal_price_and_clock_timestamp(): ...
    # response {"c": 190.1234} -> Quote("AAPL", D("190.12"), ts_ms=clock_ms)
async def test_api_key_is_sent_in_header_not_url(): ...
    # request.headers["X-Finnhub-Token"] == "k"; "k" not in str(request.url)
async def test_zero_or_missing_price_is_skipped(): ...
    # {"c": 0}, {}, {"c": null}, {"c": "x"} yield nothing; later symbols still yield
async def test_calls_are_spaced_by_rate_budget(): ...
    # calls_per_min=40 -> every recorded sleep == 1.5
async def test_429_backs_off_and_does_not_yield(): ...
    # first response 429 -> sleep(5) recorded, no Quote, next call proceeds
async def test_network_error_for_one_symbol_does_not_stop_the_loop(): ...
def test_cycle_seconds(): assert source.cycle_s(15) == 22.5
def test_finnhub_without_key_fails_settings_validation(): ...
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend; uv add httpx; uv run pytest tests/market/test_finnhub.py -v`
Expected: FAIL (`app.market.finnhub` not found).

- [ ] **Step 3: Implement `FinnhubPriceSource`, the settings, the universe and the `main.py` selection**

Use `async for`-style generator with `itertools.cycle`. Keep `SimulatedPriceSource` as the default and for tests.

- [ ] **Step 4: Run to verify they pass, plus the whole suite**

Run: `cd backend; uv run pytest -v`
Expected: all PASS.

- [ ] **Step 5: Check against the real feed (needs a free key)**

Put `PT_PRICE_SOURCE=finnhub` and `PT_FINNHUB_API_KEY=<your key>` in untracked `backend/.env`, start the stack, then:

```bash
docker compose up -d
cd backend && uv run uvicorn app.main:create_app --factory --host 0.0.0.0
```

Register through the API (or the app), then `GET /quotes?symbols=AAPL`. Expected: a price within a cent of the quote shown on a second source (during US market hours), updating about every 22 s; `docker compose exec redis redis-cli TTL quote:AAPL` shows a TTL of at most 45.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(market): Finnhub live quotes with rate budget; 15-symbol universe"
```

---

### Task 16: Price history for charts

**Files:**
- Create: `backend/app/market/history.py`, `backend/app/api/routes_market.py`, `backend/tests/market/test_history.py`
- Modify: `backend/app/db/models.py`, `backend/app/market/loop.py`, `backend/app/main.py`

**Interfaces:**
- Consumes: `Quote`, `UNIVERSE`, `current_user_id`, `session_factory`.
- Produces:
  - `PricePoint(symbol: str, minute_ts: int, price: Numeric(18,4))`, primary key `(symbol, minute_ts)`, `minute_ts` = epoch minutes.
  - `RANGES = {"1D": 24*3600*1000, "1W": 7*86400*1000, "1M": 30*86400*1000}` (milliseconds).
  - `downsample(points: list[tuple[int, Decimal]], max_points: int = 200) -> list[tuple[int, Decimal]]`: input sorted by time; inputs of at most `max_points` come back unchanged; otherwise the first and last points are kept and each of the evenly sized time slices contributes its last point; output is sorted, has no duplicates and at most `max_points` items.
  - `HistoryRecorder(session_factory, *, throttle_s: float = 15, clock=time.time)` with `record(quote: Quote) -> bool`: upserts `(symbol, ts_ms // 60000)` with the quote price; returns False without touching the DB if that symbol was written less than `throttle_s` ago.
  - `read_history(session, symbol: str, range_key: str, now_ms: int) -> list[tuple[int, Decimal]]` (already downsampled; `t` in ms), `prune_history(session, older_than_ms: int) -> int`.
  - `seed_simulated_history(session_factory, start: Mapping[str, Decimal], now_ms: int, days: int = 7, seed: int = 42) -> int`: only when `PricePoint` is empty; deterministic random walk at 5-minute resolution; returns rows inserted.
  - `GET /history?symbol=AAPL&range=1D` (Bearer) `-> {"symbol", "range", "points": [{"t": 1700000000000, "p": "190.12"}]}`; 422 for a symbol outside `UNIVERSE` or an unknown range.
  - `run_market_loop(source, cache, service, symbols, recorder=None)`: after caching a quote, calls `recorder.record(quote)` in the worker thread; a recorder error is logged and ignored. Startup: seed when `price_source == "simulated"`; prune points older than 35 days hourly.

- [ ] **Step 1: Write the failing tests**

```python
def test_downsample_small_input_is_unchanged(): ...
def test_downsample_keeps_first_and_last_and_caps_length():
    pts = [(i, D(i)) for i in range(1, 1001)]
    out = downsample(pts, 200)
    assert out[0] == pts[0] and out[-1] == pts[-1] and len(out) <= 200
    assert [t for t, _ in out] == sorted({t for t, _ in out})
def test_downsample_handles_empty_and_single_point(): ...
def test_recorder_upserts_same_minute_and_throttles(): ...   # two quotes in one minute -> one row, latest price; second call within 15 s returns False
def test_history_ranges_filter_by_age(): ...                 # points at now-2h, now-3d, now-20d: 1D -> 1, 1W -> 2, 1M -> 3
def test_prune_removes_only_old_rows(): ...
def test_seed_runs_once_and_is_deterministic(): ...
def test_history_endpoint_requires_auth_and_validates_inputs(client): ...  # 401 / 422 / 200 shape with "t" int and "p" string
def test_history_for_symbol_with_no_data_is_empty_list(client): ...        # 200, points == []
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend; uv run pytest tests/market/test_history.py -v`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the model, `history.py`, the route and the loop/lifespan changes**

Use `INSERT ... ON CONFLICT (symbol, minute_ts) DO UPDATE` through `sqlalchemy.dialects.postgresql.insert`. `read_history` selects by `minute_ts >= (now_ms - range)//60000`, ordered by time.

- [ ] **Step 4: Run to verify they pass, plus the whole suite**

Run: `cd backend; uv run pytest -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(market): price history storage, downsampling and GET /history"
```

---

### Task 17: Alembic migrations

**Files:**
- Create: `backend/alembic.ini`, `backend/migrations/env.py`, `backend/migrations/versions/0001_initial.py`, `backend/tests/db/test_migrations.py`
- Modify: `backend/app/main.py`, `backend/app/config.py`, `backend/pyproject.toml` (add `alembic`)

**Interfaces:**
- Consumes: `Base.metadata` including the Task 14 and Task 16 tables.
- Produces: `uv run alembic upgrade head` builds the full schema. `Settings.auto_create_tables: bool = False`; the lifespan calls `Base.metadata.create_all` only when it is true (`conftest` and the `.env.example` for local dev set it to true; production relies on Alembic).

- [ ] **Step 1: Write the failing test**

`backend/tests/db/test_migrations.py`: create a scratch database `papertrade_migrations_test` through an admin connection to the test server; run `alembic.command.upgrade(cfg, "head")` against it (override `sqlalchemy.url`); then
- `test_upgrade_creates_every_model_table`: `inspect(engine).get_table_names()` equals `set(Base.metadata.tables) | {"alembic_version"}`;
- `test_migrations_match_models`: `alembic.autogenerate.compare_metadata(MigrationContext.configure(conn), Base.metadata) == []`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend; uv add alembic; uv run pytest tests/db/test_migrations.py -v`
Expected: FAIL (no `alembic.ini` / no versions).

- [ ] **Step 3: Initialise Alembic and generate the initial revision**

Run: `uv run alembic init migrations`, point `env.py` at `Base.metadata` and `Settings().database_url`, then `uv run alembic revision --autogenerate -m "initial" --rev-id 0001`. Review the generated file by eye: every table from Tasks 6, 14 and 16 is present, money columns are `Numeric(18, 4)`, and the unique constraints exist. Switch the lifespan to the `auto_create_tables` flag.

- [ ] **Step 4: Run to verify it passes, plus the whole suite**

Run: `cd backend; uv run pytest -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): Alembic migrations replace create_all in production"
```

---

## Mobile additions

### Task 18: API client with token refresh

**Files:**
- Rewrite: `mobile/src/api/client.ts`, `mobile/src/auth/tokenStorage.ts`
- Modify: `mobile/src/api/types.ts`, `mobile/src/AppContext.tsx`, `mobile/src/screens/AuthScreen.tsx`
- Test: `mobile/src/__tests__/client.test.ts`

**Interfaces:**
- Consumes: Part 1's `ApiError`, DTO types, backend endpoints from Task 14.
- Produces:
  - `type Tokens = { access: string; refresh: string }`
  - `interface TokenStore { getAccess(): Promise<string | null>; getRefresh(): Promise<string | null>; set(t: Tokens): Promise<void>; clear(): Promise<void> }` and `secureTokenStore: TokenStore` (expo-secure-store, keys `papertrade.access` / `papertrade.refresh`).
  - `createApi(opts: { baseUrl: string; tokens: TokenStore; fetchImpl?: typeof fetch; onAuthLost?: () => void; onTokensChanged?: (t: Tokens) => void })`. Methods keep Part 1's names (`register`, `login`, `me`, `quotes`, `snapshot`, `placeOrder`, `cancelOrder`, `setWatchlist`) and add `portfolio(): Promise<PortfolioDto>`, `history(symbol: string, range: '1D' | '1W' | '1M'): Promise<HistoryDto>`, `backgroundToken(): Promise<string>`, `logout(): Promise<void>`.
  - Behaviour: `register`/`login` store the returned tokens and call `onTokensChanged`. A 401 on an authenticated call triggers one **single-flight** `POST /auth/refresh`; on success the tokens are stored and the original call retried once; if the refresh itself returns 401 the tokens are cleared, `onAuthLost()` is called and `ApiError(401, …)` is thrown; a network error during refresh keeps the tokens and rethrows. `logout()` posts `/auth/logout` best-effort, then clears tokens.
  - `HistoryDto = { symbol: string; range: string; points: { t: number; p: string }[] }`.
  - `AppContext`: `signIn()` takes no argument (tokens are already stored): clears the local store, then `sync()`. `signOut()` calls `api.logout()`, clears tokens and the store. `onAuthLost` calls `signOut()` locally without the network call.

- [ ] **Step 1: Write the failing tests** (fake `fetchImpl` queue, in-memory `TokenStore`)

```ts
it('login stores tokens and notifies', ...)
it('retries once with a refreshed token after a 401', async () => {
  // responses: GET /snapshot 401, POST /auth/refresh 200 {access:'a2',refresh:'r2'}, GET /snapshot 200
  // expect result returned, tokens.set called with {access:'a2',refresh:'r2'}, Authorization on retry === 'Bearer a2'
});
it('concurrent 401s share a single refresh call', ...)       // 3 parallel snapshot() calls -> exactly 1 /auth/refresh
it('refresh rejected: clears tokens, calls onAuthLost, throws ApiError 401', ...)
it('network error during refresh keeps tokens and rethrows', ...)
it('does not loop: a second 401 after refresh is thrown', ...)
it('logout clears tokens even when the request fails', ...)
it('backgroundToken posts the current refresh token and returns the child token', ...)
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd mobile; npm test -- client`
Expected: FAIL (`createApi` signature mismatch).

- [ ] **Step 3: Rewrite `client.ts` and `tokenStorage.ts`; update `AppContext` and `AuthScreen`**

Base URL still comes from `process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8000'`; `App`/`AppContext` pass it in. `AuthScreen` calls `api.login`/`api.register` then `signIn()`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd mobile; npm test; npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(mobile): API client with single-flight token refresh"
```

---

### Task 19: Snapshot cache as one SQLite row (shared contract)

**Files:**
- Create: `shared/snapshot.fixture.json`, `mobile/src/__tests__/helpers/nodeSqlite.ts`, `mobile/src/__tests__/sqliteStore.test.ts`
- Rewrite: `mobile/src/sync/sqliteStore.ts`

**Interfaces:**
- Consumes: `Snapshot`, `LocalStore` (Part 1 `syncer.ts`).
- Produces:
  - `interface SqlDb { execAsync(sql: string): Promise<void>; runAsync(sql: string, ...params: unknown[]): Promise<unknown>; getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> }` (expo-sqlite's database satisfies it).
  - `createSqliteStore(db: SqlDb): Promise<LocalStore>`; `openSqliteStore(): Promise<LocalStore>` opens `papertrade.db` and calls it.
  - **The cross-language contract** (the Kotlin worker writes the same row):
    ```sql
    CREATE TABLE IF NOT EXISTS snapshot_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT NOT NULL,        -- the raw GET /snapshot response body
      synced_at INTEGER NOT NULL -- epoch milliseconds
    );
    ```
  - `createSqliteStore` also runs `PRAGMA journal_mode = WAL;` and `PRAGMA busy_timeout = 5000;` and drops the old relational tables (`DROP TABLE IF EXISTS meta, positions, orders, transactions, watchlist`).
  - `shared/snapshot.fixture.json`: a realistic `Snapshot` (one position, two orders, three transactions, three watchlist symbols, money as strings), used by the Jest tests here and by the Kotlin tests in Tasks 23 and 24.
  - Test helper `nodeSqlite.ts`: wraps Node's built-in `node:sqlite` `DatabaseSync(':memory:')` in the `SqlDb` interface (if Jest cannot resolve `node:sqlite`, use `better-sqlite3` instead).

- [ ] **Step 1: Write the failing tests**

```ts
it('round-trips a snapshot with its sync time', ...)
it('replace overwrites the single row', ...)
it('clear makes readSnapshot return null', ...)
it('reads a row written by another process with different JSON whitespace', async () => {
  // INSERT the fixture file's raw text straight into snapshot_cache (simulating the Kotlin worker)
  // expect readSnapshot().snapshot toEqual JSON.parse(fixtureText) and syncedAt toBe the inserted value
});
it('refuses a second row', ...)               // inserting id = 2 violates the CHECK constraint
it('a corrupt json column reads as null instead of throwing', ...)
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd mobile; npm test -- sqliteStore`
Expected: FAIL (`createSqliteStore` not exported).

- [ ] **Step 3: Rewrite `sqliteStore.ts`**

`replaceSnapshot` does `INSERT OR REPLACE INTO snapshot_cache VALUES (1, ?, ?)`. `readSnapshot` returns `null` on a missing row **or** on `JSON.parse` failure or a missing `portfolio` key (a damaged cache must not crash the app).

- [ ] **Step 4: Run to verify they pass**

Run: `cd mobile; npm test; npx tsc --noEmit`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(mobile): single-row snapshot cache with shared fixture"
```

---

### Task 20: Live portfolio P&L

**Files:**
- Create: `mobile/src/liveStatus.ts`, `mobile/src/__tests__/liveStatus.test.ts`
- Modify: `mobile/src/screens/PortfolioScreen.tsx`

**Interfaces:**
- Consumes: `api.portfolio()` (Task 18), `useApp()`.
- Produces: `liveStatus(lastOkMs: number | null, nowMs: number, maxAgeMs = 10_000): 'live' | 'stale' | 'offline'` (`null` is `'offline'`; at most `maxAgeMs` old is `'live'`; otherwise `'stale'`).
- Behaviour: while the Portfolio tab is focused and the app is active, poll `api.portfolio()` every 3 s; show the freshest of polled and cached data; header badge: **LIVE** (green), **DELAYED** (amber, `stale`) or **OFFLINE** (grey, shows "Last synced <time>"). P&L amounts stay server-computed strings.

- [ ] **Step 1: Write the failing test**

```ts
it('is live within the max age', () => expect(liveStatus(1000, 5000)).toBe('live'));
it('is stale after the max age', () => expect(liveStatus(1000, 20000)).toBe('stale'));
it('is offline with no successful poll', () => expect(liveStatus(null, 5000)).toBe('offline'));
it('boundary: exactly max age is live', () => expect(liveStatus(0, 10_000)).toBe('live'));
```

- [ ] **Step 2: Run to verify it fails** — `cd mobile; npm test -- liveStatus` — Expected: FAIL.

- [ ] **Step 3: Implement `liveStatus` and the polling in `PortfolioScreen`** (use `useFocusEffect` + `AppState`; stop polling when blurred or backgrounded).

- [ ] **Step 4: Run to verify it passes** — `cd mobile; npm test; npx tsc --noEmit` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(mobile): live portfolio P&L polling with live/delayed/offline badge"
```

---

### Task 21: Interactive price charts

**Files:**
- Create: `mobile/src/chart/geometry.ts`, `mobile/src/chart/PriceChart.tsx`, `mobile/src/screens/SymbolScreen.tsx`, `mobile/src/__tests__/geometry.test.ts`
- Modify: `mobile/src/screens/WatchlistScreen.tsx`, `mobile/App.tsx` (stack navigator entry for `Symbol`)

**Interfaces:**
- Consumes: `api.history`, `api.quotes`, `OrderTicket`, `HistoryDto`.
- Produces:
  - `type ChartPoint = { t: number; p: string }`
  - `buildLinePath(points: ChartPoint[], width: number, height: number, pad = 0): { d: string; xs: number[]; ys: number[]; min: number; max: number }`: x is linear in `t` across `[pad, width - pad]`, y is inverted across `[pad, height - pad]`; coordinates are rounded to 2 decimals with trailing zeros trimmed; fewer than 2 points returns `d: ""`; a flat series (min equals max) draws at `height / 2`; points with equal `t` do not produce NaN.
  - `nearestIndex(xs: number[], x: number): number` (clamped to the valid range; `-1` for an empty array).
  - `percentChange(first: string, last: string): number | null` (display only; `null` if `first` is not a positive number).
  - `PriceChart({ symbol, range, onRangeChange })`: line via `react-native-svg`, drag (PanResponder) moves a crosshair and shows the price string and time of the nearest point; range chips 1D / 1W / 1M; states: loading, **empty** ("Not enough history yet"), **offline/error** ("Chart needs a connection", retry button).
  - `SymbolScreen({ symbol })`: live price from `api.quotes` every 2 s, `PriceChart`, Buy and Sell buttons opening `OrderTicket`, and an add/remove-from-watchlist toggle. Tapping a watchlist row opens `SymbolScreen`.
  - Install: `npx expo install react-native-svg`.

- [ ] **Step 1: Write the failing tests**

```ts
it('draws a three-point line', () => {
  const r = buildLinePath([{t:0,p:'10'},{t:1,p:'20'},{t:2,p:'10'}], 100, 50);
  expect(r.d).toBe('M0,50 L50,0 L100,50');
  expect(r.xs).toEqual([0, 50, 100]); expect(r.ys).toEqual([50, 0, 50]);
});
it('returns an empty path for fewer than two points', ...)          // [] and a single point -> d === ''
it('draws a flat series in the middle', ...)                         // every y === 25 for height 50
it('survives duplicate timestamps without NaN', ...)                 // d does not contain 'NaN'
it('respects padding', ...)
it('nearestIndex picks the closest x and clamps', () => {
  expect(nearestIndex([0, 50, 100], 40)).toBe(1);
  expect(nearestIndex([0, 50, 100], -20)).toBe(0);
  expect(nearestIndex([0, 50, 100], 999)).toBe(2);
  expect(nearestIndex([], 5)).toBe(-1);
});
it('percentChange', () => { expect(percentChange('100', '110')).toBeCloseTo(10); expect(percentChange('0', '5')).toBeNull(); });
```

- [ ] **Step 2: Run to verify they fail** — `cd mobile; npm test -- geometry` — Expected: FAIL.

- [ ] **Step 3: Implement `geometry.ts`, then `PriceChart` and `SymbolScreen`**

- [ ] **Step 4: Run to verify they pass** — `cd mobile; npm test; npx tsc --noEmit` — Expected: PASS.

- [ ] **Step 5: Check on a device** (with the backend from Task 16 running, simulated source seeded): open a symbol; the chart draws; dragging moves the crosshair and updates the price label; the 1D / 1W / 1M chips change the line; with the backend stopped the chart shows the connection message, not a crash.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(mobile): interactive price chart with crosshair and range chips"
```

---

### Task 22: Offline order outbox

**Files:**
- Create: `mobile/src/orders/outbox.ts`, `mobile/src/orders/outboxStore.ts`, `mobile/src/__tests__/outbox.test.ts`
- Modify: `mobile/src/screens/OrderTicket.tsx`, `mobile/src/screens/ActivityScreen.tsx`, `mobile/src/AppContext.tsx`

**Interfaces:**
- Consumes: `Api.placeOrder`, `ApiError`, `OrderDto`, `SqlDb` and the `nodeSqlite` helper (Task 19).
- Produces:
  - `type PlaceOrderInput = { client_order_id: string; symbol: string; side: Side; type: OrderType; quantity: number; price?: string }`
  - `type QueuedOrder = { client_order_id: string; payload: PlaceOrderInput; queued_at: number; status: 'queued' | 'rejected' | 'expired'; error?: string }`
  - `interface OutboxStore { list(): Promise<QueuedOrder[]>; add(o: QueuedOrder): Promise<void>; update(id: string, patch: Partial<Pick<QueuedOrder, 'status' | 'error'>>): Promise<void>; remove(id: string): Promise<void>; clear(): Promise<void> }` (`list` is oldest first)
  - `createSqliteOutbox(db: SqlDb): Promise<OutboxStore>` with table `outbox(client_order_id TEXT PRIMARY KEY, payload TEXT NOT NULL, queued_at INTEGER NOT NULL, status TEXT NOT NULL, error TEXT)`.
  - `OUTBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000`
  - `isNetworkError(e: unknown): boolean`: true for anything that is not an `ApiError` (a `fetch` failure).
  - `submitOrder(api, outbox, input, now = Date.now): Promise<{ kind: 'sent'; order: OrderDto } | { kind: 'queued' } | { kind: 'rejected'; error: string }>`: tries the API; a network error enqueues and returns `queued`; an `ApiError` (including 503 "no live price") is **not** queued and returns `rejected` with its message.
  - `flushOutbox(api, outbox, now = Date.now): Promise<{ sent: number; rejected: number; expired: number; remaining: number }>`: processes `queued` items oldest first. Older than `OUTBOX_MAX_AGE_MS`: mark `expired`, never send. Network error or 503: stop and leave the rest `queued`. Other `ApiError`: mark `rejected` with the message and continue. Success: remove.
- Behaviour in the app: `sync()` becomes `flushOutbox` then the snapshot syncer. `signIn()` and `signOut()` call `outbox.clear()`; sign-out with queued items first asks for confirmation. `OrderTicket` shows "Queued, it will be sent when you are back online" for `queued`. `ActivityScreen` has a "Queued" section (queued / rejected / expired rows, each removable). The background worker never calls `flushOutbox`.

- [ ] **Step 1: Write the failing tests** (fake `api.placeOrder` that records calls and, like the server, returns the same order for a repeated `client_order_id`)

```ts
it('sends immediately when online', ...)                              // kind 'sent', outbox empty
it('queues on a network error and keeps the same client_order_id', ...)
it('does not queue API rejections, including 503', ...)               // kind 'rejected'
it('flush sends oldest first and removes sent items', ...)
it('flush stops at the first network error and keeps the rest queued in order', ...)
it('flush marks 4xx as rejected with the message and continues', ...)
it('flush never sends an item older than 24h and marks it expired', async () => {
  const now = 1_000_000_000_000;
  // item queued_at = now - OUTBOX_MAX_AGE_MS - 1 -> api.placeOrder not called, status 'expired'
});
it('flushing twice after a partial failure never double-sends an id', ...)   // idempotency via the fake server
it('clear empties the outbox', ...)
it('sqlite outbox round-trips and preserves order', ...)               // using the nodeSqlite helper
```

- [ ] **Step 2: Run to verify they fail** — `cd mobile; npm test -- outbox` — Expected: FAIL.

- [ ] **Step 3: Implement `outbox.ts` and `outboxStore.ts`, then wire the screens and `AppContext`**

- [ ] **Step 4: Run to verify they pass** — `cd mobile; npm test; npx tsc --noEmit` — Expected: PASS.

- [ ] **Step 5: Check on a device:** enable airplane mode, place a limit order: the ticket says "Queued", Activity lists it under Queued. Disable airplane mode: within one sync interval it disappears from Queued and appears once in Orders. Repeat with two orders: both are sent once, in order.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(mobile): offline order outbox with expiry and idempotent replay"
```

---

## Background sync

### Task 23: Kotlin sync engine (pure logic, JVM-tested)

**Files:**
- Create (via scaffold): `mobile/modules/papertrade-sync/` — run `cd mobile; npx create-expo-module@latest --local papertrade-sync` and accept the defaults; delete the generated sample view and constants.
- Create: `…/android/src/main/java/expo/modules/papertradesync/SyncEngine.kt`, `HttpSyncApi.kt`; tests `…/android/src/test/java/expo/modules/papertradesync/SyncEngineTest.kt`, `HttpSyncApiTest.kt`
- Modify: `mobile/modules/papertrade-sync/android/build.gradle`

**Interfaces:**
- Consumes: the backend contract from Tasks 9, 10 and 14 (`POST /auth/refresh`, `GET /snapshot`); `shared/snapshot.fixture.json`.
- Produces (package `expo.modules.papertradesync`):
  ```kotlin
  data class Tokens(val access: String, val refresh: String)
  class AuthRejected : Exception()                       // refresh answered 401
  class HttpError(val code: Int) : Exception()
  interface SyncApi {
      fun refresh(refreshToken: String): Tokens          // AuthRejected, HttpError, IOException
      fun snapshot(accessToken: String): String          // HttpError, IOException; returns the raw body
  }
  interface TokenVault { fun refreshToken(): String?; fun saveRefreshToken(token: String); fun clear() }
  interface SnapshotCache { fun write(json: String, syncedAtMs: Long) }
  enum class SyncOutcome { SUCCESS, RETRY, AUTH_LOST, NOT_CONFIGURED }
  class SyncEngine(api: SyncApi, vault: TokenVault, cache: SnapshotCache, clock: () -> Long) { fun run(): SyncOutcome }
  class HttpSyncApi(baseUrl: String, client: OkHttpClient = defaultClient()) : SyncApi   // 20 s timeouts
  ```
- `SyncEngine.run()` rules: no stored refresh token returns `NOT_CONFIGURED`. Otherwise **refresh first on every run** (the 60-minute access token cannot be trusted after a 15-minute-or-longer sleep), **save the rotated refresh token before using the access token**, then fetch the snapshot. A refresh answered 401 clears the vault and returns `AUTH_LOST`. Any `IOException` or `HttpError` returns `RETRY`. A snapshot body that is not a JSON object containing `server_time`, `portfolio`, `orders`, `transactions` and `watchlist` is not cached and returns `RETRY`. Success writes `(body, clock())` and returns `SUCCESS`.
- Gradle test dependencies: `junit:junit:4.13.2`, `com.squareup.okhttp3:mockwebserver:4.12.0`, `org.json:json:20231013`; main dependency `com.squareup.okhttp3:okhttp:4.12.0` if not already supplied by React Native.

- [ ] **Step 1: Scaffold the module and add the test dependencies**

Run the scaffold command above, add the Gradle lines, and confirm the module's unit-test task exists: `cd mobile; npx expo prebuild --platform android --no-install` then `cd android; ./gradlew :papertrade-sync:tasks --all | grep testDebugUnitTest` (if the project path differs, take it from `android/settings.gradle` and use it in every later command and in CI).

- [ ] **Step 2: Write the failing tests** (fakes for `SyncApi`, `TokenVault`, `SnapshotCache`)

| Test (`SyncEngineTest`) | Setup | Expected |
|---|---|---|
| `noRefreshTokenMeansNotConfigured` | vault empty | `NOT_CONFIGURED`, api never called |
| `successSavesRotatedTokenBeforeFetchingAndWritesCache` | refresh returns `Tokens("a2","r2")`; snapshot returns the fixture text | vault holds `r2` **at the moment `snapshot` is called**, cache holds the fixture text and the fake clock value, `SUCCESS` |
| `refreshRejectedClearsVaultAndReportsAuthLost` | refresh throws `AuthRejected` | vault empty, `AUTH_LOST`, cache untouched |
| `networkErrorOnRefreshKeepsTokenAndRetries` | refresh throws `IOException` | vault still holds the old token, `RETRY` |
| `snapshotFailureStillKeepsTheNewRefreshToken` | refresh ok, snapshot throws `IOException` | vault holds `r2`, `RETRY`, cache untouched |
| `serverErrorRetries` | snapshot throws `HttpError(500)` | `RETRY` |
| `nonSnapshotBodyIsNeverCached` | snapshot returns `"<html>502 Bad Gateway</html>"`, then `"{}"` | cache untouched both times, `RETRY` |

`HttpSyncApiTest` (MockWebServer): `refreshPostsJsonAndParsesTokens` (path `/auth/refresh`, JSON body `{"refresh_token":"r1"}`), `refresh401ThrowsAuthRejected`, `refresh500ThrowsHttpError`, `snapshotSendsBearerAndReturnsRawBody`, `snapshot401ThrowsHttpError401`, `connectionRefusedThrowsIOException`.

- [ ] **Step 3: Run to verify they fail**

Run: `cd mobile/android; ./gradlew :papertrade-sync:testDebugUnitTest`
Expected: FAIL (compilation errors: classes not defined).

- [ ] **Step 4: Implement `SyncEngine.kt` and `HttpSyncApi.kt`** (JSON through `org.json`; `baseUrl` trimmed of a trailing slash).

- [ ] **Step 5: Run to verify they pass**

Run: `cd mobile/android; ./gradlew :papertrade-sync:testDebugUnitTest`
Expected: BUILD SUCCESSFUL, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(android): Kotlin sync engine with refresh rotation, JVM-tested"
```

---

### Task 24: Android integration: vault, cache writer, WorkManager, Expo module

**Files:**
- Create: `…/KeystoreTokenVault.kt`, `SqliteSnapshotCache.kt`, `SyncWorker.kt`, `SyncScheduler.kt`; `mobile/modules/papertrade-sync/index.ts`, `src/PapertradeSyncModule.ts`, `src/__tests__/index.test.ts`
- Modify: `…/PapertradeSyncModule.kt`, `…/android/build.gradle` (add `androidx.work:work-runtime-ktx:2.9.1`), `mobile/app.json` (`android.package`, `ios.bundleIdentifier` set to `com.ishan.papertrade`), `mobile/package.json` (`expo-dev-client`)

**Interfaces:**
- Consumes: `SyncEngine`, `HttpSyncApi`, the `snapshot_cache` table contract (Task 19).
- Produces:
  - `KeystoreTokenVault(context) : TokenVault`: AES-GCM key held in Android Keystore (alias `papertrade_sync_key`), ciphertext and IV stored in private `SharedPreferences("papertrade_sync")`; `clear()` removes both.
  - `SqliteSnapshotCache(context, dbName = "papertrade.db") : SnapshotCache`: opens `<context.filesDir>/SQLite/<dbName>` (the expo-sqlite directory; **verify the directory constant in the installed expo-sqlite's Android source before relying on it**), enables WAL, `PRAGMA busy_timeout = 5000`, creates `snapshot_cache` with the exact DDL from Task 19 if missing, then `INSERT OR REPLACE INTO snapshot_cache VALUES (1, ?, ?)`.
  - `SyncWorker : CoroutineWorker`: builds `SyncEngine` from stored `baseUrl` (SharedPreferences) and the vault; maps `SUCCESS` to `Result.success()`, `RETRY` to `Result.retry()`, `AUTH_LOST` and `NOT_CONFIGURED` to `Result.failure()` (and stops the schedule); records `lastRunAtMs` and `lastOutcome` in SharedPreferences.
  - `SyncScheduler.schedule(context, intervalMinutes)`: unique periodic work `papertrade_background_sync`, interval at least 15 (values below 15 are raised to 15), constraint `NetworkType.CONNECTED`, exponential backoff, `ExistingPeriodicWorkPolicy.UPDATE`; `cancel(context)`.
  - Expo module functions (name `PapertradeSync`): `configure(baseUrl: String, refreshToken: String)`, `schedule(intervalMinutes: Int)`, `cancelAndClear()`, `getStatus()` returning `{ configured: Boolean, scheduled: Boolean, lastRunAtMs: Long?, lastOutcome: String? }`.
  - JS wrapper `index.ts`: `isNativeSyncAvailable: boolean` (from `requireOptionalNativeModule('PapertradeSync')`), and `configure(opts: { baseUrl: string; refreshToken: string })`, `schedule(intervalMinutes = 15)`, `cancelAndClear()`, `getStatus()`; when the native module is absent every function resolves without doing anything and `getStatus()` returns `{ configured: false, scheduled: false, lastRunAtMs: null, lastOutcome: null }`.

- [ ] **Step 1: Write the failing JS wrapper test**

`index.test.ts` (mock `expo-modules-core` so `requireOptionalNativeModule` returns `null`, then a fake module): `without the native module every call resolves and status is empty`; `with the native module calls pass through with the same arguments`; `schedule defaults to 15 minutes`; `schedule never passes less than 15`.

- [ ] **Step 2: Run to verify it fails** — `cd mobile; npm test -- modules/papertrade-sync` — Expected: FAIL.

- [ ] **Step 3: Implement the JS wrapper and all Kotlin classes above**

- [ ] **Step 4: Run to verify the wrapper passes and the Kotlin still passes**

Run: `cd mobile; npm test; cd android; ./gradlew :papertrade-sync:testDebugUnitTest`
Expected: PASS / BUILD SUCCESSFUL.

- [ ] **Step 5: Build the development build and run it on an Android device**

```bash
cd mobile
npx expo install expo-dev-client
npx expo run:android
```

Expected: the app installs and opens (first build takes several minutes). If no emulator image is installed, use a physical phone with USB debugging (`adb devices` lists it), or install an emulator image through Android Studio's Device Manager. Set `EXPO_PUBLIC_API_URL` to `http://<LAN-IP>:8000` for a physical phone.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(android): WorkManager background sync as an Expo native module"
```

---

### Task 25: Background sync orchestration (Android Kotlin, iOS JavaScript)

**Files:**
- Create: `mobile/src/sync/background.ts`, `mobile/src/sync/backgroundTask.ts`, `mobile/src/__tests__/background.test.ts`
- Modify: `mobile/src/AppContext.tsx`, `mobile/index.ts` (or the entry file: import `./src/sync/backgroundTask` at module top level), `mobile/app.json` (`expo-background-task` plugin), `mobile/package.json` (`expo-background-task`, `expo-task-manager`)

**Interfaces:**
- Consumes: `api.backgroundToken()`, `modules/papertrade-sync` (Task 24), `TokenStore`, `LocalStore`, `createApi`.
- Produces:
  - `startBackgroundSync(deps: { platform: 'android' | 'ios' | string; baseUrl: string; api: Pick<Api, 'backgroundToken'>; native: SyncModule; ios: { register(): Promise<void> } }): Promise<void>`:
    - Android with the native module available: read `native.getStatus()`; if `configured && scheduled`, do nothing; otherwise `api.backgroundToken()` then `native.configure({ baseUrl, refreshToken })` then `native.schedule(15)`, in that order.
    - iOS: `ios.register()` (wrapped so a failure is logged, never thrown).
    - Anything else, or Android without the native module: do nothing.
  - `stopBackgroundSync(deps: { native: SyncModule; ios: { unregister(): Promise<void> } }): Promise<void>` calls `native.cancelAndClear()` and `ios.unregister()`, ignoring errors.
  - `runBackgroundSync(deps: { tokens: TokenStore; api: Api; store: LocalStore; now?: () => number }): Promise<'success' | 'failed' | 'auth_lost' | 'not_configured'>`: no refresh token returns `not_configured`; otherwise fetch the snapshot with the normal refreshing client and write it with `store.replaceSnapshot`; `onAuthLost` or a refresh 401 returns `auth_lost`; a network error returns `failed` and leaves the cache untouched. It never calls `flushOutbox`.
  - `backgroundTask.ts`: `TaskManager.defineTask('papertrade-background-sync', …)` at module scope, building its dependencies from `secureTokenStore` and `openSqliteStore()` and returning `BackgroundTask.BackgroundTaskResult.Success` for `success` and `Failed` otherwise; exports `iosBackground = { register, unregister }` which call `BackgroundTask.registerTaskAsync(name, { minimumInterval: 15 })` / `unregisterTaskAsync`. Registration is wrapped in try/catch because background tasks may be unavailable in Expo Go.
- App wiring: after sign-in and at app start when tokens exist, call `startBackgroundSync`; `signOut()` calls `stopBackgroundSync`.

- [ ] **Step 1: Write the failing tests** (fake native module, fake api, fake `ios`)

```ts
it('android: gets a background token, configures, then schedules, in that order', ...)
it('android: does nothing when already configured and scheduled', ...)
it('android: reconfigures when the worker lost its credentials (configured=false)', ...)
it('android without the native module does nothing', ...)
it('ios registers the JS task and never touches the native module', ...)
it('ios registration failure is swallowed', ...)
it('stop clears native state and unregisters ios, ignoring errors', ...)
it('runBackgroundSync: not_configured without a refresh token', ...)
it('runBackgroundSync: writes the snapshot on success', ...)
it('runBackgroundSync: auth_lost when refresh is rejected', ...)
it('runBackgroundSync: failed on a network error and leaves the cache untouched', ...)
it('runBackgroundSync never places or flushes orders', ...)     // fake api.placeOrder not called
```

- [ ] **Step 2: Run to verify they fail** — `cd mobile; npm test -- background` — Expected: FAIL.

- [ ] **Step 3: Implement `background.ts` and `backgroundTask.ts`, then wire `AppContext` and the entry file**

Install: `npx expo install expo-background-task expo-task-manager`, then add the plugin entry the installed version's documentation asks for in `app.json`.

- [ ] **Step 4: Run to verify they pass** — `cd mobile; npm test; npx tsc --noEmit` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(mobile): background sync orchestration (Kotlin WorkManager on Android, JS task on iOS)"
```

---

## Delivery

### Task 26: CI, README, environment templates

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md`, `backend/.env.example`, `mobile/.env.example`, `docs/screenshots/.gitkeep`
- Modify: `.gitignore` (confirm `.env`, `android/`, `ios/`, `node_modules/` are ignored)

**Interfaces:**
- Produces: workflow with three jobs.
  - `backend`: services `postgres:16` (db `papertrade`, user and password `papertrade`) and `redis:7`; steps `uv sync`, `uv run alembic upgrade head`, `uv run pytest`.
  - `mobile`: `npm ci`, `npx tsc --noEmit`, `npm test`.
  - `android-unit`: JDK 21, `npm ci`, `npx expo prebuild --platform android --no-install`, `./gradlew :papertrade-sync:testDebugUnitTest` (use the Gradle path found in Task 23).
- `README.md` contains: one-paragraph description; an architecture diagram (ASCII); the stack table (only technologies actually used); run instructions (`docker compose up -d`, `uv run alembic upgrade head`, `uv run uvicorn …`, `npx expo run:android`, Expo Go for iPhone); a feature-to-code table mirroring the coverage matrix above; **honest limitations**: prices are Finnhub free-tier US data (previous close when the market is closed), iOS background sync is best-effort, Kotlin is Android-only; screenshots from `docs/screenshots/`.
- `.env.example` files list every variable (`PT_DATABASE_URL`, `PT_REDIS_URL`, `PT_JWT_SECRET`, `PT_PRICE_SOURCE`, `PT_FINNHUB_API_KEY`, `PT_AUTO_CREATE_TABLES`, `EXPO_PUBLIC_API_URL`) with placeholder values.

- [ ] **Step 1: Write the workflow, README and templates.**

- [ ] **Step 2: Verify locally**

Run: `cd backend; uv run pytest; cd ../mobile; npx tsc --noEmit; npm test; cd android; ./gradlew :papertrade-sync:testDebugUnitTest`
Expected: all green. Then `grep -rn "PT_FINNHUB_API_KEY=" --include=* . | grep -v example` prints nothing tracked by git (`git ls-files | xargs grep -l "finnhub" ` shows no real key).

- [ ] **Step 3: Push and watch CI** (after creating the GitHub repository; the owner pushes): Expected: all three jobs green. If `android-unit` needs tuning, fix the workflow, not the tests.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: CI workflow, README and environment templates"
```

---

### Task 27: Acceptance run against the resume

**Files:**
- Create: `docs/acceptance.md`

**Interfaces:**
- Produces: `docs/acceptance.md` with one row per resume phrase (the coverage matrix), the date, PASS or FAIL, and for each device check a line of evidence (output pasted or screenshot name). Fix anything that fails in its owning task before ticking it.

- [ ] **Step 1: Automated checks**

Run: `cd backend; uv run pytest`, `cd ../mobile; npm test; npx tsc --noEmit`, `cd android; ./gradlew :papertrade-sync:testDebugUnitTest`
Expected: all green.

- [ ] **Step 2: Start the stack with real prices**

`PT_PRICE_SOURCE=finnhub`, key in `backend/.env`; `docker compose up -d`; `uv run alembic upgrade head`; `uv run uvicorn app.main:create_app --factory --host 0.0.0.0`; `npx expo run:android`.

- [ ] **Step 3: Live prices and Redis**

Sign in; the watchlist shows Finnhub prices that match a second source within a cent during market hours; `docker compose exec redis redis-cli --scan --pattern 'quote:*'` lists the cached quotes. Record: "live" prices stay unchanged off-hours (previous close) and that is expected.

- [ ] **Step 4: Trading, portfolio, history, P&L**

Market buy 5 AAPL: cash drops by about 5 × price; a position appears; Activity shows one FILLED order and one transaction. Place a limit buy 5% below market: it stays OPEN, then cancel it. The Portfolio tab shows LIVE and the unrealized P&L moves when the quote changes (use `PT_PRICE_SOURCE=simulated` for visible movement off-hours).

- [ ] **Step 5: Charts**

Open a symbol; the chart renders for 1D, 1W and 1M; dragging moves the crosshair and shows price and time; a symbol with no history shows the empty state.

- [ ] **Step 6: Offline persistence across sessions**

Stop the backend, force-close and reopen the app: portfolio, orders, transactions and watchlist still show from SQLite with an OFFLINE badge and an old "Last synced" time. Restart the backend: data refreshes within one sync interval.

- [ ] **Step 7: Offline orders**

Airplane mode on, place a limit order (shown as Queued), airplane mode off: the order is sent once and appears in Orders; the Queued list is empty. Sign out with something queued: the app asks first; after sign-out and a second user's sign-in, no queued order from the first user is sent.

- [ ] **Step 8: Kotlin background sync (Android)**

With the app signed in, force-close it. Find the job and run it now instead of waiting 15 minutes:

```bash
adb shell dumpsys jobscheduler | grep -B2 -A6 com.ishan.papertrade
adb shell cmd jobscheduler run -f com.ishan.papertrade <JOB_ID>
adb logcat -d | grep -i papertrade
```

Expected: the log shows a successful `SyncEngine` run. Reopen the app **without** pulling to refresh: the cached "Last synced" time is the worker's time (before the app's own sync runs). Stop the backend, run the job again: the log shows RETRY and the cache is unchanged. Revoke the family (sign out from another session or `POST /auth/logout`) and run the job: the log shows AUTH_LOST and the schedule stops.

- [ ] **Step 9: Android and iOS parity**

Repeat steps 3 and 4 quickly on the Android dev build, and on an iPhone through Expo Go (same Wi-Fi, `EXPO_PUBLIC_API_URL` set to the LAN address). Expected: register, prices, order, portfolio all work on both.

- [ ] **Step 10: iOS background sync status**

Record honestly in `docs/acceptance.md` whether the `expo-background-task` registration succeeded in your iOS build or only logged a failure in Expo Go. The resume may claim "background synchronization" on the strength of the Android Kotlin worker and the iOS best-effort task; the README says so.

- [ ] **Step 11: Commit**

```bash
git add docs/acceptance.md
git commit -m "docs: acceptance run against the resume entry"
```

---

## Self-review

- **Spec coverage:** every resume phrase has a row in the coverage matrix; spec additions A to G map to Tasks 15, 16 and 21, 14, 23 to 25, 25, 22, 17 and 26.
- **Types:** `Tokens`, `TokenStore`, `SqlDb`, `LocalStore`, `OutboxStore`, `SyncModule` (the Task 24 wrapper's four functions) and the `snapshot_cache` DDL are defined once and reused with the same names. `signIn()` takes no argument from Task 18 on; Part 1's `signIn(token)` is replaced there.
- **Known soft spots, flagged for the builder:** the expo-sqlite Android directory constant (Task 24, verify), the Gradle project path (Task 23, discover), the `expo-background-task` plugin setup (Task 25, follow the installed version's docs), and iOS background execution, which cannot be proven without a real build (Task 27 step 10).
