import { liveStatus } from '../liveStatus';

it('is live within the max age', () => expect(liveStatus(1000, 5000)).toBe('live'));
it('is stale after the max age', () => expect(liveStatus(1000, 20000)).toBe('stale'));
it('is offline with no successful poll', () => expect(liveStatus(null, 5000)).toBe('offline'));
it('boundary: exactly the max age is still live', () => expect(liveStatus(0, 10_000)).toBe('live'));
it('one millisecond past the max age is stale', () => expect(liveStatus(0, 10_001)).toBe('stale'));
it('respects a custom max age', () => expect(liveStatus(0, 4_000, 3_000)).toBe('stale'));
