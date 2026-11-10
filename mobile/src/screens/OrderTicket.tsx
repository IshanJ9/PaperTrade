import { randomUUID } from 'expo-crypto';
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useApp } from '../AppContext';
import { formatMoney } from '../format';
import { validateOrderInput, type OrderType, type Side } from '../orders/validate';

interface Props {
  symbol: string | null;
  initialSide?: Side;
  price?: string;
  onClose(): void;
}

export function OrderTicket({ symbol, initialSide = 'BUY', price: marketPrice, onClose }: Props) {
  const { submit } = useApp();
  const [side, setSide] = useState<Side>('BUY');
  const [type, setType] = useState<OrderType>('MARKET');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One id per order attempt, kept across Retry so a retry can never double-fill.
  const clientOrderId = useRef(randomUUID());

  useEffect(() => {
    if (symbol) {
      clientOrderId.current = randomUUID();
      setMessage(null);
      setQuantity('1');
      setPrice('');
      setType('MARKET');
      setSide(initialSide);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const validation = validateOrderInput({ type, quantity, price });

  async function confirm() {
    if (!symbol) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await submit({
        client_order_id: clientOrderId.current,
        symbol,
        side,
        type,
        quantity: Number(quantity),
        price: type === 'MARKET' ? undefined : price,
      });
      if (result.kind === 'sent') {
        const status = result.order.status;
        setMessage(status === 'FILLED' ? 'Filled' : status === 'OPEN' ? 'Order placed (open)' : `Order ${status.toLowerCase()}`);
        clientOrderId.current = randomUUID(); // a new order next time
      } else if (result.kind === 'queued') {
        setMessage('Queued. It will be sent when you are back online (orders older than 24 hours are dropped).');
        clientOrderId.current = randomUUID();
      } else {
        setMessage(result.error); // for 503 the server says why: no price yet, or the market is closed
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={symbol !== null} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{symbol} {marketPrice ? `· ${formatMoney(marketPrice)}` : ''}</Text>
          <View style={styles.row}>
            {(['BUY', 'SELL'] as Side[]).map((s) => (
              <Pressable key={s} style={[styles.chip, side === s && (s === 'BUY' ? styles.buy : styles.sell)]} onPress={() => setSide(s)}>
                <Text style={[styles.chipText, side === s && styles.chipTextOn]}>{s}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            {(['MARKET', 'LIMIT', 'STOP'] as OrderType[]).map((t) => (
              <Pressable key={t} style={[styles.chip, type === t && styles.chipOn]} onPress={() => setType(t)}>
                <Text style={[styles.chipText, type === t && styles.chipTextOn]}>{t}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput style={styles.input} keyboardType="number-pad" placeholder="Shares" value={quantity} onChangeText={setQuantity} />
          {validation.errors.quantity ? <Text style={styles.error}>{validation.errors.quantity}</Text> : null}
          {type !== 'MARKET' ? (
            <>
              <TextInput style={styles.input} keyboardType="decimal-pad" placeholder={type === 'LIMIT' ? 'Limit price' : 'Stop price'} value={price} onChangeText={setPrice} />
              {validation.errors.price ? <Text style={styles.error}>{validation.errors.price}</Text> : null}
            </>
          ) : null}
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <Pressable style={[styles.confirm, (!validation.ok || busy) && styles.disabled]} disabled={!validation.ok || busy} onPress={confirm}>
            <Text style={styles.confirmText}>{busy ? 'Sending…' : 'Confirm'}</Text>
          </Pressable>
          <Pressable onPress={onClose}>
            <Text style={styles.close}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: '#fff', padding: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  chip: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center' },
  chipOn: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  buy: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  sell: { backgroundColor: '#dc2626', borderColor: '#dc2626' },
  chipText: { fontWeight: '600', color: '#111827' },
  chipTextOn: { color: '#fff' },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 12, marginBottom: 8 },
  error: { color: '#dc2626', marginBottom: 8 },
  message: { fontWeight: '600', marginVertical: 8 },
  confirm: { backgroundColor: '#2563eb', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  confirmText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.4 },
  close: { textAlign: 'center', color: '#6b7280', marginTop: 14 },
});
