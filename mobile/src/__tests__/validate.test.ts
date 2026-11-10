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
