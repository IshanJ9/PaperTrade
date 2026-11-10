import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../AppContext';
import { PriceChart } from '../chart/PriceChart';
import { formatMoney } from '../format';
import type { Side } from '../orders/validate';
import { OrderTicket } from './OrderTicket';

export function SymbolScreen({ route }: { route: { params: { symbol: string } } }) {
  const symbol = route.params.symbol;
  const { api, snapshot, sync } = useApp();
  const [price, setPrice] = useState<string | undefined>();
  const [closed, setClosed] = useState(false);
  const [ticketSide, setTicketSide] = useState<Side | null>(null);
  const watching = snapshot?.watchlist.includes(symbol) ?? false;

  // Live price for the header while this screen is focused.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const tick = async () => {
        try {
          const q = await api.quotes([symbol]);
          if (!cancelled && q[symbol]) {
            setPrice(q[symbol].price);
            setClosed(q[symbol].stale === true);
          }
        } catch {
          // keep the last price
        }
      };
      void tick();
      const timer = setInterval(tick, 2000);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }, [api, symbol]),
  );

  async function toggleWatch() {
    const list = snapshot?.watchlist ?? [];
    await api.setWatchlist(watching ? list.filter((s) => s !== symbol) : [...list, symbol]);
    await sync();
  }

  return (
    <View style={styles.container}>
      <ScrollView>
        <View style={styles.header}>
          <Text style={styles.symbol}>{symbol}</Text>
          <Text style={styles.live}>{price ? `${closed ? 'Market closed, last price' : 'Live'} ${formatMoney(price)}` : 'No live price'}</Text>
          <Pressable onPress={toggleWatch}>
            <Text style={styles.link}>{watching ? 'Remove from watchlist' : 'Add to watchlist'}</Text>
          </Pressable>
        </View>
        <PriceChart symbol={symbol} />
      </ScrollView>
      <View style={styles.actions}>
        <Pressable style={[styles.action, styles.buy]} onPress={() => setTicketSide('BUY')}>
          <Text style={styles.actionText}>Buy</Text>
        </Pressable>
        <Pressable style={[styles.action, styles.sell]} onPress={() => setTicketSide('SELL')}>
          <Text style={styles.actionText}>Sell</Text>
        </Pressable>
      </View>
      <OrderTicket symbol={ticketSide ? symbol : null} initialSide={ticketSide ?? 'BUY'} price={price} onClose={() => setTicketSide(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { padding: 16, gap: 4 },
  symbol: { fontSize: 24, fontWeight: '700' },
  live: { color: '#6b7280' },
  link: { color: '#2563eb', fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 12, padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#e5e7eb' },
  action: { flex: 1, padding: 14, borderRadius: 8, alignItems: 'center' },
  buy: { backgroundColor: '#16a34a' },
  sell: { backgroundColor: '#dc2626' },
  actionText: { color: '#fff', fontWeight: '700' },
});
