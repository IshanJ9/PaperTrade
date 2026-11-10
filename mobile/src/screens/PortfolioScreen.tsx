import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { Alert, AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { PortfolioDto } from '../api/types';
import { useApp } from '../AppContext';
import { formatMoney, formatTime, pnlColor } from '../format';
import { liveStatus } from '../liveStatus';

const POLL_MS = 3000;

export function PortfolioScreen() {
  const { api, snapshot, syncedAt, syncError, sync, signOut, queue } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  const [live, setLive] = useState<PortfolioDto | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  // While this tab is focused and the app is active, ask the server for the portfolio every 3 s.
  // The server computes P&L from the latest cached quotes; the app only displays what it receives.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const tick = async () => {
        if (AppState.currentState === 'active') {
          try {
            const fresh = await api.portfolio();
            if (!cancelled) {
              setLive(fresh);
              setLastOk(Date.now());
            }
          } catch {
            // keep showing the last data; the badge reflects how old it is
          }
        }
        if (!cancelled) setNow(Date.now());
      };
      void tick();
      const timer = setInterval(tick, POLL_MS);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }, [api]),
  );

  const status = liveStatus(lastOk, now);
  const p = live ?? snapshot?.portfolio;
  const badge = status === 'live' ? 'LIVE' : status === 'stale' && !syncError ? 'DELAYED' : 'OFFLINE';
  const badgeColor = badge === 'LIVE' ? '#16a34a' : badge === 'DELAYED' ? '#d97706' : '#9ca3af';

  function confirmSignOut() {
    if (queue.some((q) => q.status === 'queued')) {
      Alert.alert('Sign out?', 'You have orders waiting to be sent. They will be discarded.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
      ]);
    } else {
      void signOut();
    }
  }

  async function refresh() {
    setRefreshing(true);
    await sync();
    setRefreshing(false);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Portfolio</Text>
        <Text style={[styles.badge, { backgroundColor: badgeColor }]}>{badge}</Text>
        <Pressable onPress={confirmSignOut}>
          <Text style={styles.link}>Sign out</Text>
        </Pressable>
      </View>
      {p ? (
        <View style={styles.summary}>
          <Text style={styles.equity}>{formatMoney(p.equity)}</Text>
          <Text style={styles.label}>Equity</Text>
          <View style={styles.grid}>
            <Stat label="Cash" value={formatMoney(p.cash)} />
            <Stat label="Realized P&L" value={formatMoney(p.realized_pnl)} color={pnlColor(p.realized_pnl)} />
            <Stat label="Unrealized P&L" value={formatMoney(p.unrealized_pnl)} color={pnlColor(p.unrealized_pnl)} />
          </View>
        </View>
      ) : null}
      <FlatList
        data={p?.positions ?? []}
        keyExtractor={(x) => x.symbol}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No positions yet. Buy something from the Watchlist.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View>
              <Text style={styles.symbol}>{item.symbol}</Text>
              <Text style={styles.muted}>{item.quantity} sh @ {formatMoney(item.avg_cost)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text>{formatMoney(item.last_price)}</Text>
              <Text style={{ color: pnlColor(item.unrealized_pnl) }}>{formatMoney(item.unrealized_pnl)}</Text>
            </View>
          </View>
        )}
      />
      <Text style={styles.footer}>
        {badge === 'LIVE' ? 'Updating live' : syncedAt ? `Last synced ${formatTime(syncedAt)}` : 'Not synced yet'}
      </Text>
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 48 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12 },
  title: { fontSize: 24, fontWeight: '700', flex: 1 },
  badge: { color: '#fff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden', fontWeight: '700', fontSize: 12 },
  link: { color: '#2563eb', fontWeight: '600' },
  summary: { padding: 16 },
  equity: { fontSize: 34, fontWeight: '700' },
  label: { color: '#6b7280', fontSize: 12 },
  grid: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  stat: { flex: 1 },
  statValue: { fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#e5e7eb' },
  symbol: { fontSize: 18, fontWeight: '600' },
  muted: { color: '#6b7280' },
  empty: { textAlign: 'center', color: '#6b7280', padding: 32 },
  footer: { textAlign: 'center', color: '#6b7280', padding: 12 },
});
