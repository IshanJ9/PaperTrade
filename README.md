# PaperTrade

A cross-platform (Android and iOS) paper-trading app. Practice trading stocks with virtual money, live market prices, interactive charts and a personal watchlist. Orders, portfolio and P&L are computed on a FastAPI server; the app keeps a SQLite copy so it opens offline and syncs in the background.

## What it does

- Virtual account: every user starts with $100,000.00.
- Live prices from Finnhub (US stocks) or a built-in simulated feed, cached in Redis.
- Interactive price charts (1D / 1W / 1M) with a touch crosshair.
- Personal watchlists.
- Market, limit and stop orders; resting orders fill when the price crosses them.
- Portfolio with cash, positions, realized and unrealized P&L that updates live; full order and transaction history.
- Works offline: the last portfolio, orders and transactions are stored in SQLite; orders placed offline are queued and sent once, in order, when the connection returns. Queued market orders expire after 5 minutes (they mean "at today's price, now"); limit and stop orders after 24 hours.
- Background sync: a Kotlin WorkManager worker (Android) and an `expo-background-task` job (iOS) refresh the cached data while the app is closed. The Android worker leaves its result in a file that the app copies into SQLite when it opens (two SQLite libraries must never write one database file).
- JWT access tokens plus rotating refresh tokens.

## Architecture

```
React Native app (Expo, TypeScript)                 FastAPI backend (Python 3.12)
┌────────────────────────────────┐   HTTPS/JSON   ┌──────────────────────────────────┐
│ Screens ── AppContext          │ ─────────────▶ │ routes: auth, trading, history   │
│   │            │               │                │   │                              │
│   │        SQLite cache        │ ◀───────────── │ TradingService + MatchingEngine  │
│   │        (snapshot + outbox) │   /snapshot    │   │                │             │
│   │            ▲               │                │ PostgreSQL        Redis          │
│ Kotlin WorkManager worker ─────┘                │ (accounts,        (latest quotes)│
│ (Android, app closed)                           │  orders, fills,        ▲         │
│ expo-background-task (iOS)                      │  history, tokens)  Finnhub / sim │
└────────────────────────────────┘                └──────────────────────────────────┘
```

The server is the single source of truth: money is `Decimal` in Python and a string everywhere else, and only the server does arithmetic.

## Stack

| Layer | Technology |
|---|---|
| Mobile | React Native (Expo), TypeScript, React Navigation, `react-native-svg`, `expo-sqlite`, `expo-secure-store` |
| Android native | Kotlin (Expo Modules API), WorkManager, OkHttp |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2, Alembic, PyJWT, argon2 |
| Data | PostgreSQL 16, Redis 7 (quote cache), SQLite on the device |
| Market data | Finnhub REST (free tier), simulated feed for tests and demos |
| Tests / CI | pytest, Jest, JUnit + MockWebServer, GitHub Actions |

## Where each feature lives

| Feature | Code |
|---|---|
| Matching engine, P&L | `backend/app/domain/` |
| Orders, idempotency, locking | `backend/app/services/trading.py` |
| JWT, refresh-token families | `backend/app/auth/` |
| Live quotes, Redis cache | `backend/app/market/finnhub.py`, `quote_cache.py`, `loop.py` |
| Chart history | `backend/app/market/history.py`, `mobile/src/chart/` |
| SQLite cache and offline outbox | `mobile/src/sync/sqliteStore.ts`, `mobile/src/orders/` |
| Background sync (Kotlin) | `mobile/modules/papertrade-sync/android/` (worker file is imported by `mobile/src/sync/workerSnapshot.ts`) |
| Background sync (iOS) | `mobile/src/sync/backgroundTask.ts` |

## Run it

Prerequisites: Docker, [uv](https://docs.astral.sh/uv/), Node 24, and for Android builds the Android SDK with JDK 21.

```bash
# 1. Postgres (host port 55432) and Redis (6379)
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env            # then set PT_JWT_SECRET (see the file)
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:create_app --factory --host 0.0.0.0

# 3. App (second terminal)
cd mobile
cp .env.example .env            # set EXPO_PUBLIC_API_URL for a physical phone
npm install
npx expo run:android            # development build with the Kotlin module (phone with USB debugging, or an emulator)
# iPhone: npx expo start, then open the project in Expo Go (the Kotlin module is Android-only; JavaScript sync is used)
```

Real prices: set `PT_PRICE_SOURCE=finnhub` and `PT_FINNHUB_API_KEY=<free key from finnhub.io>` in `backend/.env`.

Tests:

```bash
cd backend && uv run pytest
cd mobile && npx tsc --noEmit && npm test
cd mobile/android && ./gradlew :papertrade-sync:testDebugUnitTest   # after `npx expo prebuild --platform android --no-install`
```

## Limitations (honest ones)

- Prices are Finnhub's free US-stock data, polled. When the last trade is more than 15 minutes old the market is treated as closed: the last price is still shown (labelled), but orders are refused and resting orders are not matched. The simulated feed (the default) has no market hours and moves any time of day, so "live prices" in the sense of real quotes needs a Finnhub key.
- iOS background sync is best effort: iOS decides when the task runs, and it may not run at all in Expo Go. The Android Kotlin worker runs at most every 15 minutes (Android's minimum interval), when the OS allows it.
- The Kotlin module exists on Android only; iOS uses the JavaScript sync.
- Paper trading only: no short selling, margin, or partial fills; resting buy orders are checked for affordability when they fill, not when placed.
- On Windows, the native Android build can fail on the 260-character path limit (CMake step). Enable Windows long paths or keep the project in a short folder such as `C:\pt`.
- Local development talks to the backend over plain HTTP on the LAN. A deployed backend must be served over HTTPS.
