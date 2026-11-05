import { useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";
import { palette } from "@/lib/palette";
import { formatClock } from "@/lib/core/format";

const HEIGHT = 190;
const PAD = { left: 38, right: 14, top: 14, bottom: 28 };

/**
 * رسم خطي بسيط لتقدم المراجعة: تراكم الفواتير المنتهية عبر الزمن، وخط متقطع عند إجمالي الفواتير.
 */
export function ProgressChart({ closedAt, total, now = Date.now() }: { closedAt: string[]; total: number; now?: number }) {
  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width));

  const times = closedAt.map((value) => Date.parse(value)).filter((value) => Number.isFinite(value));
  const maxY = Math.max(total, times.length, 1);
  const startX = times.length > 0 ? times[0] : now;
  const endX = Math.max(now, times.length > 0 ? times[times.length - 1] : now, startX + 60_000);

  const innerW = Math.max(width - PAD.left - PAD.right, 1);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + ((t - startX) / (endX - startX)) * innerW;
  const y = (v: number) => PAD.top + innerH - (v / maxY) * innerH;

  // خط تراكمي بدرجات: يبدأ من 0 عند أول إقفال
  const points: Array<[number, number]> = [[startX, 0]];
  times.forEach((t, index) => points.push([t, index + 1]));
  points.push([endX, times.length]);
  const polyline = points.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  return (
    <View onLayout={onLayout} style={styles.wrap} accessibilityLabel={`مخطط تقدم المراجعة: ${times.length} من ${total} فاتورة منتهية`}>
      {width > 0 ? (
        <Svg width={width} height={HEIGHT}>
          <Line x1={PAD.left} y1={y(0)} x2={width - PAD.right} y2={y(0)} stroke={palette.line} strokeWidth={1} />
          <Line x1={PAD.left} y1={y(total || maxY)} x2={width - PAD.right} y2={y(total || maxY)} stroke={palette.amber} strokeWidth={1.2} strokeDasharray="5 4" />
          <SvgText x={PAD.left - 6} y={y(0) + 4} fontSize={10} fill={palette.muted} textAnchor="end">0</SvgText>
          <SvgText x={PAD.left - 6} y={y(total || maxY) + 4} fontSize={10} fill={palette.amber} textAnchor="end">{String(total || maxY)}</SvgText>
          <Polyline points={polyline} fill="none" stroke={palette.teal} strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
          {times.length > 0 ? <Circle cx={x(endX)} cy={y(times.length)} r={4.5} fill={palette.teal} /> : null}
          <SvgText x={PAD.left} y={HEIGHT - 8} fontSize={10} fill={palette.muted} textAnchor="start">{formatClock(startX)}</SvgText>
          <SvgText x={width - PAD.right} y={HEIGHT - 8} fontSize={10} fill={palette.muted} textAnchor="end">{formatClock(endX)}</SvgText>
        </Svg>
      ) : null}
      <View style={styles.legend}>
        <View style={styles.legendItem}><View style={[styles.swatch, { backgroundColor: palette.teal }]} /><Text style={styles.legendText}>الفواتير المنتهية ({times.length})</Text></View>
        <View style={styles.legendItem}><View style={[styles.swatch, { backgroundColor: palette.amber }]} /><Text style={styles.legendText}>إجمالي الفواتير ({total})</Text></View>
      </View>
      {times.length === 0 ? <Text style={styles.hint}>سيبدأ الخط بالارتفاع مع إنهاء أول فاتورة.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  legend: { flexDirection: "row", gap: 18, flexWrap: "wrap", justifyContent: "flex-end" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 14, height: 4, borderRadius: 2 },
  legendText: { color: palette.inkSoft, fontSize: 12, fontWeight: "700" },
  hint: { color: palette.muted, fontSize: 12, textAlign: "center" },
});
