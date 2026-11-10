export type LiveStatus = 'live' | 'stale' | 'offline';

/** How fresh the last successful live poll is. No poll yet (null) is offline. */
export function liveStatus(lastOkMs: number | null, nowMs: number, maxAgeMs = 10_000): LiveStatus {
  if (lastOkMs === null) return 'offline';
  return nowMs - lastOkMs <= maxAgeMs ? 'live' : 'stale';
}
