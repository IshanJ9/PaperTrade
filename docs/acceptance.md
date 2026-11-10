# Acceptance run against the resume entry

Date of the automated run: 2026-11-08. This file separates what was **verified by running it** from what **still needs a phone** (no emulator image, Android phone or iPhone was available to the agent that built this). Fill in the last column when you run the device checks.

## Automated and stack checks (run by the builder)

| Check | Result |
|---|---|
| Backend tests: `cd backend && uv run pytest -q` | 129 passed (Postgres 16 in Docker; Redis is faked in tests) |
| Mobile type-check: `cd mobile && npx tsc --noEmit` | clean |
| Mobile tests: `cd mobile && npm test` | 107 passed |
| Kotlin tests: `./gradlew :papertrade-sync:testDebugUnitTest` | 19 passed (SyncEngine 9, HttpSyncApi 7, FileSnapshotCache 3) |
| Android JS bundle: `npx expo export --platform android` | builds |
| Migrations: `uv run alembic upgrade head` on an empty database | creates all 9 tables; matches the models |
| Real backend smoke (uvicorn + Docker Postgres + Redis, simulated feed) | register returns access and refresh tokens; `/history` returns 200 points for 1D and 1M; a market buy FILLED; `/portfolio` shows live unrealized P&L; background token works, and after the parent's logout the child refresh returns 401; Redis holds `quote:*` keys |

## Resume claims

| Resume phrase | Evidence from the builder's run | Still to verify on a device (steps below) |
|---|---|---|
| Cross-platform, Android and iOS | Single Expo/TypeScript codebase; Android JS bundle builds | Steps 9, 10 |
| Virtual funds | New account has $100,000.00 (smoke test) | Step 4 |
| Live market prices | Simulated feed through Redis verified; Finnhub source unit-tested with a mocked HTTP server | Step 3 (needs a free Finnhub key) |
| Interactive charts | `/history` verified; chart geometry unit-tested | Step 5 |
| Personalized watchlists | Watchlist endpoints tested | Step 4 |
| Market and limit orders | Engine, service and API tested; market buy verified live | Step 4 |
| Portfolio, history, real-time P&L | `/portfolio` P&L moved with the live feed; polling logic unit-tested | Step 4 |
| SQLite persistence across sessions | Snapshot cache store tested with real SQLite (Node) incl. a row written by "another process" | Step 6 |
| Offline-friendly (queued orders) | Outbox logic and SQLite outbox tested | Step 7 |
| Background synchronization | Kotlin SyncEngine + HTTP client unit-tested; whole Kotlin module compiles | Steps 8 and 10 |
| JWT authentication | Access + rotating refresh tokens tested end to end | n/a |
| PostgreSQL / Redis | Used by the real-stack smoke test | n/a |
| Kotlin | `mobile/modules/papertrade-sync/android/` | Step 8 |

## Device checks (you run these)

Prerequisites: `docker compose up -d`, `cd backend && uv run alembic upgrade head && uv run uvicorn app.main:create_app --factory --host 0.0.0.0`, an Android phone with USB debugging (or an emulator image) for `cd mobile && npx expo run:android`, an iPhone with Expo Go on the same Wi-Fi, and `EXPO_PUBLIC_API_URL=http://<LAN-IP>:8000`. **Known issue on Windows:** the full Android build (`expo run:android` / `gradlew :app:assembleDebug`) failed twice in this project's folder at the C++ step (`buildCMakeDebug`, "ninja: error: mkdir(...): No such file or directory"), which is the 260-character Windows path limit hit by React Native's native build. The Java/Kotlin part and the Kotlin module compiled fine. Mapping a drive with `subst` did NOT help (the build resolves the real path). Fix it on your side by enabling Windows long paths (admin setting) or by moving the project to a very short path such as `C:\pt`, then build again. So the app has **not** been built into an APK or run on a device yet.

| # | Step | Expected | Result |
|---|---|---|---|
| 3 | Set `PT_PRICE_SOURCE=finnhub` and `PT_FINNHUB_API_KEY` in `backend/.env`; sign in | Watchlist shows prices that match a second source within a cent during US market hours; `docker compose exec redis redis-cli TTL quote:AAPL` is at most 45 | |
| 4 | Market buy 5 AAPL; place a limit buy 5% below market, then cancel it | Cash drops, a position appears, Activity shows one FILLED order and one transaction; Portfolio shows LIVE and P&L moves | |
| 5 | Open a symbol; use 1D / 1W / 1M; drag across the chart | Line renders, crosshair shows price and time; a symbol with no history shows the empty state | |
| 6 | Stop the backend, force-close and reopen the app | Portfolio, orders, transactions, watchlist still show with an OFFLINE badge and an old "Last synced" time | |
| 7 | Airplane mode on, place a limit order (and, separately, a market order), then turn it off. A market order left queued longer than 5 minutes should show Expired instead of being sent | Order shows as Queued, then is sent exactly once and appears in Orders; sign out with something queued asks first | |
| 8 | Signed in, force-close the app, then `adb shell dumpsys jobscheduler \| grep -B2 -A6 com.ishan.papertrade` and `adb shell cmd jobscheduler run -f com.ishan.papertrade <JOB_ID>` and `adb logcat -d \| grep -i PapertradeSync` | Log shows `background sync finished: SUCCESS`; the worker leaves `files/papertrade_sync/snapshot.json`, and reopening the app imports it, so "Last synced" shows the worker's time before the app's own sync runs. Stop the backend and run the job again: RETRY, cache unchanged. Log out elsewhere and run it: AUTH_LOST and the schedule stops | |
| 9 | Repeat steps 3 and 4 on Android and on the iPhone (Expo Go) | Both work | |
| 10 | Note whether iOS background task registration succeeded in your iOS build or only logged a warning in Expo Go | Record honestly here | |

Last known limitations: see the README ("Limitations").
