# PaperTrade Implementation Plan

> **Superseded on 2026-11-08** by [2026-11-08-papertrade-fullstack.md](2026-11-08-papertrade-fullstack.md), which follows the resume stack (React Native + FastAPI + PostgreSQL + Redis). Kept for reference; do not execute.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Android paper-trading app: virtual cash, live (simulated first, real later) prices, market/limit/stop orders filled by a matching engine, and a portfolio with P&L.

**Architecture:** A pure-Kotlin `domain` package (orders, fills, portfolio, matching engine) with no Android imports, so it is unit-tested on the JVM. A `TradingService` orchestrates it behind a `TradingStore` interface (in-memory for tests, Room for the app). A `PriceSource` interface feeds quotes (simulated now, a real WebSocket later). Compose + one ViewModel on top.

**Tech Stack:** Kotlin, Jetpack Compose (Material 3), Coroutines/Flow, Room (+KSP), JUnit4, kotlinx-coroutines-test. Manual DI now; Hilt later.

**Spec:** No separate spec. Scope is the "Scope" section below.

## Global Constraints

- Package root: `com.ishan.papertrade`; single Gradle module `app`; Kotlin DSL; minSdk 26.
- Money and prices are `java.math.BigDecimal`, never `Double`. Persist them as `String`.
- `domain/` must not import `android.*` or `androidx.*`.
- No short selling in v1: a SELL needs shares already held.
- No cash reservation for resting BUY orders in v1: affordability is checked at fill time, and an unaffordable fill marks the order `REJECTED`.
- Starting cash: `100000.00`.
- Library versions: use the stable versions Android Studio's template generates; pick Room/KSP versions compatible with the template's Kotlin version.

## Scope

**Now (Phase 1, ~1 to 1.5 weeks):** Tasks 1 to 8. Ends with a working app on an emulator: simulated live prices, place market/limit/stop orders, resting orders fill when price crosses, portfolio with cash, positions, realized and unrealized P&L, state survives restart.

**As time permits (Phase 2 to 4):** see the end of this file. Ordered by value per effort.

## File Structure

```
app/src/main/java/com/ishan/papertrade/
  domain/
    Models.kt            Side, OrderType, OrderStatus, Order, Fill
    OrderMatcher.kt      decides whether one order fills at one price
    Portfolio.kt         cash, positions, realized P&L, applyFill, equity
    TradingState.kt      Portfolio + orders + fills
    MatchingEngine.kt    pure: (state, symbol, price) -> new state
    TradingStore.kt      interface: load/save TradingState
  data/
    PriceSource.kt       Quote + PriceSource interface
    SimulatedPriceSource.kt
    InMemoryTradingStore.kt
    TradingService.kt    mutex-guarded placeOrder/cancelOrder/onQuote
    room/                entities, DAO, database, RoomTradingStore
  ui/
    TradingViewModel.kt
    WatchlistScreen.kt, PortfolioScreen.kt, OrdersScreen.kt, OrderTicket.kt
  AppContainer.kt        manual DI
  MainActivity.kt
app/src/test/java/com/ishan/papertrade/
  domain/TestSupport.kt, OrderMatcherTest.kt, PortfolioTest.kt, MatchingEngineTest.kt
  data/SimulatedPriceSourceTest.kt, TradingServiceTest.kt
app/src/androidTest/java/com/ishan/papertrade/data/room/RoomTradingStoreTest.kt
```

---

### Task 1: Project scaffold

**Files:**
- Create: whole project in `C:\Ishan\mobileapp` (via Android Studio)
- Modify: `app/build.gradle.kts`, `gradle/libs.versions.toml`

**Interfaces:**
- Produces: a building project at `com.ishan.papertrade` with Room, KSP, coroutines-test available.

- [ ] **Step 1: Create the project (manual, in Android Studio)**

New Project > Empty Activity (Compose) > Name `PaperTrade`, Package `com.ishan.papertrade`, Save location `C:\Ishan\mobileapp`, Min SDK API 26, Build config language Kotlin DSL. Let Gradle sync finish.

- [ ] **Step 2: Add dependencies**

In `gradle/libs.versions.toml` add `room` and `ksp` version entries and library/plugin aliases; in `app/build.gradle.kts` apply the KSP plugin and add:

```kotlin
implementation("androidx.room:room-runtime:<room>")
implementation("androidx.room:room-ktx:<room>")
ksp("androidx.room:room-compiler:<room>")
implementation("androidx.lifecycle:lifecycle-viewmodel-compose:<lifecycle>")
implementation("androidx.lifecycle:lifecycle-runtime-compose:<lifecycle>")
testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:<coroutines>")
androidTestImplementation("androidx.room:room-testing:<room>")
```

Replace each `<...>` with the current stable version. `junit:junit` is already in the template.

- [ ] **Step 3: Verify the build and the empty test run**

Run: `.\gradlew.bat testDebugUnitTest assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Initialise git and commit**

```bash
git init
git add -A
git commit -m "chore: scaffold PaperTrade project"
```

---

### Task 2: Order models and the single-order matcher

**Files:**
- Create: `domain/Models.kt`, `domain/OrderMatcher.kt`
- Test: `app/src/test/java/com/ishan/papertrade/domain/TestSupport.kt`, `OrderMatcherTest.kt`

**Interfaces:**
- Produces:
  - `enum Side { BUY, SELL }`, `enum OrderType { MARKET, LIMIT, STOP }`, `enum OrderStatus { OPEN, FILLED, CANCELLED, REJECTED }`
  - `data class Order(id: Long, symbol: String, side: Side, type: OrderType, quantity: Int, price: BigDecimal? = null, status: OrderStatus = OPEN)`; `price` is the limit price (LIMIT), trigger price (STOP), `null` for MARKET
  - `data class Fill(orderId: Long, symbol: String, side: Side, quantity: Int, price: BigDecimal)`
  - `OrderMatcher.tryFill(order: Order, marketPrice: BigDecimal): Fill?`
  - Test helpers `d(String): BigDecimal`, `assertMoney(expected: String, actual: BigDecimal)`

- [ ] **Step 1: Write the test helpers and failing tests**

`TestSupport.kt`:

```kotlin
package com.ishan.papertrade.domain

