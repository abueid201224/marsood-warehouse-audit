import { useCallback, useState } from "react";
import { Share, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Print from "expo-print";
import { Button, Card, EmptyState, Header, Metric, Notice, ProgressBar, Screen, SectionTitle } from "@/components/MarsoodUI";
import type { ErrorReport, SessionStatus } from "@/lib/core/engine";
import { formatDateTime } from "@/lib/core/format";
import { useEngine } from "@/lib/core/hooks";
import { buildReportHtml, reportToText } from "@/lib/core/report";
import { PRINT_KIND_LABELS, PRINT_STATUS_LABELS } from "@/lib/core/format";
import { exportLabel, exportReport, pickExportFolder, type ExportKind } from "@/lib/export/files";
import { palette } from "@/lib/palette";

export default function ReportScreen() {
  const { engine, error } = useEngine();
  const [report, setReport] = useState<ErrorReport | null>(null);
  const [message, setMessage] = useState("");
  const [details, setDetails] = useState(false);
  const [approver, setApprover] = useState("");
  const [sessionState, setSessionState] = useState<SessionStatus | null>(null);

  const load = useCallback(() => {
    if (!engine) return;
    engine.sessionStatus().then(setSessionState).catch(() => undefined);
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

  const [exporting, setExporting] = useState(false);
  const [saved, setSaved] = useState("");

  async function save(kind: ExportKind) {
    if (!engine || exporting) return;
    setExporting(true);
    setSaved("");
    setMessage("");
    try {
      const result = await exportReport(engine, kind);
      setSaved(`حُفظ ملف ${exportLabel(kind)} «${result.name}» في ${result.folderLabel}.`);
    } catch (cause) {
      setMessage(`تعذر الحفظ: ${cause instanceof Error ? cause.message : "خطأ غير معروف"}`);
    } finally {
      setExporting(false);
    }
  }

  async function endSession() {
    if (!engine) return;
    try {
      await engine.endSession();
      setSaved("انتهت الجلسة. التقارير متاحة للاطلاع والتصدير؛ ابدأ جلسة جديدة من تبويب التدقيق.");
      load();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "تعذر إنهاء الجلسة.");
    }
  }

  async function approve() {
    if (!engine) return;
    try {
      await engine.approveSession(approver);
      setSaved("اعتُمد تقرير الجلسة وسُجّل التوقيع. احفظ ملف PDF للأرشفة.");
      load();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "تعذر الاعتماد.");
    }
  }

  async function changeFolder() {
    if (!engine) return;
    try {
      if (await pickExportFolder(engine)) setSaved("حُدد مجلد التصدير الجديد.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "تعذر اختيار المجلد.");
    }
  }

  const wrongTotal = report?.wrong.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const overTotal = report?.over.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const empty = !!report && wrongTotal === 0 && overTotal === 0 && report.shortages.length === 0 && report.unknown.length === 0;

  return (
    <Screen>
      <Header title="تقرير الأخطاء" subtitle={report ? `حتى ${formatDateTime(report.generatedAt)}` : "أخطاء المسح والنواقص"} />
      {error || message ? <Notice title="يلزم الانتباه" body={error || message} tone="danger" /> : null}
      {saved ? <Notice title="تم الحفظ" body={saved} tone="success" /> : null}
      {report ? (
        <>
          {report.totals ? (
            <Card>
              <SectionTitle title="إجماليات الجلسة" hint={report.sessionId ? `الجلسة ${report.sessionId}` : undefined} />
              <View style={styles.metrics}>
                <Metric label="دقة المطابقة" value={`${report.totals.accuracy}%`} icon="target" accent={report.totals.accuracy >= 99 ? palette.tealDeep : palette.amber} />
                <Metric label="فواتير مطابقة" value={`${report.totals.matchedInvoices}/${report.totals.invoices}`} icon="check-decagram-outline" accent={palette.tealDeep} />
                <Metric label="فواتير بفروقات" value={String(report.totals.varianceInvoices)} icon="alert-decagram-outline" accent={report.totals.varianceInvoices ? palette.amber : palette.tealDeep} />
                <Metric label="الممسوح / المطلوب" value={`${report.totals.scannedUnits}/${report.totals.requiredUnits}`} icon="barcode-scan" />
                <Metric label="عجز (قطعة)" value={String(report.totals.shortUnits)} icon="minus-circle-outline" accent={report.totals.shortUnits ? palette.red : palette.tealDeep} />
                <Metric label="زيادة (قطعة)" value={String(report.totals.overUnits)} icon="plus-circle-outline" accent={report.totals.overUnits ? palette.amber : palette.tealDeep} />
              </View>
              <ProgressBar percent={report.totals.accuracy} color={palette.teal} />
              <Text style={styles.empty}>العجز والزيادة يُحسبان لكل صنف على حدة؛ زيادة صنف لا تعوّض عجز صنف آخر.</Text>
            </Card>
          ) : null}
          <Card>
            <SectionTitle title="اعتماد التقرير" hint="مرة واحدة بعد انتهاء كل الفواتير" />
            {report.approval ? (
              <>
                <Notice title="تقرير معتمد" body={`اعتُمد بواسطة ${report.approval.name} في ${formatDateTime(report.approval.at)}.`} tone="success" />
                {sessionState?.status === "active" ? <Button title="إنهاء الجلسة" icon="flag-checkered" variant="danger" onPress={() => void endSession()} /> : sessionState?.status === "ended" ? <Notice title="الجلسة منتهية" body="التقارير للاطلاع والتصدير. تبدأ جلسة جديدة من تبويب التدقيق." tone="info" /> : null}
              </>
            ) : report.stats.remaining > 0 ? (
              <Notice title="لم تنتهِ الجلسة" body={`متبقٍ ${report.stats.remaining} فاتورة؛ يُفتح الاعتماد بعد انتهاء جميعها.`} tone="info" />
            ) : (
              <>
                <TextInput value={approver} onChangeText={setApprover} placeholder="اسم المعتمِد" placeholderTextColor={palette.muted} style={styles.input} />
                <Button title="اعتماد وتوقيع التقرير" icon="draw" variant="success" onPress={() => void approve()} disabled={!approver.trim()} />
              </>
            )}
          </Card>
          {!report.approval ? <Notice title="التقارير التفصيلية مقفلة" body="الاطلاع على التفاصيل وطباعة التقارير وتصديرها يُفتح بعد اعتماد تقرير الجلسة." tone="warning" icon="lock-outline" /> : (
          <>
          <View style={styles.metrics}>
            <Metric label="أخطاء تجهيز" value={String(wrongTotal)} icon="close-octagon-outline" accent={wrongTotal ? palette.red : palette.tealDeep} />
            <Metric label="تجهيز زائد" value={String(overTotal)} icon="plus-circle-outline" accent={overTotal ? palette.amber : palette.tealDeep} />
            <Metric label="أصناف ناقصة مرحّلة" value={String(report.shortages.length)} icon="package-variant-closed-remove" accent={report.shortages.length ? palette.amber : palette.tealDeep} />
          </View>
          <View style={styles.actions}>
            <View style={styles.action}><Button title="طباعة التقرير" icon="printer-outline" onPress={print} /></View>
            <View style={styles.action}><Button title="مشاركة كنص" icon="share-variant-outline" variant="outline" onPress={share} /></View>
            <View style={styles.action}><Button title="حفظ Excel" icon="file-excel-outline" variant="outline" onPress={() => void save("xlsx")} disabled={exporting} /></View>
            <View style={styles.action}><Button title="حفظ PDF" icon="file-pdf-box" variant="outline" onPress={() => void save("pdf")} disabled={exporting} /></View>
            <View style={styles.action}><Button title="حفظ CSV (الأخطاء)" icon="file-delimited-outline" variant="outline" onPress={() => void save("csv")} disabled={exporting} /></View>
            <View style={styles.action}><Button title="حفظ CSV (الفواتير)" icon="file-delimited-outline" variant="outline" onPress={() => void save("invoices-csv")} disabled={exporting} /></View>
            <View style={styles.action}><Button title="مجلد الحفظ" icon="folder-cog-outline" variant="outline" onPress={() => void changeFolder()} disabled={exporting} /></View>
            <View style={styles.action}><Button title="تحديث" icon="refresh" variant="outline" onPress={load} /></View>
          </View>
          {empty ? <Card><EmptyState icon="check-decagram-outline" title="لا توجد أخطاء" body="لم تُسجَّل أخطاء تجهيز أو تجهيز زائد أو نواقص حتى الآن." /></Card> : null}

          <Button title={details ? "إخفاء التفاصيل" : "عرض التفاصيل"} icon={details ? "chevron-up" : "chevron-down"} variant="outline" onPress={() => setDetails((v) => !v)} />
          {details ? (
          <>
          <Section title="أخطاء التجهيز" hint="كود ليس من أصناف الفاتورة" empty="لا توجد أخطاء تجهيز." rows={report.wrong.map((r) => `طلب ${r.orderNo} • فاتورة ${r.invoices || "—"} • كود ${r.code} × ${r.count}${r.operator ? ` • ${r.operator}` : ""}`)} color={palette.red} />
          <Section title="التجهيز الزائد" hint="مسح أكثر من الكمية المسجلة" empty="لا يوجد تجهيز زائد." rows={report.over.map((r) => `طلب ${r.orderNo} • كود ${r.code} • مطلوب ${r.expected} وممسوح ${r.scanned}`)} color={palette.amber} />
          <Section title="النواقص في الفواتير المرحّلة" hint="أصناف تحتاج استكمالاً" empty="لا توجد نواقص." rows={report.shortages.map((r) => `طلب ${r.orderNo} • كود ${r.code} • ناقص ${r.expected - r.scanned} من ${r.expected}`)} color={palette.amber} />
          <Section title="مسحات غير مرتبطة بفاتورة" hint="رقم طلب غير موجود أو كود بلا فاتورة مفتوحة" empty="لا توجد مسحات غير مرتبطة." rows={report.unknown.map((r) => `${r.code} • ${formatDateTime(r.at)}`)} color={palette.muted} />
          <Section title="سجل الطباعة الصامتة" hint="حالة طباعة الفاتورة والبوليصة لكل طلب منتهٍ" empty="لم تُنفَّذ مهام طباعة." rows={report.printLog.map((r) => `طلب ${r.orderNo} • ${PRINT_KIND_LABELS[r.kind]}: ${PRINT_STATUS_LABELS[r.status]}${r.detail ? ` — ${r.detail}` : ""}`)} color={palette.blue} />
          </>
          ) : null}
          </>
          )}
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
  row: { color: palette.text, fontSize: 15, textAlign: "right", borderRightWidth: 3, paddingRight: 10, paddingVertical: 4 },
  input: { borderWidth: 1, borderColor: palette.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: palette.text, textAlign: "right", backgroundColor: palette.surface },
  empty: { color: palette.muted, fontSize: 15, textAlign: "right" },
});
