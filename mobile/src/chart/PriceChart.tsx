import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { useApp } from '../AppContext';
import { formatMoney } from '../format';
import { buildLinePath, nearestIndex, percentChange, type ChartPoint } from './geometry';

type Range = '1D' | '1W' | '1M';
const RANGES: Range[] = ['1D', '1W', '1M'];
const HEIGHT = 220;

type Status = 'loading' | 'ready' | 'empty' | 'error';

export function PriceChart({ symbol }: { symbol: string }) {
  const { api } = useApp();
  const [range, setRange] = useState<Range>('1D');
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [attempt, setAttempt] = useState(0);
  const [width, setWidth] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setCursor(null);
    api
      .history(symbol, range)
      .then((h) => {
        if (cancelled) return;
        setPoints(h.points);
        setStatus(h.points.length >= 2 ? 'ready' : 'empty');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [api, symbol, range, attempt]);

  const path = useMemo(() => buildLinePath(points, width, HEIGHT, 8), [points, width]);
  const pathRef = useRef(path);
  pathRef.current = path;

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => setCursor(nearestIndex(pathRef.current.xs, e.nativeEvent.locationX)),
        onPanResponderMove: (e) => setCursor(nearestIndex(pathRef.current.xs, e.nativeEvent.locationX)),
        onPanResponderRelease: () => setCursor(null),
        onPanResponderTerminate: () => setCursor(null),
      }),
    [],
  );

  const shown = cursor !== null && cursor >= 0 ? points[cursor] : points[points.length - 1];
  const change = points.length >= 2 ? percentChange(points[0].p, points[points.length - 1].p) : null;
  const up = change === null || change >= 0;
  const lineColor = up ? '#16a34a' : '#dc2626';

  return (
    <View>
      <View style={styles.readout}>
        <Text style={styles.price}>{shown ? formatMoney(shown.p) : '—'}</Text>
        {shown ? <Text style={styles.time}>{new Date(shown.t).toLocaleString()}</Text> : null}
        {change !== null ? (
          <Text style={{ color: lineColor, fontWeight: '600' }}>
            {change >= 0 ? '+' : ''}
            {change.toFixed(2)}% over {range}
          </Text>
        ) : null}
      </View>

      <View style={[styles.chart, { height: HEIGHT }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} {...pan.panHandlers}>
        {status === 'ready' && width > 0 ? (
          <Svg width={width} height={HEIGHT} pointerEvents="none">
            <Path d={path.d} stroke={lineColor} strokeWidth={2} fill="none" />
            {cursor !== null && cursor >= 0 ? (
              <>
                <Line x1={path.xs[cursor]} x2={path.xs[cursor]} y1={0} y2={HEIGHT} stroke="#9ca3af" strokeWidth={1} />
                <Circle cx={path.xs[cursor]} cy={path.ys[cursor]} r={5} fill={lineColor} />
              </>
            ) : null}
          </Svg>
        ) : (
          <View style={styles.center}>
            {status === 'loading' ? <ActivityIndicator /> : null}
            {status === 'empty' ? <Text style={styles.muted}>Not enough history yet</Text> : null}
            {status === 'error' ? (
              <>
                <Text style={styles.muted}>Chart needs a connection</Text>
                <Pressable onPress={() => setAttempt(attempt + 1)}>
                  <Text style={styles.retry}>Retry</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        )}
      </View>

      <View style={styles.chips}>
        {RANGES.map((r) => (
          <Pressable key={r} style={[styles.chip, range === r && styles.chipOn]} onPress={() => setRange(r)}>
            <Text style={[styles.chipText, range === r && styles.chipTextOn]}>{r}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { paddingHorizontal: 16, paddingBottom: 8, minHeight: 72 },
  price: { fontSize: 32, fontWeight: '700' },
  time: { color: '#6b7280' },
  chart: { marginHorizontal: 0, backgroundColor: '#f9fafb' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  muted: { color: '#6b7280' },
  retry: { color: '#2563eb', fontWeight: '600' },
  chips: { flexDirection: 'row', gap: 8, padding: 16 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: '#d1d5db' },
  chipOn: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  chipText: { fontWeight: '600', color: '#111827' },
  chipTextOn: { color: '#fff' },
});
