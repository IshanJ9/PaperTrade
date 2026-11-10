import React from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../AppContext';
import { formatMoney } from '../format';

export function ActivityScreen() {
  const { api, snapshot, sync, queue, removeQueued } = useApp();

  async function cancel(id: number) {
    try {
      await api.cancelOrder(id);
    } finally {
      await sync();
    }
  }

  const sections = [
    ...(queue.length
      ? [
          {
            title: 'Queued (not sent yet)',
            data: queue.map((q) => ({
              key: `q${q.client_order_id}`,
              id: 0,
              line: `${q.payload.side} ${q.payload.quantity} ${q.payload.symbol} ${q.payload.type}${q.payload.price ? ` @ ${formatMoney(q.payload.price)}` : ''}`,
              status: q.status === 'queued' ? 'Waiting for a connection' : q.status === 'expired' ? 'Expired (older than 24 hours)' : `Rejected: ${q.error ?? 'unknown'}`,
              cancellable: false,
              queuedId: q.client_order_id as string | undefined,
            })),
          },
        ]
      : []),
    {
      title: 'Orders',
      data: (snapshot?.orders ?? []).map((o) => ({
        key: `o${o.id}`,
        id: o.id,
        line: `${o.side} ${o.quantity} ${o.symbol} ${o.type}${o.price ? ` @ ${formatMoney(o.price)}` : ''}`,
        status: o.status,
        cancellable: o.status === 'OPEN',
        queuedId: undefined as string | undefined,
      })),
    },
    {
      title: 'Transactions',
      data: (snapshot?.transactions ?? []).map((t) => ({
        key: `t${t.id}`,
        id: t.id,
        line: `${t.side} ${t.quantity} ${t.symbol} @ ${formatMoney(t.price)}`,
        status: new Date(t.created_at).toLocaleString(),
        cancellable: false,
        queuedId: undefined as string | undefined,
      })),
    },
  ];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Activity</Text>
      <SectionList
        sections={sections}
        keyExtractor={(i) => i.key}
        renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.line}>{item.line}</Text>
              <Text style={styles.muted}>{item.status}</Text>
            </View>
            {item.cancellable ? (
              <Pressable onPress={() => cancel(item.id)}>
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
            ) : null}
            {item.queuedId ? (
              <Pressable onPress={() => removeQueued(item.queuedId!)}>
                <Text style={styles.cancel}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>Nothing here yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 48 },
  title: { fontSize: 24, fontWeight: '700', paddingHorizontal: 16, paddingBottom: 8 },
  section: { backgroundColor: '#f3f4f6', paddingHorizontal: 16, paddingVertical: 6, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#e5e7eb' },
  line: { fontSize: 16, fontWeight: '600' },
  muted: { color: '#6b7280' },
  cancel: { color: '#dc2626', fontWeight: '600' },
  empty: { textAlign: 'center', color: '#6b7280', padding: 32 },
});
