# PaperTrade: design (matches the resume entry)

Date: 2026-11-08. Status: draft, awaiting approval.
Builds on `docs/superpowers/plans/2026-11-08-papertrade-fullstack.md` (the Expo + FastAPI plan). That plan's Tasks 1 to 13 stay as written. This design adds what it left out so the app matches the resume entry line for line.

## Intent and the why

Ishan has a resume entry describing PaperTrade. The app must do everything that entry says, and every named technology must really be in the project: React Native, TypeScript, Kotlin, FastAPI, PostgreSQL, SQLite, JWT, Redis. The purpose is to make the resume entry true and defensible in an interview. (Ishan has not said whether they also want a daily-use app; this design assumes the resume is the goal.)

The resume entry, as the acceptance test:

1. Cross-platform stock trading app for Android and iOS, practicing with virtual funds, live market prices, interactive charts, personalized watchlists.
2. Market and limit orders, portfolio tracking, transaction history, real-time profit/loss.
3. Offline-friendly persistence using SQLite, with background synchronization to a FastAPI backend, so portfolio and transaction data stay accessible across sessions.
4. JWT authentication, PostgreSQL for persistent financial records, Redis caching for frequently accessed market data.

## Goals

- Every sentence above is true and demonstrable.
- Android and iOS both run the app.
- Money is never a float. The server owns all arithmetic (see the base plan's constraints).

## Non-goals

- App Store / Play Store release, and a hosted production deployment.
- Short selling, partial fills, margin (base plan Phase 4).
- Real money, real brokerage connections.

## Anti-goals (a failure even if it "works")

- A resume word with nothing behind it. If Kotlin or "background sync" ships as a stub that is never called, that is a failure.
- Filling orders at invented or stale prices.
- Secrets or the market-data API key committed to the repository.

## What the base plan already covers

Tasks 1 to 13: FastAPI backend, PostgreSQL, Redis quote cache, JWT, simulated prices, watchlist, market/limit/stop orders, portfolio and transaction history with P&L, Expo app with an SQLite cache and foreground sync.

## What this design adds

| # | Addition | Makes true |
|---|---|---|
| A | Real market quotes (Finnhub), replacing simulated prices as the default | "live market prices" |
| B | Price history endpoint and interactive chart | "interactive charts" |
| C | Refresh tokens | background sync can run for days without the user opening the app |
| D | Kotlin Expo native module (Android) running a WorkManager periodic sync | "Kotlin", "background synchronization" |
| E | JS background fallback for iOS (`expo-background-task`) | background sync on both platforms |
| F | Offline order outbox | "offline-friendly" (orders placed offline are sent later) |
| G | Alembic migrations, CI, README with screenshots | credibility of the GitHub link |

## Approaches considered for the Kotlin / background sync part

1. **Kotlin module does the whole sync itself (chosen).** A WorkManager worker calls `GET /snapshot` over HTTP, writes the result into the shared SQLite file, and the JS app reads it. The sync works with the app fully closed and with no JavaScript running. Cost: HTTP and token handling exist in Kotlin as well as TypeScript.
2. **Kotlin only schedules; JavaScript does the sync in a headless task.** Less duplicated logic, but starting a JS runtime from a background worker inside Expo is fragile, and Kotlin would be a thin wrapper that adds little. Rejected: weak resume value and the most likely part to break.
3. **Bare React Native instead of Expo.** More native freedom, but a harder iOS story on a Windows machine with no Mac, and no gain for this project. Rejected.

## Decisions

Decided by Ishan: keep the Expo plan and add a Kotlin native module (WorkManager) for background sync.

My calls (change any of them):

- **Real quotes from Finnhub, REST polling.** Free key, simple. Verify the current free-tier rate limit and terms before building; poll the watchlist universe on an interval that respects it. The simulated source stays for tests and as a fallback when no key is set. Quotes are US-market data and are delayed or limited per the provider's terms, and prices only move during market hours; the simulated source keeps the demo alive off-hours.
- **Charts: `react-native-svg`**, a line chart with touch crosshair and range chips (1D, 1W, 1M). History is stored server-side per symbol, downsampled, in Postgres.
- **Refresh tokens:** short access token (60 minutes, as in the base plan) plus a long-lived refresh token stored hashed in Postgres, rotated on use. The Kotlin worker needs this, because a 60-minute access token cannot survive a background job that runs while the app is closed.
- **Shared SQLite layout:** the local store keeps the latest snapshot as a JSON document in one row (plus the sync time), so Kotlin and TypeScript share one trivial contract. This changes the base plan's Task 12 `sqliteStore.ts` if it used relational tables. Trade-off: simpler and robust, but less of a "relational" local schema.
- **Token handoff to Kotlin:** after login and each refresh, the JS app passes the API base URL and refresh token to the module, which stores them in Android's encrypted storage. Logout clears them.
- **Sync schedule:** WorkManager periodic work, 15-minute minimum interval (Android's floor), network-connected constraint. The foreground sync (on resume and every 30 s) from the base plan stays.
- **iOS:** `expo-background-task` runs the same JS sync. It is best-effort (iOS decides when to run it). The Kotlin module is Android only, and JavaScript falls back cleanly when the module is absent, so iPhone via Expo Go still works.
- **Android runs as a development build** (`npx expo run:android`), not Expo Go, because of the native module. Needs a physical phone with USB debugging or an emulator image (none is installed today).

## Constraints

- Windows machine, no Mac. iOS is tested through Expo Go on a real iPhone; an installable iOS build needs an Apple Developer account and is out of scope.
- Installed: Node 24, Docker, Java 21, Android SDK platforms 34 and 36, NDK. Not installed: Python 3.12 (via `uv`), emulator images, Postgres/Redis (they run in Docker).
- Python 3.12 pinned (system has 3.14).
- The Finnhub key goes in an untracked `.env`.

## Done criteria (each resume claim, shown working)

- Register, log in, see live Finnhub prices in the watchlist (simulated source off).
- Chart for a symbol with range chips and crosshair.
- Place market and limit orders; portfolio, history and P&L update.
- Airplane mode: app opens and shows cached portfolio and history; an order placed offline is queued and sent after reconnect, exactly once.
- Close the app on Android; the Kotlin worker updates the cached snapshot within roughly 15 to 30 minutes (checked via `adb` job logs and the cache's sync time).
- Same app opens on iPhone via Expo Go.
- `pytest` and `jest` pass; CI runs both.
- README lists the stack truthfully, with screenshots.

## Left to the builder

- Screen layouts and styling.
- Exact Alembic migration contents, Kotlin class structure, the history downsampling rule.
- Exact Finnhub polling interval once the current limits are checked.
- The order of work: backend items A to C first, then mobile B, then D to F, then G.

## Open for Ishan

- Is the resume the whole goal, or should this also be an app to keep using? (Affects polish time in G.)
