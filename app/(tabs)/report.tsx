import { useCallback, useState } from "react";
import { Share, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Print from "expo-print";
import { Button, Card, EmptyState, Header, Metric, Notice, Screen, SectionTitle } from "@/components/MarsoodUI";
import type { ErrorReport } from "@/lib/core/engine";
import { formatDateTime } from "@/lib/core/format";
import { useEngine } from "@/lib/core/hooks";
import { buildReportHtml, reportToText } from "@/lib/core/report";
import { palette } from "@/lib/palette";

export default function ReportScreen() {
  const { engine, error } = useEngine();
  const [report, setReport] = useState<ErrorReport | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(() => {
    if (!engine) return;
    engine.errorReport().then((value) => { setReport(value); setMessage(""); }).catch((cause: unknown) => setMessage(cause instanceof Error ? cause.message : "تعذر إعداد التقرير."));
  }, [engine]);
  useFocusEffect(load);

  async function print() {
    if (!report) return;
    try {
      await Print.printAsync({ html: buildReportHtml(report) });
    } catch (cause) {
      setMessage(`تعذرت الطباعة: ${cause instanceof Error ? cause.message : "خطأ غير معروف"}. جرّب «مشاركة كنص».`);
    }
  }

  async function share() {
    if (!report) return;
    await Share.share({ message: reportToText(report) }).catch(() => undefined);
  }

  const wrongTotal = report?.wrong.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const overTotal = report?.over.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const empty = !!report && wrongTotal === 0 && overTotal === 0 && report.shortages.length === 0 && report.unknown.length === 0;

  return (
    <Screen>
      <Header title="تقرير الأخطاء" subtitle={report ? `حتى ${formatDateTime(report.generatedAt)}` : "أخطاء المسح والنواقص"} />
      {error || message ? <Notice title="يلزم الانتباه" body={error || message} tone="danger" /> : null}
      {report ? (
        <>
          <View style={styles.metrics}>
            <Metric label="أخطاء تجهيز" value={String(wrongTotal)} icon="close-octagon-outline" accent={wrongTotal ? palette.red : palette.tealDeep} />
            <Metric label="تجهيز زائد" value={String(overTotal)} icon="plus-circle-outline" accent={overTotal ? palette.amber : palette.tealDeep} />
            <Metric label="أصناف ناقصة مرحّلة" value={String(report.shortages.length)} icon="package-variant-closed-remove" accent={report.shortages.length ? palette.amber : palette.tealDeep} />
          </View>
          <View style={styles.actions}>
            <View style={styles.action}><Button title="طباعة التقرير" icon="printer-outline" onPress={print} /></View>
            <View style={styles.action}><Button title="مشاركة كنص" icon="share-variant-outline" variant="outline" onPress={share} /></View>
            <View style={styles.action}><Button title="تحديث" icon="refresh" variant="outline" onPress={load} /></View>
          </View>
          {empty ? <Card><EmptyState icon="check-decagram-outline" title="لا توجد أخطاء" body="لم تُسجَّل أخطاء تجهيز أو تجهيز زائد أو نواقص حتى الآن." /></Card> : null}

          <Section title="أخطاء التجهيز" hint="كود ليس من أصناف الفاتورة" empty="لا توجد أخطاء تجهيز." rows={report.wrong.map((r) => `طلب ${r.orderNo} • فاتورة ${r.invoices || "—"} • كود ${r.code} × ${r.count}`)} color={palette.red} />
          <Section title="التجهيز الزائد" hint="مسح أكثر من الكمية المسجلة" empty="لا يوجد تجهيز زائد." rows={report.over.map((r) => `طلب ${r.orderNo} • كود ${r.code} • مطلوب ${r.expected} وممسوح ${r.scanned}`)} color={palette.amber} />
          <Section title="النواقص في الفواتير المرحّلة" hint="أصناف تحتاج استكمالاً" empty="لا توجد نواقص." rows={report.shortages.map((r) => `طلب ${r.orderNo} • كود ${r.code} • ناقص ${r.expected - r.scanned} من ${r.expected}`)} color={palette.amber} />
          <Section title="مسحات غير مرتبطة بفاتورة" hint="رقم طلب غير موجود أو كود بلا فاتورة مفتوحة" empty="لا توجد مسحات غير مرتبطة." rows={report.unknown.map((r) => `${r.code} • ${formatDateTime(r.at)}`)} color={palette.muted} />
        </>
      ) : null}
    </Screen>
  );
}

function Section({ title, hint, rows, empty, color }: { title: string; hint: string; rows: string[]; empty: string; color: string }) {
  return (
    <Card>
      <SectionTitle title={title} hint={hint} />
      {rows.length === 0 ? <Text style={styles.empty}>{empty}</Text> : rows.slice(0, 200).map((row, index) => (
        <Text key={`${index}-${row}`} style={[styles.row, { borderRightColor: color }]} selectable>{row}</Text>
      ))}
      {rows.length > 200 ? <Text style={styles.empty}>و{rows.length - 200} سطر آخر في التقرير المطبوع.</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  action: { flexGrow: 1, minWidth: 180 },
  row: { color: palette.text, fontSize: 13, textAlign: "right", borderRightWidth: 3, paddingRight: 10, paddingVertical: 4 },
  empty: { color: palette.muted, fontSize: 13, textAlign: "right" },
});
