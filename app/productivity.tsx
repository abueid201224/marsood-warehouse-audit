import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Button, Card, EmptyState, Header, Notice, Screen } from "@/components/MarsoodUI";
import type { OperatorStat } from "@/lib/core/engine";
import { formatDuration, formatPercent } from "@/lib/core/format";
import { useEngine } from "@/lib/core/hooks";
import { palette } from "@/lib/palette";

type Period = "today" | "week" | "all";
const PERIODS: Array<{ key: Period; label: string }> = [
  { key: "today", label: "اليوم" },
  { key: "week", label: "7 أيام" },
  { key: "all", label: "الكل" },
];

function sinceIso(period: Period): string | null {
  if (period === "all") return null;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (period === "week") d.setDate(d.getDate() - 6);
  return d.toISOString();
}

function unitsPerHour(stat: OperatorStat): number | null {
  const units = stat.ok + stat.over;
  return stat.activeSeconds >= 60 ? units / (stat.activeSeconds / 3600) : null;
}

/** لوحة إنتاجية المشغّلين (للمشرف): الوحدات، الفواتير، الأخطاء، المعدل بالساعة. */
export default function ProductivityScreen() {
  const { engine } = useEngine();
  const [period, setPeriod] = useState<Period>("today");
  const [stats, setStats] = useState<OperatorStat[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!engine) return;
    setStats(null);
    engine.operatorStats(sinceIso(period)).then(setStats).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "تعذر قراءة الإنتاجية."));
  }, [engine, period]);

  const totals = useMemo(() => (stats ?? []).reduce((acc, s) => ({ units: acc.units + s.ok + s.over, wrong: acc.wrong + s.wrong, closed: acc.closed + s.closed }), { units: 0, wrong: 0, closed: 0 }), [stats]);

  return (
    <Screen>
      <Header title="إنتاجية المشغّلين" subtitle="من سجل المسح؛ المعدل بالساعة يحتسب وقت النشاط الفعلي فقط" />
      <Button title="رجوع" icon="arrow-right" variant="outline" onPress={() => router.back()} />
      <View style={styles.chips}>
        {PERIODS.map((p) => (
          <Pressable key={p.key} onPress={() => setPeriod(p.key)} style={[styles.chip, period === p.key && styles.chipOn]} accessibilityRole="button">
            <Text style={[styles.chipText, period === p.key && { color: "#FFFFFF" }]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Notice tone="danger" title="غير متاح" body={error} /> : null}
      {stats && stats.length === 0 ? <EmptyState icon="account-clock-outline" title="لا توجد مسحات في هذه الفترة" body="تظهر الإنتاجية بعد أن يمسح المشغّلون أصنافاً بحساباتهم." /> : null}
      {stats && stats.length > 0 ? (
        <Card>
          <Text style={styles.total}>الإجمالي: {totals.units} وحدة • {totals.closed} فاتورة منتهية • {totals.wrong} خطأ تجهيز</Text>
        </Card>
      ) : null}
      {stats?.map((s) => {
        const rate = unitsPerHour(s);
        const attempts = s.ok + s.over + s.wrong;
        return (
          <Card key={s.operator}>
            <Text style={styles.name}>{s.operator}</Text>
            <View style={styles.grid}>
              <Cell label="وحدات مجهّزة" value={String(s.ok + s.over)} />
              <Cell label="فواتير منتهية" value={String(s.closed)} />
              <Cell label="مرحّلة" value={String(s.posted)} />
              <Cell label="أخطاء تجهيز" value={String(s.wrong)} tone={s.wrong > 0 ? palette.red : undefined} />
              <Cell label="تجهيز زائد" value={String(s.over)} />
              <Cell label="نسبة الخطأ" value={attempts ? formatPercent(Math.round((s.wrong / attempts) * 1000) / 10) : "—"} />
              <Cell label="وحدة/ساعة" value={rate === null ? "—" : rate.toFixed(0)} />
              <Cell label="وقت النشاط" value={formatDuration(s.activeSeconds)} />
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.cell}>
      <Text style={[styles.value, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { borderWidth: 1, borderColor: palette.tealDeep, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#FFFFFF" },
  chipOn: { backgroundColor: palette.tealDeep },
  chipText: { color: palette.tealDeep, fontWeight: "800", fontSize: 14 },
  total: { color: palette.ink, fontSize: 15, fontWeight: "800", textAlign: "right" },
  name: { color: palette.ink, fontSize: 18, fontWeight: "900", textAlign: "right" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  cell: { minWidth: 96, flexGrow: 1, flexBasis: 96, alignItems: "center", paddingVertical: 8, borderRadius: 12, backgroundColor: "#F1F5F9" },
  value: { color: palette.ink, fontSize: 20, fontWeight: "900" },
  label: { color: palette.muted, fontSize: 12, marginTop: 2, textAlign: "center" },
});