import java.math.BigDecimal
import org.junit.Assert.assertTrue

fun d(s: String) = BigDecimal(s)

fun assertMoney(expected: String, actual: BigDecimal) =
    assertTrue("expected $expected but was $actual", BigDecimal(expected).compareTo(actual) == 0)
```

`OrderMatcherTest.kt`:

```kotlin
package com.ishan.papertrade.domain

import com.ishan.papertrade.domain.OrderType.*
import com.ishan.papertrade.domain.Side.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class OrderMatcherTest {
    private fun order(side: Side, type: OrderType, price: String?, status: OrderStatus = OrderStatus.OPEN) =
        Order(1, "AAPL", side, type, 10, price?.let(::d), status)

    @Test fun `market order fills at the market price`() {
        val fill = OrderMatcher.tryFill(order(BUY, MARKET, null), d("150.25"))
        assertNotNull(fill)
        assertMoney("150.25", fill!!.price)
        assertEquals(10, fill.quantity)
    }

    @Test fun `limit buy fills at or below the limit, at the market price`() {
        assertNull(OrderMatcher.tryFill(order(BUY, LIMIT, "100"), d("100.01")))
        assertMoney("100", OrderMatcher.tryFill(order(BUY, LIMIT, "100"), d("100"))!!.price)
        assertMoney("98.50", OrderMatcher.tryFill(order(BUY, LIMIT, "100"), d("98.50"))!!.price)
    }

    @Test fun `limit sell fills at or above the limit`() {
        assertNull(OrderMatcher.tryFill(order(SELL, LIMIT, "100"), d("99.99")))
        assertMoney("101", OrderMatcher.tryFill(order(SELL, LIMIT, "100"), d("101"))!!.price)
    }

    @Test fun `stop sell triggers at or below the stop and fills at the gapped price`() {
        assertNull(OrderMatcher.tryFill(order(SELL, STOP, "95"), d("95.01")))
        assertMoney("95", OrderMatcher.tryFill(order(SELL, STOP, "95"), d("95"))!!.price)
        assertMoney("90", OrderMatcher.tryFill(order(SELL, STOP, "95"), d("90"))!!.price)
    }

    @Test fun `stop buy triggers at or above the stop`() {
        assertNull(OrderMatcher.tryFill(order(BUY, STOP, "105"), d("104.99")))
        assertMoney("108", OrderMatcher.tryFill(order(BUY, STOP, "105"), d("108"))!!.price)
    }

    @Test fun `non-open orders never fill`() {
        assertNull(OrderMatcher.tryFill(order(BUY, MARKET, null, OrderStatus.CANCELLED), d("1")))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `market order with a price is invalid`() { order(BUY, MARKET, "10") }

    @Test(expected = IllegalArgumentException::class)
    fun `limit order without a price is invalid`() { order(BUY, LIMIT, null) }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `.\gradlew.bat testDebugUnitTest --tests "com.ishan.papertrade.domain.OrderMatcherTest"`
Expected: FAIL (compilation error: unresolved `Order`, `OrderMatcher`).

- [ ] **Step 3: Implement**

`Models.kt`:

```kotlin
package com.ishan.papertrade.domain

import java.math.BigDecimal

enum class Side { BUY, SELL }
enum class OrderType { MARKET, LIMIT, STOP }
enum class OrderStatus { OPEN, FILLED, CANCELLED, REJECTED }

data class Order(
    val id: Long,
    val symbol: String,
    val side: Side,
    val type: OrderType,
    val quantity: Int,
    val price: BigDecimal? = null,
    val status: OrderStatus = OrderStatus.OPEN,
) {
    init {
        require(quantity > 0) { "quantity must be positive" }
        require((type == OrderType.MARKET) == (price == null)) {
            "price is required for LIMIT/STOP and forbidden for MARKET"
        }
    }
}

data class Fill(
    val orderId: Long,
    val symbol: String,
    val side: Side,
    val quantity: Int,
    val price: BigDecimal,
)
```

`OrderMatcher.kt`:

```kotlin
package com.ishan.papertrade.domain

import java.math.BigDecimal

object OrderMatcher {
    /** Fills the whole order at [marketPrice] if its condition is met. No partial fills in v1. */
    fun tryFill(order: Order, marketPrice: BigDecimal): Fill? {
        if (order.status != OrderStatus.OPEN) return null
        val level = order.price
        val triggered = when (order.type) {
            OrderType.MARKET -> true
            OrderType.LIMIT ->
                if (order.side == Side.BUY) marketPrice <= level!! else marketPrice >= level!!
            OrderType.STOP ->
                if (order.side == Side.BUY) marketPrice >= level!! else marketPrice <= level!!
        }
        return if (triggered) Fill(order.id, order.symbol, order.side, order.quantity, marketPrice) else null
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `.\gradlew.bat testDebugUnitTest --tests "com.ishan.papertrade.domain.OrderMatcherTest"`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(domain): order models and single-order matcher"
```

---

### Task 3: Portfolio and P&L

**Files:**
- Create: `domain/Portfolio.kt`
- Test: `domain/PortfolioTest.kt`

**Interfaces:**
- Consumes: `Fill`, `Side` from Task 2.
- Produces:
  - `data class Position(symbol: String, quantity: Int, avgCost: BigDecimal)`
  - `data class Portfolio(cash: BigDecimal, positions: Map<String, Position> = emptyMap(), realizedPnl: BigDecimal = ZERO)` with `applyFill(fill: Fill): Portfolio`, `unrealizedPnl(prices: Map<String, BigDecimal>): BigDecimal`, `equity(prices: Map<String, BigDecimal>): BigDecimal`
  - `class InsufficientFundsException(message: String) : IllegalStateException`, `class InsufficientSharesException(message: String) : IllegalStateException`

- [ ] **Step 1: Write the failing tests**

```kotlin
package com.ishan.papertrade.domain

import com.ishan.papertrade.domain.Side.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class PortfolioTest {
    private fun fill(side: Side, qty: Int, price: String) = Fill(1, "AAPL", side, qty, d(price))
    private val start = Portfolio(cash = d("10000"))

    @Test fun `buy reduces cash and opens a position`() {
        val p = start.applyFill(fill(BUY, 10, "100"))
        assertMoney("9000", p.cash)
        assertEquals(10, p.positions.getValue("AAPL").quantity)
        assertMoney("100", p.positions.getValue("AAPL").avgCost)
    }

    @Test fun `second buy averages the cost`() {
        val p = start.applyFill(fill(BUY, 10, "100")).applyFill(fill(BUY, 10, "110"))
        assertEquals(20, p.positions.getValue("AAPL").quantity)
        assertMoney("105", p.positions.getValue("AAPL").avgCost)
    }

    @Test(expected = InsufficientFundsException::class)
    fun `buy beyond cash is rejected`() { start.applyFill(fill(BUY, 101, "100")) }

    @Test fun `partial sell realizes pnl on the sold shares only`() {
        val p = start.applyFill(fill(BUY, 20, "100")).applyFill(fill(SELL, 5, "120"))
        assertMoney("100", p.positions.getValue("AAPL").avgCost)
        assertEquals(15, p.positions.getValue("AAPL").quantity)
        assertMoney("100", p.realizedPnl)          // (120 - 100) * 5
        assertMoney("8600", p.cash)                // 10000 - 2000 + 600
    }

    @Test fun `selling the whole position removes it`() {
        val p = start.applyFill(fill(BUY, 10, "100")).applyFill(fill(SELL, 10, "90"))
        assertFalse(p.positions.containsKey("AAPL"))
        assertMoney("-100", p.realizedPnl)
        assertMoney("9900", p.cash)
    }

    @Test(expected = InsufficientSharesException::class)
    fun `selling more than held is rejected`() { start.applyFill(fill(BUY, 5, "100")).applyFill(fill(SELL, 6, "100")) }

    @Test(expected = InsufficientSharesException::class)
    fun `selling with no position is rejected`() { start.applyFill(fill(SELL, 1, "100")) }

    @Test fun `unrealized pnl and equity use current prices`() {
        val p = start.applyFill(fill(BUY, 10, "100"))
        val prices = mapOf("AAPL" to d("110"))
        assertMoney("100", p.unrealizedPnl(prices))
        assertMoney("10100", p.equity(prices))
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `.\gradlew.bat testDebugUnitTest --tests "com.ishan.papertrade.domain.PortfolioTest"`
Expected: FAIL (unresolved `Portfolio`).

- [ ] **Step 3: Implement**

```kotlin
package com.ishan.papertrade.domain

import java.math.BigDecimal
import java.math.RoundingMode

class InsufficientFundsException(message: String) : IllegalStateException(message)
class InsufficientSharesException(message: String) : IllegalStateException(message)

data class Position(val symbol: String, val quantity: Int, val avgCost: BigDecimal)

data class Portfolio(
    val cash: BigDecimal,
    val positions: Map<String, Position> = emptyMap(),
    val realizedPnl: BigDecimal = BigDecimal.ZERO,
) {
    fun applyFill(fill: Fill): Portfolio = when (fill.side) {
        Side.BUY -> applyBuy(fill)
        Side.SELL -> applySell(fill)
    }

    private fun applyBuy(fill: Fill): Portfolio {
        val cost = fill.price * fill.quantity.toBigDecimal()
        if (cost > cash) throw InsufficientFundsException("need $cost, have $cash")
        val old = positions[fill.symbol]
        val oldQty = old?.quantity ?: 0
        val oldValue = (old?.avgCost ?: BigDecimal.ZERO) * oldQty.toBigDecimal()
        val newQty = oldQty + fill.quantity
        val newAvg = (oldValue + cost).divide(newQty.toBigDecimal(), 4, RoundingMode.HALF_UP)
        return copy(
            cash = cash - cost,
            positions = positions + (fill.symbol to Position(fill.symbol, newQty, newAvg)),
        )
    }

    private fun applySell(fill: Fill): Portfolio {
        val old = positions[fill.symbol]
        if (old == null || old.quantity < fill.quantity) {
            throw InsufficientSharesException("cannot sell ${fill.quantity} ${fill.symbol}, hold ${old?.quantity ?: 0}")
        }
        val qty = fill.quantity.toBigDecimal()
        val remaining = old.quantity - fill.quantity
        return copy(
            cash = cash + fill.price * qty,
            realizedPnl = realizedPnl + (fill.price - old.avgCost) * qty,
            positions = if (remaining == 0) positions - fill.symbol
            else positions + (fill.symbol to old.copy(quantity = remaining)),
        )
    }

    fun unrealizedPnl(prices: Map<String, BigDecimal>): BigDecimal =
        positions.values.fold(BigDecimal.ZERO) { acc, p ->
            acc + (prices.getValue(p.symbol) - p.avgCost) * p.quantity.toBigDecimal()
        }

    fun equity(prices: Map<String, BigDecimal>): BigDecimal =
        positions.values.fold(cash) { acc, p -> acc + prices.getValue(p.symbol) * p.quantity.toBigDecimal() }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `.\gradlew.bat testDebugUnitTest --tests "com.ishan.papertrade.domain.PortfolioTest"`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(domain): portfolio with average cost and realized/unrealized P&L"
```

---

### Task 4: Matching engine (pure state transition)

**Files:**
- Create: `domain/TradingState.kt`, `domain/TradingStore.kt`, `domain/MatchingEngine.kt`
- Test: `domain/MatchingEngineTest.kt`

**Interfaces:**
- Consumes: `Order`, `OrderMatcher`, `Fill`, `Portfolio`, `InsufficientFundsException`, `InsufficientSharesException`.
- Produces:
  - `data class TradingState(portfolio: Portfolio, orders: List<Order> = emptyList(), fills: List<Fill> = emptyList())`
  - `interface TradingStore { suspend fun load(): TradingState; suspend fun save(state: TradingState) }`
  - `class MatchingEngine { fun process(state: TradingState, symbol: String, price: BigDecimal): TradingState }`; processes OPEN orders for `symbol` in list (id) order; returns the same instance if nothing changed

- [ ] **Step 1: Write the failing tests**

```kotlin
package com.ishan.papertrade.domain

import com.ishan.papertrade.domain.OrderStatus.*
import com.ishan.papertrade.domain.OrderType.*
import com.ishan.papertrade.domain.Side.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class MatchingEngineTest {
    private val engine = MatchingEngine()

    private fun order(id: Long, side: Side, type: OrderType, qty: Int, price: String?, symbol: String = "AAPL") =
        Order(id, symbol, side, type, qty, price?.let(::d))

    private fun state(cash: String = "10000", vararg orders: Order, positions: Map<String, Position> = emptyMap()) =
        TradingState(Portfolio(d(cash), positions), orders.toList())

    @Test fun `resting limit buy fills on a later tick`() {
        val s0 = state("10000", order(1, BUY, LIMIT, 10, "100"))
        val s1 = engine.process(s0, "AAPL", d("101"))
        assertSame(s0, s1)
        val s2 = engine.process(s1, "AAPL", d("99.50"))
        assertEquals(FILLED, s2.orders[0].status)
        assertMoney("9005.00", s2.portfolio.cash)
        assertEquals(1, s2.fills.size)
    }

    @Test fun `stop loss gapping through fills at the gapped price`() {
        val held = mapOf("AAPL" to Position("AAPL", 10, d("100")))
        val s = engine.process(state("0", order(1, SELL, STOP, 10, "95"), positions = held), "AAPL", d("90"))
        assertEquals(FILLED, s.orders[0].status)
        assertMoney("900", s.portfolio.cash)
        assertMoney("-100", s.portfolio.realizedPnl)
    }

    @Test fun `unaffordable fill is rejected and leaves the portfolio unchanged`() {
        val s0 = state("100", order(1, BUY, MARKET, 10, null))
        val s1 = engine.process(s0, "AAPL", d("50"))
        assertEquals(REJECTED, s1.orders[0].status)
        assertMoney("100", s1.portfolio.cash)
        assertEquals(0, s1.fills.size)
    }

    @Test fun `selling shares that are not held is rejected`() {
        val s = engine.process(state("100", order(1, SELL, MARKET, 1, null)), "AAPL", d("50"))
        assertEquals(REJECTED, s.orders[0].status)
    }

    @Test fun `ticks for other symbols do not touch an order`() {
        val s0 = state("10000", order(1, BUY, MARKET, 1, null, symbol = "MSFT"))
        assertSame(s0, engine.process(s0, "AAPL", d("1")))
    }

    @Test fun `fills are recorded in order id sequence`() {
        val s = engine.process(
            state("10000", order(1, BUY, MARKET, 1, null), order(2, BUY, MARKET, 1, null)),
            "AAPL", d("10"),
        )
        assertEquals(listOf(1L, 2L), s.fills.map { it.orderId })
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `.\gradlew.bat testDebugUnitTest --tests "com.ishan.papertrade.domain.MatchingEngineTest"`
Expected: FAIL (unresolved `MatchingEngine`, `TradingState`).

- [ ] **Step 3: Implement**

`TradingState.kt`:

```kotlin
package com.ishan.papertrade.domain

data class TradingState(
    val portfolio: Portfolio,
    val orders: List<Order> = emptyList(),
    val fills: List<Fill> = emptyList(),
)
```

`TradingStore.kt`:

```kotlin
package com.ishan.papertrade.domain

interface TradingStore {
    suspend fun load(): TradingState
    suspend fun save(state: TradingState)
}
```

`MatchingEngine.kt`:

```kotlin
package com.ishan.papertrade.domain

import java.math.BigDecimal

class MatchingEngine {
    fun process(state: TradingState, symbol: String, price: BigDecimal): TradingState {
        var portfolio = state.portfolio
        val newFills = mutableListOf<Fill>()
        var changed = false
        val orders = state.orders.map { order ->
            if (order.symbol != symbol) return@map order
            val fill = OrderMatcher.tryFill(order, price) ?: return@map order
            changed = true
            try {
                portfolio = portfolio.applyFill(fill)
                newFills += fill
                order.copy(status = OrderStatus.FILLED)
            } catch (e: InsufficientFundsException) {
                order.copy(status = OrderStatus.REJECTED)
            } catch (e: InsufficientSharesException) {
                order.copy(status = OrderStatus.REJECTED)
            }
        }
        if (!changed) return state
        return TradingState(portfolio, orders, state.fills + newFills)
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `.\gradlew.bat testDebugUnitTest --tests "com.ishan.papertrade.domain.MatchingEngineTest"`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(domain): matching engine with fill-time affordability rejection"
```

---

### Task 5: Price source and simulated feed

**Files:**
- Create: `data/PriceSource.kt`, `data/SimulatedPriceSource.kt`
- Test: `app/src/test/java/com/ishan/papertrade/data/SimulatedPriceSourceTest.kt`

**Interfaces:**
- Produces:
  - `data class Quote(symbol: String, price: BigDecimal, timestampMs: Long)`
  - `interface PriceSource { fun quotes(symbols: Set<String>): Flow<Quote> }`
  - `class SimulatedPriceSource(start: Map<String, BigDecimal>, seed: Long = 42, tickMs: Long = 1000, clock: () -> Long = System::currentTimeMillis) : PriceSource`; emits one quote per symbol (sorted by symbol) each tick, price moves by at most ±0.2% per tick, 2 decimals, never below 0.01

- [ ] **Step 1: Write the failing tests**

```kotlin
package com.ishan.papertrade.data

import java.math.BigDecimal
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SimulatedPriceSourceTest {
    private val start = mapOf("AAPL" to BigDecimal("150.00"), "MSFT" to BigDecimal("300.00"))

    @Test fun `same seed gives the same sequence`() = runTest {
        val a = SimulatedPriceSource(start, seed = 7).quotes(start.keys).take(6).toList().map { it.price }
        val b = SimulatedPriceSource(start, seed = 7).quotes(start.keys).take(6).toList().map { it.price }
        assertEquals(a, b)
    }

    @Test fun `emits each requested symbol once per tick in symbol order`() = runTest {
        val quotes = SimulatedPriceSource(start).quotes(start.keys).take(4).toList()
        assertEquals(listOf("AAPL", "MSFT", "AAPL", "MSFT"), quotes.map { it.symbol })
    }

    @Test fun `prices stay positive, two decimals, and within 0_2 percent per tick`() = runTest {
        val quotes = SimulatedPriceSource(mapOf("AAPL" to BigDecimal("150.00")))
            .quotes(setOf("AAPL")).take(200).toList()
        var prev = BigDecimal("150.00")
        for (q in quotes) {
            assertTrue(q.price >= BigDecimal("0.01"))
            assertTrue(q.price.scale() <= 2)
            assertTrue((q.price - prev).abs() <= prev * BigDecimal("0.0021"))
            prev = q.price
        }
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `.\gradlew.bat testDebugUnitTest --tests "com.ishan.papertrade.data.SimulatedPriceSourceTest"`
Expected: FAIL (unresolved `SimulatedPriceSource`).

- [ ] **Step 3: Implement**

`PriceSource.kt`:

```kotlin
package com.ishan.papertrade.data

import java.math.BigDecimal
import kotlinx.coroutines.flow.Flow

data class Quote(val symbol: String, val price: BigDecimal, val timestampMs: Long)

interface PriceSource {
    fun quotes(symbols: Set<String>): Flow<Quote>
}
```

`SimulatedPriceSource.kt`:

```kotlin
package com.ishan.papertrade.data

import java.math.BigDecimal
import java.math.RoundingMode
import kotlin.random.Random
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

class SimulatedPriceSource(
    private val start: Map<String, BigDecimal>,
    private val seed: Long = 42,
    private val tickMs: Long = 1000,
    private val clock: () -> Long = System::currentTimeMillis,
) : PriceSource {
    private val floor = BigDecimal("0.01")

    override fun quotes(symbols: Set<String>): Flow<Quote> = flow {
        val rng = Random(seed)
        val prices = symbols.associateWith { start.getValue(it) }.toMutableMap()
        while (true) {
            for (symbol in symbols.sorted()) {
                val factor = (1.0 + (rng.nextDouble() - 0.5) * 0.004).toBigDecimal()
                val next = (prices.getValue(symbol) * factor).setScale(2, RoundingMode.HALF_UP).max(floor)
                prices[symbol] = next
                emit(Quote(symbol, next, clock()))
            }
            delay(tickMs)
        }
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `.\gradlew.bat testDebugUnitTest --tests "com.ishan.papertrade.data.SimulatedPriceSourceTest"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(data): PriceSource interface and seeded simulated feed"
```

---

### Task 6: TradingService (orchestration, concurrency)

**Files:**
- Create: `data/InMemoryTradingStore.kt`, `data/TradingService.kt`
- Test: `data/TradingServiceTest.kt`

**Interfaces:**
- Consumes: `TradingStore`, `TradingState`, `MatchingEngine`, `Order`, `Fill`, `Quote`.
- Produces:
  - `class InMemoryTradingStore(initial: TradingState) : TradingStore`
  - `class TradingService(store: TradingStore, engine: MatchingEngine = MatchingEngine())` with
    - `suspend fun placeOrder(symbol: String, side: Side, type: OrderType, quantity: Int, price: BigDecimal?, marketPrice: BigDecimal): Order` (returns the order in its resulting status; MARKET fills immediately, marketable LIMIT/STOP also fill immediately)
    - `suspend fun cancelOrder(orderId: Long): Boolean` (true only if the order was OPEN)
    - `suspend fun onQuote(quote: Quote): List<Fill>` (new fills caused by this quote)
    - `suspend fun state(): TradingState`
  - All four are guarded by one `Mutex`, so quotes and user actions never interleave.

- [ ] **Step 1: Write the failing tests**

```kotlin
package com.ishan.papertrade.data

import com.ishan.papertrade.domain.*
import com.ishan.papertrade.domain.OrderStatus.*
import com.ishan.papertrade.domain.OrderType.*
import com.ishan.papertrade.domain.Side.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TradingServiceTest {
    private fun service(cash: String = "10000") =
        TradingService(InMemoryTradingStore(TradingState(Portfolio(d(cash)))))

    @Test fun `market buy fills immediately and is persisted`() = runTest {
        val s = service()
        val order = s.placeOrder("AAPL", BUY, MARKET, 10, null, d("100"))
        assertEquals(FILLED, order.status)
        assertMoney("9000", s.state().portfolio.cash)
    }

    @Test fun `order ids increase`() = runTest {
        val s = service()
        val a = s.placeOrder("AAPL", BUY, LIMIT, 1, d("1"), d("100"))
        val b = s.placeOrder("AAPL", BUY, LIMIT, 1, d("1"), d("100"))
        assertEquals(a.id + 1, b.id)
    }

    @Test fun `limit order rests then fills when a quote crosses it`() = runTest {
        val s = service()
        val order = s.placeOrder("AAPL", BUY, LIMIT, 10, d("95"), d("100"))
        assertEquals(OPEN, order.status)
        assertTrue(s.onQuote(Quote("AAPL", d("97"), 1)).isEmpty())
        val fills = s.onQuote(Quote("AAPL", d("94"), 2))
        assertEquals(1, fills.size)
        assertMoney("9060", s.state().portfolio.cash)
    }

    @Test fun `cancel works only on open orders`() = runTest {
        val s = service()
        val resting = s.placeOrder("AAPL", BUY, LIMIT, 1, d("1"), d("100"))
        val filled = s.placeOrder("AAPL", BUY, MARKET, 1, null, d("100"))
        assertTrue(s.cancelOrder(resting.id))
        assertFalse(s.cancelOrder(filled.id))
        assertFalse(s.cancelOrder(999))
        assertEquals(CANCELLED, s.state().orders.first { it.id == resting.id }.status)
    }

    @Test fun `unaffordable order comes back rejected`() = runTest {
        val order = service("10").placeOrder("AAPL", BUY, MARKET, 10, null, d("100"))
        assertEquals(REJECTED, order.status)
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `.\gradlew.bat testDebugUnitTest --tests "com.ishan.papertrade.data.TradingServiceTest"`
Expected: FAIL (unresolved `TradingService`).

- [ ] **Step 3: Implement**

`InMemoryTradingStore.kt`:

```kotlin
package com.ishan.papertrade.data

import com.ishan.papertrade.domain.TradingState
import com.ishan.papertrade.domain.TradingStore

class InMemoryTradingStore(initial: TradingState) : TradingStore {
    private var current = initial
    override suspend fun load() = current
    override suspend fun save(state: TradingState) { current = state }
}
```

`TradingService.kt`:

```kotlin
package com.ishan.papertrade.data

import com.ishan.papertrade.domain.*
import java.math.BigDecimal
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class TradingService(
    private val store: TradingStore,
    private val engine: MatchingEngine = MatchingEngine(),
) {
    private val mutex = Mutex()

    suspend fun placeOrder(
        symbol: String, side: Side, type: OrderType, quantity: Int,
        price: BigDecimal?, marketPrice: BigDecimal,
    ): Order = mutex.withLock {
        val state = store.load()
        val id = (state.orders.maxOfOrNull { it.id } ?: 0L) + 1
        val withOrder = state.copy(orders = state.orders + Order(id, symbol, side, type, quantity, price))
        val next = engine.process(withOrder, symbol, marketPrice)
        store.save(next)
        next.orders.first { it.id == id }
    }

    suspend fun cancelOrder(orderId: Long): Boolean = mutex.withLock {
        val state = store.load()
        val target = state.orders.firstOrNull { it.id == orderId && it.status == OrderStatus.OPEN }
            ?: return@withLock false
        store.save(state.copy(orders = state.orders.map {
            if (it.id == target.id) it.copy(status = OrderStatus.CANCELLED) else it
        }))
        true
    }

    suspend fun onQuote(quote: Quote): List<Fill> = mutex.withLock {
        val state = store.load()
        val next = engine.process(state, quote.symbol, quote.price)
        if (next === state) return@withLock emptyList()
        store.save(next)
        next.fills.drop(state.fills.size)
    }

    suspend fun state(): TradingState = mutex.withLock { store.load() }
}
```

- [ ] **Step 4: Run the whole unit suite**

Run: `.\gradlew.bat testDebugUnitTest`
Expected: PASS (all tests from Tasks 2 to 6).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(data): mutex-guarded TradingService over a TradingStore"
```

---

### Task 7: Room persistence

**Files:**
- Create: `data/room/Entities.kt`, `data/room/TradingDao.kt`, `data/room/AppDatabase.kt`, `data/room/RoomTradingStore.kt`
- Test: `app/src/androidTest/java/com/ishan/papertrade/data/room/RoomTradingStoreTest.kt` (needs an emulator or device)

**Interfaces:**
- Consumes: `TradingStore`, `TradingState`, `Portfolio`, `Position`, `Order`, `Fill`.
- Produces: `class RoomTradingStore(dao: TradingDao, startingCash: BigDecimal = BigDecimal("100000.00")) : TradingStore`. `load()` returns a fresh `$100,000` portfolio when the DB is empty. `save()` replaces all rows in one transaction (fine for v1 data sizes).

- [ ] **Step 1: Write the failing instrumented test**

```kotlin
package com.ishan.papertrade.data.room

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.ishan.papertrade.domain.*
import java.math.BigDecimal
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RoomTradingStoreTest {
    private lateinit var db: AppDatabase
    private lateinit var store: RoomTradingStore

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java).build()
        store = RoomTradingStore(db.tradingDao())
    }

    @After fun tearDown() = db.close()

    @Test fun emptyDatabaseLoadsStartingCash() = runBlocking {
        assertEquals(0, BigDecimal("100000.00").compareTo(store.load().portfolio.cash))
    }

    @Test fun saveThenLoadRoundTrips() = runBlocking {
        val state = TradingState(
            portfolio = Portfolio(
                cash = BigDecimal("9005.00"),
                positions = mapOf("AAPL" to Position("AAPL", 10, BigDecimal("99.5000"))),
                realizedPnl = BigDecimal("12.34"),
            ),
            orders = listOf(
                Order(1, "AAPL", Side.BUY, OrderType.LIMIT, 10, BigDecimal("100"), OrderStatus.FILLED),
                Order(2, "AAPL", Side.SELL, OrderType.STOP, 10, BigDecimal("90")),
            ),
            fills = listOf(Fill(1, "AAPL", Side.BUY, 10, BigDecimal("99.50"))),
        )
        store.save(state)
        assertEquals(state, store.load())
    }
}
```

Note: `assertEquals(state, store.load())` relies on `BigDecimal` equality including scale; persist as `toPlainString()` and parse with `BigDecimal(string)` so the scale survives the round trip.

- [ ] **Step 2: Run to verify it fails**

Run: `.\gradlew.bat connectedDebugAndroidTest "-Pandroid.testInstrumentationRunnerArguments.class=com.ishan.papertrade.data.room.RoomTradingStoreTest"` (emulator running)
Expected: FAIL (unresolved `AppDatabase`).

- [ ] **Step 3: Implement**

`Entities.kt`:

```kotlin
package com.ishan.papertrade.data.room

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "account")
data class AccountEntity(@PrimaryKey val id: Int = 1, val cash: String, val realizedPnl: String)

@Entity(tableName = "positions")
data class PositionEntity(@PrimaryKey val symbol: String, val quantity: Int, val avgCost: String)

@Entity(tableName = "orders")
data class OrderEntity(
    @PrimaryKey val id: Long, val symbol: String, val side: String, val type: String,
    val quantity: Int, val price: String?, val status: String,
)

@Entity(tableName = "fills")
data class FillEntity(
    @PrimaryKey(autoGenerate = true) val rowId: Long = 0,
    val orderId: Long, val symbol: String, val side: String, val quantity: Int, val price: String,
)
```

`TradingDao.kt`:

```kotlin
package com.ishan.papertrade.data.room

import androidx.room.*

@Dao
abstract class TradingDao {
    @Query("SELECT * FROM account WHERE id = 1") abstract suspend fun account(): AccountEntity?
    @Query("SELECT * FROM positions") abstract suspend fun positions(): List<PositionEntity>
    @Query("SELECT * FROM orders ORDER BY id") abstract suspend fun orders(): List<OrderEntity>
    @Query("SELECT * FROM fills ORDER BY rowId") abstract suspend fun fills(): List<FillEntity>

    @Query("DELETE FROM positions") abstract suspend fun clearPositions()
    @Query("DELETE FROM orders") abstract suspend fun clearOrders()
    @Query("DELETE FROM fills") abstract suspend fun clearFills()

    @Insert(onConflict = OnConflictStrategy.REPLACE) abstract suspend fun put(account: AccountEntity)
    @Insert abstract suspend fun putPositions(rows: List<PositionEntity>)
    @Insert abstract suspend fun putOrders(rows: List<OrderEntity>)
    @Insert abstract suspend fun putFills(rows: List<FillEntity>)

    @Transaction
    open suspend fun replaceAll(
        account: AccountEntity, positions: List<PositionEntity>,
        orders: List<OrderEntity>, fills: List<FillEntity>,
    ) {
        clearPositions(); clearOrders(); clearFills()
        put(account); putPositions(positions); putOrders(orders); putFills(fills)
    }
}
```

`AppDatabase.kt`:

```kotlin
package com.ishan.papertrade.data.room

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [AccountEntity::class, PositionEntity::class, OrderEntity::class, FillEntity::class],
    version = 1,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun tradingDao(): TradingDao
}
```

`RoomTradingStore.kt`:

```kotlin
package com.ishan.papertrade.data.room

import com.ishan.papertrade.domain.*
import java.math.BigDecimal

class RoomTradingStore(
    private val dao: TradingDao,
    private val startingCash: BigDecimal = BigDecimal("100000.00"),
) : TradingStore {

    override suspend fun load(): TradingState {
        val account = dao.account() ?: return TradingState(Portfolio(cash = startingCash))
        return TradingState(
            portfolio = Portfolio(
                cash = BigDecimal(account.cash),
                realizedPnl = BigDecimal(account.realizedPnl),
                positions = dao.positions().associate {
                    it.symbol to Position(it.symbol, it.quantity, BigDecimal(it.avgCost))
                },
            ),
            orders = dao.orders().map {
                Order(it.id, it.symbol, Side.valueOf(it.side), OrderType.valueOf(it.type), it.quantity,
                    it.price?.let(::BigDecimal), OrderStatus.valueOf(it.status))
            },
            fills = dao.fills().map {
                Fill(it.orderId, it.symbol, Side.valueOf(it.side), it.quantity, BigDecimal(it.price))
            },
        )
    }

    override suspend fun save(state: TradingState) {
        dao.replaceAll(
            AccountEntity(cash = state.portfolio.cash.toPlainString(), realizedPnl = state.portfolio.realizedPnl.toPlainString()),
            state.portfolio.positions.values.map { PositionEntity(it.symbol, it.quantity, it.avgCost.toPlainString()) },
            state.orders.map { OrderEntity(it.id, it.symbol, it.side.name, it.type.name, it.quantity, it.price?.toPlainString(), it.status.name) },
            state.fills.map { FillEntity(orderId = it.orderId, symbol = it.symbol, side = it.side.name, quantity = it.quantity, price = it.price.toPlainString()) },
        )
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `.\gradlew.bat connectedDebugAndroidTest "-Pandroid.testInstrumentationRunnerArguments.class=com.ishan.papertrade.data.room.RoomTradingStoreTest"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(data): Room-backed TradingStore"
```

---

### Task 8: ViewModel, manual DI, and Compose screens

UI is verified by running it, not by unit tests; the logic it depends on is already tested in Tasks 2 to 7.

**Files:**
- Create: `AppContainer.kt`, `ui/TradingViewModel.kt`, `ui/WatchlistScreen.kt`, `ui/OrderTicket.kt`, `ui/PortfolioScreen.kt`, `ui/OrdersScreen.kt`
- Modify: `MainActivity.kt`

**Interfaces:**
- Consumes: `TradingService`, `PriceSource`, `TradingState`, `Quote`.
- Produces: `data class UiState(prices: Map<String, BigDecimal>, state: TradingState)`; `TradingViewModel` with `val ui: StateFlow<UiState>`, `fun place(symbol, side, type, qty, price)`, `fun cancel(orderId)`.

- [ ] **Step 1: Manual DI**

`AppContainer.kt`:

```kotlin
package com.ishan.papertrade

import android.content.Context
import androidx.room.Room
import com.ishan.papertrade.data.*
import com.ishan.papertrade.data.room.AppDatabase
import com.ishan.papertrade.data.room.RoomTradingStore
import java.math.BigDecimal

class AppContainer(context: Context) {
    val watchlist = listOf("AAPL", "MSFT", "TSLA", "NVDA", "AMZN")
    private val db = Room.databaseBuilder(context, AppDatabase::class.java, "papertrade.db").build()
    val tradingService = TradingService(RoomTradingStore(db.tradingDao()))
    val priceSource: PriceSource = SimulatedPriceSource(
        mapOf(
            "AAPL" to BigDecimal("190.00"), "MSFT" to BigDecimal("420.00"), "TSLA" to BigDecimal("250.00"),
            "NVDA" to BigDecimal("900.00"), "AMZN" to BigDecimal("180.00"),
        ),
    )
}
```

- [ ] **Step 2: ViewModel**

```kotlin
package com.ishan.papertrade.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.ishan.papertrade.AppContainer
import com.ishan.papertrade.data.PriceSource
import com.ishan.papertrade.data.TradingService
import com.ishan.papertrade.domain.*
import java.math.BigDecimal
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

data class UiState(val prices: Map<String, BigDecimal> = emptyMap(), val state: TradingState? = null)

class TradingViewModel(
    private val service: TradingService,
    private val priceSource: PriceSource,
    private val symbols: List<String>,
) : ViewModel() {
    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    init {
        viewModelScope.launch {
            _ui.update { it.copy(state = service.state()) }
            priceSource.quotes(symbols.toSet()).collect { quote ->
                service.onQuote(quote)
                _ui.update { it.copy(prices = it.prices + (quote.symbol to quote.price)) }
                _ui.update { it.copy(state = service.state()) }
            }
        }
    }

    fun place(symbol: String, side: Side, type: OrderType, qty: Int, price: BigDecimal?) {
        val market = _ui.value.prices[symbol] ?: return
        viewModelScope.launch {
            service.placeOrder(symbol, side, type, qty, price, market)
            _ui.update { it.copy(state = service.state()) }
        }
    }

    fun cancel(orderId: Long) {
        viewModelScope.launch {
            service.cancelOrder(orderId)
            _ui.update { it.copy(state = service.state()) }
        }
    }

    companion object {
        fun factory(c: AppContainer) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                TradingViewModel(c.tradingService, c.priceSource, c.watchlist) as T
        }
    }
}
```

- [ ] **Step 3: Screens**

Build three screens that read `ui` via `collectAsStateWithLifecycle()` and sit under a Material 3 `Scaffold` with a `NavigationBar` (Watchlist, Portfolio, Orders) in `MainActivity`:

- `WatchlistScreen`: `LazyColumn` of rows (symbol, price; color price green/red vs the previous tick, tracked with a `remember`ed map). Tapping a row opens `OrderTicket`.
- `OrderTicket` (`ModalBottomSheet`): side toggle, order type chips (Market/Limit/Stop), quantity field, price field shown only for Limit/Stop, Confirm button calling `vm.place(...)`. Disable Confirm when quantity is not a positive integer or a required price does not parse as `BigDecimal`.
- `PortfolioScreen`: header with equity (`portfolio.equity(prices)`), cash, realized P&L, unrealized P&L; below it a list of positions (symbol, qty, avg cost, last price, unrealized P&L).
- `OrdersScreen`: list of all orders with status; OPEN ones show a Cancel button calling `vm.cancel(id)`.

`MainActivity` gets the container with `AppContainer(applicationContext)`, creates the ViewModel with `viewModel(factory = TradingViewModel.factory(container))`.

- [ ] **Step 4: Run on an emulator and check the behavior**

Run: `.\gradlew.bat installDebug`, then open the app. Check:
1. Prices tick about once per second.
2. A market buy of 1 AAPL lowers cash and creates a position.
3. A limit buy 5% below market stays OPEN, then fills once the price drifts there (or cancel it).
4. Kill and relaunch the app: cash, positions, and orders persist.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): watchlist, order ticket, portfolio, orders screens"
```

---

## As time permits

Ordered by value per effort. Each item becomes its own mini-plan when we reach it.

**Phase 2: make it real (next, ~1 week)**
1. **Real quotes:** a `FinnhubPriceSource` (or Alpaca) behind `PriceSource`. Needs an API key and a check of the free-tier symbol and rate limits first. Keep the simulated source as the offline and demo fallback.
2. **Charts:** per-symbol line chart with time-range chips (1D/1W/1M). Store quote history in Room; start with a hand-drawn Compose `Canvas` line, no charting library.
3. **Trade history and performance summary:** win rate, best and worst trade, return over time, computed from `fills` by a pure `PerformanceCalculator` (TDD, same style as Task 3).

**Phase 3: broker-flavored depth (~1 week)**
4. **Price alerts:** `PriceAlert` entity, WorkManager periodic check against delayed quotes, local notifications.
5. **Risk view:** pure functions for concentration (largest position % of equity), simple volatility of equity snapshots, and max drawdown.
6. **Equity snapshots** (prerequisite for 3 and 5 charts): record equity on a timer.
7. **Biometric lock:** `BiometricPrompt` gate on app open.
8. **Background fills while the app is closed:** WorkManager runs `onQuote` against fetched delayed quotes (requires Real quotes).

**Phase 4: stretch**
9. **Margin simulation:** borrowing power, daily interest accrual, maintenance-margin check and margin-call warning. Pure and test-first like Task 3; do it before any UI work.
10. Candlestick charts; partial fills; short selling; cash reservation for resting BUY orders.
11. Hilt migration (replace `AppContainer`), encrypted Room (SQLCipher), Firebase Auth + Firestore sync, clean-architecture module split.

## Decisions to confirm before starting

1. **Package name** `com.ishan.papertrade` and app name `PaperTrade`: change in Task 1 if you want something else.
2. **Data provider** for Phase 2 (Finnhub vs Alpaca): not needed for Phase 1.
3. **Hilt later, manual DI now**: this deviates from your original stack to avoid setup friction in week 1; swap is mechanical.
