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
