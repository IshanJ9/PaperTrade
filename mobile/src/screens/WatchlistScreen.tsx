import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { QuoteDto } from '../api/types';
import { useApp } from '../AppContext';
import { formatMoney } from '../format';
import { SUPPORTED_SYMBOLS } from '../symbols';

export function WatchlistScreen() {
  const { api, snapshot, sync } = useApp();
  const watchlist = snapshot?.watchlist ?? [];
  const [quotes, setQuotes] = useState<Record<string, QuoteDto>>({});
  const [direction, setDirection] = useState<Record<string, 'up' | 'down' | 'flat'>>({});
  const [offline, setOffline] = useState(false);
  const [editing, setEditing] = useState(false);
  const navigation = useNavigation<any>();
  const previous = useRef<Record<string, string>>({});
  const listRef = useRef(watchlist);
  listRef.current = watchlist;

  // Poll quotes every 2 s while this screen is focused.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const tick = async () => {
        if (listRef.current.length === 0) return;
        try {
          const fresh = await api.quotes(listRef.current);
          if (cancelled) return;
          const dir: Record<string, 'up' | 'down' | 'flat'> = {};
          for (const [symbol, q] of Object.entries(fresh)) {
            const before = previous.current[symbol];
            dir[symbol] = before === undefined || before === q.price ? 'flat' : Number(q.price) > Number(before) ? 'up' : 'down';
            previous.current[symbol] = q.price;
          }
          setQuotes((old) => ({ ...old, ...fresh }));
          setDirection((old) => ({ ...old, ...dir }));
          setOffline(false);
        } catch {
          if (!cancelled) setOffline(true);
        }
      };
      void tick();
      const timer = setInterval(tick, 2000);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }, [api]),
  );

  async function toggleSymbol(symbol: string) {
    const next = watchlist.includes(symbol) ? watchlist.filter((s) => s !== symbol) : [...watchlist, symbol];
    await api.setWatchlist(next);
    await sync();
  }

  const color = (s: string) => (direction[s] === 'up' ? '#16a34a' : direction[s] === 'down' ? '#dc2626' : '#111827');
  const rows = editing ? SUPPORTED_SYMBOLS : watchlist;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Watchlist</Text>
        {offline ? <Text style={styles.badge}>Offline</Text> : null}
        {!offline && Object.values(quotes).some((q) => q.stale) ? <Text style={styles.badge}>Market closed</Text> : null}
        <Pressable onPress={() => setEditing(!editing)}>
          <Text style={styles.edit}>{editing ? 'Done' : 'Edit'}</Text>
        </Pressable>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(s) => s}
        ListEmptyComponent={<Text style={styles.empty}>Your watchlist is empty. Tap Edit to add symbols.</Text>}
        renderItem={({ item }) => {
          const q = quotes[item];
          return (
            <Pressable style={styles.row} onPress={() => (editing ? toggleSymbol(item) : navigation.navigate('Symbol', { symbol: item }))}>
              <Text style={styles.symbol}>{item}</Text>
              {editing ? (
                <Text style={styles.edit}>{watchlist.includes(item) ? 'Remove' : 'Add'}</Text>
              ) : (
                <Text style={[styles.price, { color: color(item), opacity: offline ? 0.5 : 1 }]}>{q ? formatMoney(q.price) : '—'}</Text>
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 48 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, gap: 12 },
  title: { fontSize: 24, fontWeight: '700', flex: 1 },
  badge: { backgroundColor: '#9ca3af', color: '#fff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  edit: { color: '#2563eb', fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#e5e7eb' },
  symbol: { fontSize: 18, fontWeight: '600' },
  price: { fontSize: 18, fontVariant: ['tabular-nums'] },
  empty: { textAlign: 'center', color: '#6b7280', padding: 32 },
});
