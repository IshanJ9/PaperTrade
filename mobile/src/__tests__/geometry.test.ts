import { buildLinePath, nearestIndex, percentChange } from '../chart/geometry';

describe('buildLinePath', () => {
  it('draws a three-point line', () => {
    const r = buildLinePath([{ t: 0, p: '10' }, { t: 1, p: '20' }, { t: 2, p: '10' }], 100, 50);
    expect(r.d).toBe('M0,50 L50,0 L100,50');
    expect(r.xs).toEqual([0, 50, 100]);
    expect(r.ys).toEqual([50, 0, 50]);
    expect([r.min, r.max]).toEqual([10, 20]);
  });

  it.each([[[]], [[{ t: 1, p: '5' }]]])('returns an empty path for fewer than two points (%j)', (points) => {
    expect(buildLinePath(points as any, 100, 50).d).toBe('');
  });

  it('draws a flat series in the middle', () => {
    const r = buildLinePath([{ t: 0, p: '7' }, { t: 5, p: '7' }, { t: 9, p: '7' }], 100, 50);
    expect(r.ys).toEqual([25, 25, 25]);
    expect(r.d).not.toContain('NaN');
  });

  it('survives duplicate timestamps without NaN', () => {
    const r = buildLinePath([{ t: 4, p: '1' }, { t: 4, p: '3' }, { t: 4, p: '2' }], 100, 50);
    expect(r.d).not.toContain('NaN');
    expect(r.xs.every(Number.isFinite)).toBe(true);
  });

  it('respects padding', () => {
    const r = buildLinePath([{ t: 0, p: '10' }, { t: 1, p: '20' }, { t: 2, p: '10' }], 100, 50, 10);
    expect(r.d).toBe('M10,40 L50,10 L90,40');
  });
});

describe('nearestIndex', () => {
  it('picks the closest x and clamps', () => {
    expect(nearestIndex([0, 50, 100], 40)).toBe(1);
    expect(nearestIndex([0, 50, 100], -20)).toBe(0);
    expect(nearestIndex([0, 50, 100], 999)).toBe(2);
    expect(nearestIndex([], 5)).toBe(-1);
  });
});

describe('percentChange', () => {
  it('computes a display-only percentage', () => {
    expect(percentChange('100', '110')).toBeCloseTo(10);
    expect(percentChange('200', '150')).toBeCloseTo(-25);
  });
  it('is null when the first price is not a positive number', () => {
    expect(percentChange('0', '5')).toBeNull();
    expect(percentChange('abc', '5')).toBeNull();
  });
});
