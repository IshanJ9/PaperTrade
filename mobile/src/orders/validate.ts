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
