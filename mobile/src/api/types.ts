import type { OrderType, Side } from '../orders/validate';

export interface PositionDto { symbol: string; quantity: number; avg_cost: string; last_price: string; unrealized_pnl: string }
export interface PortfolioDto { cash: string; realized_pnl: string; unrealized_pnl: string; equity: string; positions: PositionDto[] }
export interface OrderDto { id: number; symbol: string; side: Side; type: OrderType; quantity: number; price: string | null; status: 'OPEN' | 'FILLED' | 'CANCELLED' | 'REJECTED' }
export interface TransactionDto { id: number; order_id: number; symbol: string; side: Side; quantity: number; price: string; created_at: string }
export interface Snapshot { server_time: string; portfolio: PortfolioDto; orders: OrderDto[]; transactions: TransactionDto[]; watchlist: string[] }
export interface QuoteDto { price: string; ts_ms: number; as_of_ms?: number | null; stale?: boolean }
export interface HistoryDto { symbol: string; range: string; points: { t: number; p: string }[] }
