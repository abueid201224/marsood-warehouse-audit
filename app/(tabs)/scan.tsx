import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Switch } from "react-native";
import { StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { backupQuietly } from "@/lib/backup/files";
import { Button, Card, EmptyState, Header, Metric, Notice, ProgressBar, Screen, SectionTitle, StatusBadge } from "@/components/MarsoodUI";
import { CameraScanner } from "@/components/CameraScanner";
import { PrintAlert } from "@/components/PrintAlert";
import { ScannerInput } from "@/components/ScannerInput";
import { ItemsTable, type ErrorCode } from "@/components/ItemsTable";
import { applyPrefs, planForFinish, planForScan, type FeedbackPlan } from "@/lib/feedback";
import { runHaptic } from "@/lib/haptics";
import { playAlert } from "@/lib/sound";
import { Modal } from "react-native";
import { type InvoiceView, type ItemRow, type ScanKind, type ScanResult, type SessionTotals, type Stats } from "@/lib/core/engine";
import { codeKey } from "@/lib/core/codes";
import { STATUS_LABELS, formatClock } from "@/lib/core/format";
import { useEngine } from "@/lib/core/hooks";
import { palette } from "@/lib/palette";
import { useLayout } from "@/lib/layout";
import { usePrintSummary } from "@/lib/print/hooks";
import { kickPrintQueue } from "@/lib/print/runtime";
import { PRINT_KIND_LABELS, PRINT_STATUS_LABELS } from "@/lib/core/format";
import type { PrintLogRow } from "@/lib/core/engine";

type Tone = "info" | "warning" | "danger" | "success";
interface Feedback {
  tone: Tone;
  title: string;
  body: string;
}
interface View_ {
  invoice: InvoiceView;
  items: ItemRow[];
}
type Recent = Array<{ id: number; code: string; kind: ScanKind; at: string }>;

const OUTCOME_TEXT = {
  closed: (no: string) => `أُقفلت الفاتورة ${no} لاكتمالها.`,
  posted: (no: string, short: number) => `رُحِّلت الفاتورة ${no} بنواقص (${short} صنف) لاستكمالها لاحقاً.`,
  released: (no: string) => `أُعيدت الفاتورة ${no} إلى «لم تبدأ» لعدم مسح أي صنف.`,
} as const;

function describe(result: ScanResult): Feedback | null {
  switch (result.type) {
    case "empty":
      return null;
    case "item":
      if (result.kind === "ok") return { tone: "success", title: `تم مسح ${result.code}`, body: `${result.desc ? `${result.desc}\n` : ""}الممسوح ${result.scanned} من ${result.qty}` };
      if (result.kind === "over") return { tone: "warning", title: "تجهيز زائد", body: `${result.desc ? `${result.desc}\n` : ""}الكود ${result.code}: الممسوح ${result.scanned} والمطلوب ${result.qty}. سُجّل في تقرير الأخطاء.` };
      return { tone: "danger", title: "خطأ تجهيز", body: `الكود ${result.code} غير موجود في هذه الفاتورة. سُجّل في تقرير الأخطاء.` };
    case "order-opened": {
      const left = result.left
        ? ` ${result.left.outcome === "closed" ? OUTCOME_TEXT.closed(result.left.orderNo) : result.left.outcome === "posted" ? OUTCOME_TEXT.posted(result.left.orderNo, result.left.shortItems) : OUTCOME_TEXT.released(result.left.orderNo)}`
        : "";
      if (result.readonly) return { tone: "info", title: `الطلب ${result.orderNo} منتهي`, body: `الفاتورة مكتملة سابقاً وتُعرض للقراءة فقط.${left}` };
      return { tone: "success", title: `فُتح الطلب ${result.orderNo}`, body: `${result.resumed ? "استُؤنفت المراجعة مع الاحتفاظ بما مُسح." : "امسح أصناف الفاتورة."}${left}` };
    }
    case "same-order":
      return { tone: "info", title: "هذه هي الفاتورة المفتوحة", body: "امسح أصنافها، أو امسح بوليصة أخرى للانتقال." };
    case "order-not-found":
      return { tone: "danger", title: "رقم الطلب غير موجود", body: `تنبيه: الفاتورة ${result.code} غير مسجلة في جدول اليوم المستورد، ولا يُقبل مسحها. تأكد من استيراد ملف اليوم (أكواد الأصناف لا تتجاوز 10 خانات).` };
    case "not-today":
      return { tone: "danger", title: "فاتورة غير مسجلة لليوم", body: `الطلب ${result.orderNo} مسجل بتاريخ ${result.day} وليس في جدول اليوم، فلا يُقبل مسحه. استورد ملف اليوم أولاً.` };
    case "no-invoice":
      return { tone: "warning", title: "امسح رقم الطلب أولاً", body: `لا توجد فاتورة مفتوحة، والكود ${result.code} ليس رقم طلب معروفاً.` };
    case "blocked":
      return { tone: "danger", title: "أكمل الفاتورة الحالية أولاً", body: `لا يمكن بدء مسح جديد (${result.code}) قبل انتهاء الفاتورة ${result.orderNo} واكتمالها؛ ينقصها ${result.shortItems} صنف. أكمل مسحها أو رحّلها لاستكمال النواقص.` };
    case "confirm-switch":
      return { tone: "warning", title: "أكّد الانتقال لفاتورة جديدة", body: `الفاتورة ${result.currentNo} مفتوحة. امسح ${result.targetNo} مرة ثانية خلال ثانيتين لإغلاقها وبدء الجديدة.` };
    case "already-closed":
      return { tone: "warning", title: "فاتورة سبق مراجعتها", body: `الطلب ${result.orderNo} منتهي سابقاً. اختر إعادة فتحه أو التخطي.` };
    case "locked":
      return { tone: "warning", title: "الفاتورة منتهية", body: `لا يمكن مسح ${result.code} على فاتورة مغلقة. امسح بوليصة أخرى.` };
  }
}

const KIND_LABEL: Record<ScanKind, string> = { ok: "مقبول", over: "تجهيز زائد", wrong: "خطأ تجهيز", unknown: "غير مرتبط" };
const KIND_COLOR: Record<ScanKind, string> = { ok: palette.tealDeep, over: palette.amber, wrong: palette.red, unknown: palette.muted };

export default function ScanScreen() {
  const { engine, error } = useEngine();
  const { isWide } = useLayout();
  const [focused, setFocused] = useState(false);
  const [view, setView] = useState<View_ | null>(null);
  const [recent, setRecent] = useState<Recent>([]);
  const [camera, setCamera] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [printEnabled, setPrintEnabled] = useState(true);
  const [soundOn, setSoundOn] = useState(true);
  const [safeSwitch, setSafeSwitch] = useState(false);
  const [vibrationOn, setVibrationOn] = useState(true);
  const prefsRef = useRef({ sound: true, vibration: true });
  const [session, setSession] = useState<{ stats: Stats; totals: SessionTotals } | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [errorCodes, setErrorCodes] = useState<ErrorCode[]>([]);
  const [closedPrompt, setClosedPrompt] = useState<{ orderKey: string; orderNo: string } | null>(null);
  const [printRows, setPrintRows] = useState<PrintLogRow[]>([]);
  const { summary: printSummary, reload: reloadPrint } = usePrintSummary(engine);

  useEffect(() => {
    if (!engine) return;
    engine.getPrintConfig().then((cfg) => setPrintEnabled(cfg.enabled)).catch(() => undefined);
    engine.getSetting("sound_enabled").then((value) => setSoundOn(value !== "0")).catch(() => undefined);
    engine.getSetting("vibration_enabled").then((value) => setVibrationOn(value !== "0")).catch(() => undefined);
    engine.getSetting("safe_switch").then((value) => setSafeSwitch(value === "1")).catch(() => undefined);
  }, [engine, focused]);

  // تشغيل الطابور في الخلفية كلما وُجدت مهام منتظرة (الطباعة الصامتة لا تعطّل المسح)
  useEffect(() => {
    if (engine && (printSummary?.pending ?? 0) > 0) kickPrintQueue(engine);
  }, [engine, printSummary?.pending]);

  useEffect(() => {
    prefsRef.current = { sound: soundOn, vibration: vibrationOn };
  }, [soundOn, vibrationOn]);

  /** ينفّذ خطة التنبيه وفق تفضيلات الصوت والاهتزاز؛ الإخفاق لا يوقف المسح. */
  function emit(plan: FeedbackPlan) {
    const applied = applyPrefs(plan, prefsRef.current);
    if (applied.tone) playAlert(applied.tone).catch(() => undefined);
    if (applied.haptic) void runHaptic(applied.haptic);
  }

  async function toggleVibration() {
    if (!engine) return;
    const next = !vibrationOn;
    setVibrationOn(next);
    prefsRef.current = { ...prefsRef.current, vibration: next };
    await engine.setSetting("vibration_enabled", next ? "1" : "0");
    if (next) void runHaptic("double");
  }

  async function toggleSafeSwitch(value: boolean) {
    if (!engine) return;
    setSafeSwitch(value);
    await engine.setSetting("safe_switch", value ? "1" : "0");
    setFeedback(value
      ? { tone: "info", title: "وضع أمان التبديل مفعّل", body: "عند مسح فاتورة جديدة أثناء وجود فاتورة مفتوحة، امسحها مرتين خلال ثانيتين للتأكيد." }
      : { tone: "info", title: "وضع أمان التبديل معطّل", body: "مسح فاتورة جديدة يغلق الحالية فوراً (الوضع القياسي)." });
  }

  async function toggleSound() {
    if (!engine) return;
    const next = !soundOn;
    setSoundOn(next);
    await engine.setSetting("sound_enabled", next ? "1" : "0");
    if (next) playAlert("itemDone").catch(() => undefined);
  }

  async function reopenClosed() {
    if (!engine || !closedPrompt) return;
    const target = closedPrompt;
    setClosedPrompt(null);
    try {
      const result = await engine.reopenInvoice(target.orderKey);
      const next = describe(result);
      if (result.type === "order-opened") setFeedback({ tone: "success", title: `أُعيد فتح الطلب ${result.orderNo}`, body: "احتُفظ بالمسحات السابقة. امسح الأصناف أو عدّل الكميات." });
      else if (next) setFeedback(next);
      emit(planForScan(result));
      await refresh();
    } catch (cause) {
      setFeedback({ tone: "danger", title: "تعذرت إعادة الفتح", body: cause instanceof Error ? cause.message : "خطأ غير متوقع." });
    }
  }

  function skipClosed() {
    setFeedback({ tone: "info", title: "تم التخطي", body: `بقيت الفاتورة ${closedPrompt?.orderNo ?? ""} منتهية كما هي. تابع المسح.` });
    setClosedPrompt(null);
  }

  async function adjust(item: ItemRow, delta: 1 | -1) {
    if (!engine || !view || busy) return;
    const result = await engine.adjustItem(view.invoice.order_key, item.item_key, delta);
    if (!result.changed) setFeedback({ tone: "warning", title: "لم يتغير شيء", body: result.reason ?? "" });
    else if (result.scanned > result.qty) emit({ tone: "over", haptic: "warn" });
    await refresh();
  }

  async function togglePrint(value: boolean) {
    if (!engine) return;
    setPrintEnabled(value);
    await engine.setSetting("print_enabled", value ? "1" : "0");
    setFeedback(value ? { tone: "success", title: "الطباعة التلقائية مفعّلة", body: "ستُطبع فاتورة وبوليصة كل طلب عند إنهائه." } : { tone: "warning", title: "الطباعة التلقائية معطّلة", body: "لن تُطبع المستندات حتى تعيد تفعيلها." });
  }

  async function reprint() {
    if (!engine || !view) return;
    await engine.requeuePrint(view.invoice.order_key);
    kickPrintQueue(engine);
    reloadPrint();
    setFeedback({ tone: "info", title: "بدأت إعادة الطباعة", body: "أُضيفت مهمتا الفاتورة والبوليصة إلى طابور الطباعة." });
  }

  const refresh = useCallback(async () => {
    if (!engine) return;
    engine.sessionSummary().then(setSession).catch(() => undefined);
    const key = await engine.getCurrent();
    if (!key) {
      setView(null);
      setRecent([]);
      return;
    }
    // استعلامات مستقلة تُنفّذ معاً بدل التتابع بعد كل مسحة (أقل زمن استجابة للقارئ)
    const [data, scans, errs] = await Promise.all([engine.getInvoice(key), engine.recentScans(key), engine.invoiceErrors(key)]);
    setView(data);
    setErrorCodes(errs.map((e) => ({ code: e.code, count: e.count })));
    setRecent(data ? scans : []);
    if (data?.invoice.status === "closed") engine.printLog().then(setPrintRows).catch(() => undefined);
  }, [engine]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      refresh().catch(() => undefined);
      return () => setFocused(false);
    }, [refresh]),
  );

  const onScan = useCallback(
    async (code: string) => {
      if (!engine) return;
      try {
        const result = await engine.handleScan(code);
        const next = describe(result);
        if (next) setFeedback(next);
        if (result.type === "item" && result.kind !== "wrong") setLastKey(codeKey(result.code));
        else if (result.type === "order-opened") setLastKey(null);
        // اكتمال كل الفواتير يُستعلم عنه فقط عند إغلاق فاتورة تلقائياً (لا تأخير على مسح الأصناف)
        const closedNow = result.type === "order-opened" && result.left?.outcome === "closed";
        const complete = closedNow ? await engine.sessionSummary().then((v) => v.stats.total > 0 && v.stats.remaining === 0).catch(() => false) : false;
        emit(planForScan(result, { sessionComplete: complete }));
        if (result.type === "already-closed") setClosedPrompt({ orderKey: result.orderKey, orderNo: result.orderNo });
        await refresh();
        kickPrintQueue(engine);
      } catch (cause) {
        setFeedback({ tone: "danger", title: "تعذر تسجيل المسح", body: cause instanceof Error ? cause.message : "خطأ غير متوقع في قاعدة البيانات." });
      }
    },
    [engine, refresh],
  );

  async function finish(mode: "close" | "post") {
    if (!engine || busy) return;
    setBusy(true);
    try {
      const result = await engine.finishCurrent(mode);
      if (!result.ok) setFeedback({ tone: "warning", title: "لم يتم الإنهاء", body: result.reason ?? "" });
      else {
        const complete = result.outcome === "closed" ? await engine.sessionSummary().then((v) => v.stats.total > 0 && v.stats.remaining === 0).catch(() => false) : false;
        emit(planForFinish(result.outcome, { sessionComplete: complete }));
        const no = result.orderNo ?? "";
        setFeedback({
          tone: result.outcome === "closed" ? "success" : "warning",
          title: result.outcome === "closed" ? "أُنهيت الفاتورة" : "رُحِّلت الفاتورة",
          body: `${result.outcome === "closed" ? `أُقفلت الفاتورة ${no}.` : `رُحِّلت الفاتورة ${no} لاستكمال النواقص.`} امسح بوليصة الفاتورة التالية.`,
        });
      }
      await refresh();
      kickPrintQueue(engine);
      if (result.ok) backupQuietly(engine, "event");
    } catch (cause) {
      setFeedback({ tone: "danger", title: "تعذر الإنهاء", body: cause instanceof Error ? cause.message : "خطأ غير متوقع." });
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!engine || !view || busy) return;
    setBusy(true);
    try {
      const result = await engine.undoLastScan(view.invoice.order_key);
      setFeedback(result.removed ? { tone: "info", title: "تم التراجع", body: `أُلغيت آخر مسحة (${result.code}).` } : { tone: "info", title: "لا توجد مسحات", body: "لا شيء للتراجع عنه." });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const invoice = view?.invoice;
  const readonly = invoice?.status === "closed";
  const tone = feedback?.tone ?? "info";

  return (
    <Screen>
      <Header title="المسح" subtitle="امسح رقم الطلب من البوليصة ثم أصناف الفاتورة" />
      {error ? <Notice title="تعذر فتح قاعدة البيانات" body={error} tone="danger" /> : null}
      <View style={styles.modeRow}>
        <Pressable onPress={() => setCamera(false)} style={[styles.mode, !camera && styles.modeOn]} accessibilityRole="button">
          <MaterialCommunityIcons name="barcode-scan" size={18} color={!camera ? "#FFFFFF" : palette.tealDeep} />
          <Text style={[styles.modeText, !camera && { color: "#FFFFFF" }]}>قارئ الباركود</Text>
        </Pressable>
        <Pressable testID="mode-camera" onPress={() => setCamera(true)} style={[styles.mode, camera && styles.modeOn]} accessibilityRole="button">
          <MaterialCommunityIcons name="camera-outline" size={18} color={camera ? "#FFFFFF" : palette.tealDeep} />
          <Text style={[styles.modeText, camera && { color: "#FFFFFF" }]}>الكاميرا</Text>
        </Pressable>
      </View>
      {camera ? <CameraScanner onScan={onScan} active={focused && !!engine} /> : <ScannerInput onScan={onScan} disabled={!focused || !engine} />}
      <PrintAlert engine={engine} />
      <View style={styles.printBar}>
        <Switch value={printEnabled} onValueChange={togglePrint} trackColor={{ true: palette.teal, false: palette.line }} accessibilityLabel="الطباعة التلقائية" />
        <MaterialCommunityIcons name={printEnabled ? "printer-check" : "printer-off"} size={20} color={printEnabled ? palette.tealDeep : palette.red} />
        <Text style={[styles.printText, { color: printEnabled ? palette.tealDeep : palette.red }]}>
          {printEnabled ? "الطباعة التلقائية مفعّلة" : "الطباعة التلقائية معطّلة"}
          {printSummary && printSummary.pending + printSummary.printing > 0 ? ` • قيد الطباعة: ${printSummary.pending + printSummary.printing}` : ""}
          {printSummary && printSummary.failed + printSummary.missing > 0 ? ` • تحتاج انتباهاً: ${printSummary.failed + printSummary.missing}` : ""}
        </Text>
      </View>
      <Pressable onPress={toggleSound} accessibilityRole="switch" accessibilityState={{ checked: soundOn }} accessibilityLabel="التنبيهات الصوتية" style={styles.printBar}>
        <MaterialCommunityIcons name={soundOn ? "volume-high" : "volume-off"} size={22} color={soundOn ? palette.tealDeep : palette.muted} />
        <Text style={[styles.printText, { color: soundOn ? palette.tealDeep : palette.muted }]}>{soundOn ? "الأصوات: مفعّلة (نجاح وإتمام وتحذير)" : "الأصوات: صامتة"}</Text>
      </Pressable>
      <Pressable onPress={toggleVibration} accessibilityRole="switch" accessibilityState={{ checked: vibrationOn }} accessibilityLabel="الاهتزاز" style={styles.printBar}>
        <MaterialCommunityIcons name={vibrationOn ? "vibrate" : "vibrate-off"} size={22} color={vibrationOn ? palette.tealDeep : palette.muted} />
        <Text style={[styles.printText, { color: vibrationOn ? palette.tealDeep : palette.muted }]}>{vibrationOn ? "الاهتزاز: مفعّل" : "الاهتزاز: متوقف"}</Text>
      </Pressable>
      <View style={styles.printBar}>
        <Switch value={safeSwitch} onValueChange={toggleSafeSwitch} trackColor={{ true: palette.teal, false: palette.line }} accessibilityLabel="وضع أمان التبديل بين الفواتير" />
        <MaterialCommunityIcons name={safeSwitch ? "shield-check" : "shield-off-outline"} size={20} color={safeSwitch ? palette.tealDeep : palette.muted} />
        <Text style={[styles.printText, { color: safeSwitch ? palette.tealDeep : palette.muted }]}>{safeSwitch ? "أمان التبديل: مسح مزدوج للفاتورة الجديدة" : "أمان التبديل: معطّل (انتقال فوري)"}</Text>
      </View>
      {feedback ? <Notice title={feedback.title} body={feedback.body} tone={tone} /> : null}

      {session && session.stats.total > 0 ? (
        <Card>
          <View style={styles.sessionRow}>
            <View style={styles.sessionBig}>
              <Text style={styles.sessionPercent}>{session.totals.accuracy}%</Text>
              <Text style={styles.sessionLabel}>إنجاز الجلسة</Text>
            </View>
            <View style={styles.sessionCell}><Text style={styles.sessionNum}>{session.stats.closed}/{session.stats.total}</Text><Text style={styles.sessionLabel}>فواتير منتهية</Text></View>
            <View style={styles.sessionCell}><Text style={[styles.sessionNum, session.stats.remaining === 0 && { color: palette.tealDeep }]}>{session.stats.remaining}</Text><Text style={styles.sessionLabel}>متبقية</Text></View>
            <View style={styles.sessionCell}><Text style={styles.sessionNum}>{session.totals.acceptedUnits}/{session.totals.requiredUnits}</Text><Text style={styles.sessionLabel}>الكميات</Text></View>
          </View>
          <ProgressBar percent={session.totals.accuracy} color={session.stats.remaining === 0 ? palette.tealDeep : palette.teal} />
          {session.stats.remaining === 0 ? <Notice title="اكتملت كل فواتير الجلسة" body="افتح تبويب التقرير لمراجعة الإجماليات واعتماد التقرير وتوقيعه." tone="success" /> : null}
        </Card>
      ) : null}

      {!invoice ? (
        <Card>
          <EmptyState icon="barcode-scan" title="لا توجد فاتورة مفتوحة" body="امسح رقم الطلب المطبوع على البوليصة لفتح فاتورته، ثم امسح أصنافها واحداً واحداً." />
        </Card>
      ) : (
        isWide ? (
          <View style={styles.panes}>
            <View style={styles.paneSide}>
          <Card>
            <View style={styles.invoiceHead}>
              <StatusBadge state={invoice.status === "closed" ? "good" : invoice.status === "posted" ? "warning" : "neutral"} label={STATUS_LABELS[invoice.status]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.orderNo} selectable>طلب {invoice.order_no}</Text>
                <Text style={styles.invoiceNo} selectable>الفاتورة: {invoice.invoices ?? "—"}</Text>
              </View>
              <Text style={styles.percent}>{invoice.progress}%</Text>
            </View>
            <ProgressBar percent={invoice.progress} color={invoice.short_items === 0 ? palette.teal : palette.amber} />
            <Text style={styles.progressText}>
              {invoice.done_qty} من {invoice.total_qty} وحدة • {invoice.done_items} من {invoice.item_count} صنف مكتمل
            </Text>
            <View style={styles.metricRow}>
              <Metric label="نواقص" value={String(invoice.short_items)} icon="package-variant-closed-remove" accent={invoice.short_items ? palette.amber : palette.tealDeep} />
              <Metric label="أخطاء تجهيز" value={String(invoice.wrong_scans)} icon="close-octagon-outline" accent={invoice.wrong_scans ? palette.red : palette.tealDeep} />
              <Metric label="تجهيز زائد" value={String(invoice.over_scans)} icon="plus-circle-outline" accent={invoice.over_scans ? palette.amber : palette.tealDeep} />
            </View>
            {readonly ? (
              <>
                <Notice title="فاتورة منتهية" body="تُعرض للقراءة فقط ولا تقبل مسحاً جديداً." tone="info" />
                {printRows.filter((r) => r.orderNo === invoice.order_no).map((r) => (
                  <Text key={r.kind} style={styles.printRow}>
                    {PRINT_KIND_LABELS[r.kind]}: {PRINT_STATUS_LABELS[r.status]}{r.detail ? ` — ${r.detail}` : ""}
                  </Text>
                ))}
                <Button title="إعادة طباعة الفاتورة والبوليصة" icon="printer-outline" variant="secondary" onPress={reprint} disabled={busy} />
                <Button title="إغلاق العرض" icon="close" variant="outline" onPress={() => finish("close")} disabled={busy} />
              </>
            ) : (
              <View style={styles.actions}>
                <View style={styles.action}>
                  <Button title="إنهاء الفاتورة" icon="check-circle-outline" variant={invoice.short_items === 0 ? "success" : "outline"} onPress={() => finish("close")} disabled={busy} />
                </View>
                <View style={styles.action}>
                  <Button title="ترحيل لاستكمال النواقص" icon="arrow-right-bold-box-outline" variant="secondary" onPress={() => finish("post")} disabled={busy || invoice.short_items === 0} />
                </View>
                <View style={styles.action}>
                  <Button title="تراجع عن آخر مسح" icon="undo" variant="outline" onPress={undo} disabled={busy || recent.length === 0} />
                </View>
              </View>
            )}
          </Card>

          {recent.length > 0 ? (
            <Card>
              <SectionTitle title="آخر المسحات" />
              {recent.map((scan) => (
                <View key={scan.id} style={styles.recentRow}>
                  <MaterialCommunityIcons name={scan.kind === "ok" ? "check-circle-outline" : "alert-circle-outline"} size={18} color={KIND_COLOR[scan.kind]} />
                  <Text style={[styles.recentKind, { color: KIND_COLOR[scan.kind] }]}>{KIND_LABEL[scan.kind]}</Text>
                  <Text style={styles.recentCode} selectable>{scan.code}</Text>
                  <Text style={styles.recentTime}>{formatClock(scan.at)}</Text>
                </View>
              ))}
            </Card>
          ) : null}
            </View>
            <View style={styles.paneMain}>
              <ItemsTable items={view?.items ?? []} errors={errorCodes} readonly={!!readonly} onAdjust={adjust} lastKey={lastKey} />

            </View>
          </View>
        ) : (
          <>
          <Card>
            <View style={styles.invoiceHead}>
              <StatusBadge state={invoice.status === "closed" ? "good" : invoice.status === "posted" ? "warning" : "neutral"} label={STATUS_LABELS[invoice.status]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.orderNo} selectable>طلب {invoice.order_no}</Text>
                <Text style={styles.invoiceNo} selectable>الفاتورة: {invoice.invoices ?? "—"}</Text>
              </View>
              <Text style={styles.percent}>{invoice.progress}%</Text>
            </View>
            <ProgressBar percent={invoice.progress} color={invoice.short_items === 0 ? palette.teal : palette.amber} />
            <Text style={styles.progressText}>
              {invoice.done_qty} من {invoice.total_qty} وحدة • {invoice.done_items} من {invoice.item_count} صنف مكتمل
            </Text>
            <View style={styles.metricRow}>
              <Metric label="نواقص" value={String(invoice.short_items)} icon="package-variant-closed-remove" accent={invoice.short_items ? palette.amber : palette.tealDeep} />
              <Metric label="أخطاء تجهيز" value={String(invoice.wrong_scans)} icon="close-octagon-outline" accent={invoice.wrong_scans ? palette.red : palette.tealDeep} />
              <Metric label="تجهيز زائد" value={String(invoice.over_scans)} icon="plus-circle-outline" accent={invoice.over_scans ? palette.amber : palette.tealDeep} />
            </View>
            {readonly ? (
              <>
                <Notice title="فاتورة منتهية" body="تُعرض للقراءة فقط ولا تقبل مسحاً جديداً." tone="info" />
                {printRows.filter((r) => r.orderNo === invoice.order_no).map((r) => (
                  <Text key={r.kind} style={styles.printRow}>
                    {PRINT_KIND_LABELS[r.kind]}: {PRINT_STATUS_LABELS[r.status]}{r.detail ? ` — ${r.detail}` : ""}
                  </Text>
                ))}
                <Button title="إعادة طباعة الفاتورة والبوليصة" icon="printer-outline" variant="secondary" onPress={reprint} disabled={busy} />
                <Button title="إغلاق العرض" icon="close" variant="outline" onPress={() => finish("close")} disabled={busy} />
              </>
            ) : (
              <View style={styles.actions}>
                <View style={styles.action}>
                  <Button title="إنهاء الفاتورة" icon="check-circle-outline" variant={invoice.short_items === 0 ? "success" : "outline"} onPress={() => finish("close")} disabled={busy} />
                </View>
                <View style={styles.action}>
                  <Button title="ترحيل لاستكمال النواقص" icon="arrow-right-bold-box-outline" variant="secondary" onPress={() => finish("post")} disabled={busy || invoice.short_items === 0} />
                </View>
                <View style={styles.action}>
                  <Button title="تراجع عن آخر مسح" icon="undo" variant="outline" onPress={undo} disabled={busy || recent.length === 0} />
                </View>
              </View>
            )}
          </Card>

              <ItemsTable items={view?.items ?? []} errors={errorCodes} readonly={!!readonly} onAdjust={adjust} lastKey={lastKey} />

          {recent.length > 0 ? (
            <Card>
              <SectionTitle title="آخر المسحات" />
              {recent.map((scan) => (
                <View key={scan.id} style={styles.recentRow}>
                  <MaterialCommunityIcons name={scan.kind === "ok" ? "check-circle-outline" : "alert-circle-outline"} size={18} color={KIND_COLOR[scan.kind]} />
                  <Text style={[styles.recentKind, { color: KIND_COLOR[scan.kind] }]}>{KIND_LABEL[scan.kind]}</Text>
                  <Text style={styles.recentCode} selectable>{scan.code}</Text>
                  <Text style={styles.recentTime}>{formatClock(scan.at)}</Text>
                </View>
              ))}
            </Card>
          ) : null}
          </>
        )
      )}
      <Modal visible={!!closedPrompt} transparent animationType="fade" onRequestClose={skipClosed}>
        <View style={styles.shade}>
          <View style={styles.dialog}>
            <MaterialCommunityIcons name="alert-circle-outline" size={44} color={palette.amber} style={{ alignSelf: "center" }} />
            <Text style={styles.dialogTitle}>فاتورة سبق مراجعتها</Text>
            <Text style={styles.dialogBody}>الطلب {closedPrompt?.orderNo} مراجَع ومنتهٍ من قبل. هل تريد إعادة فتحه للمراجعة من جديد أم تخطيه؟</Text>
            <Button title="إعادة فتحها" icon="lock-open-outline" onPress={reopenClosed} />
            <Button title="تخطي" icon="skip-next" variant="outline" onPress={skipClosed} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  shade: { flex: 1, backgroundColor: "rgba(17,35,62,0.55)", justifyContent: "center", alignItems: "center", padding: 24 },
  dialog: { width: "100%", maxWidth: 480, backgroundColor: palette.surface, borderRadius: 22, padding: 22, gap: 12 },
  dialogTitle: { color: palette.ink, fontSize: 20, fontWeight: "900", textAlign: "center" },
  dialogBody: { color: palette.inkSoft, fontSize: 14, lineHeight: 22, textAlign: "center" },
  panes: { flexDirection: "row", gap: 16, alignItems: "flex-start" },
  paneSide: { flex: 2, gap: 16, minWidth: 0 },
  paneMain: { flex: 3, gap: 16, minWidth: 0 },
  modeRow: { flexDirection: "row", gap: 8 },
  mode: { flex: 1, minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, borderWidth: 1, borderColor: palette.tealDeep, backgroundColor: "#FFFFFF" },
  modeOn: { backgroundColor: palette.tealDeep },
  modeText: { color: palette.tealDeep, fontWeight: "800", fontSize: 14 },
  printBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4 },
  printText: { flex: 1, fontSize: 13, fontWeight: "800", textAlign: "right" },
  printRow: { color: palette.inkSoft, fontSize: 12, textAlign: "right" },
  invoiceHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  orderNo: { color: palette.ink, fontSize: 20, fontWeight: "900", textAlign: "right" },
  invoiceNo: { color: palette.muted, fontSize: 13, textAlign: "right", marginTop: 3 },
  sessionRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  sessionBig: { minWidth: 110, alignItems: "center" },
  sessionPercent: { color: palette.tealDeep, fontSize: 40, fontWeight: "900" },
  sessionCell: { flex: 1, minWidth: 80, alignItems: "center" },
  sessionNum: { color: palette.ink, fontSize: 24, fontWeight: "900" },
  sessionLabel: { color: palette.muted, fontSize: 12, fontWeight: "800" },
  percent: { color: palette.tealDeep, fontSize: 30, fontWeight: "900" },
  progressText: { color: palette.inkSoft, fontSize: 13, textAlign: "right" },
  metricRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  action: { flexGrow: 1, minWidth: 200 },
  tableHead: { flexDirection: "row", gap: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: palette.line },
  th: { color: palette.muted, fontSize: 12, fontWeight: "800", textAlign: "right" },
  tr: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: palette.line },
  td: { color: palette.text, fontSize: 15, textAlign: "right" },
  recentRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  recentKind: { fontSize: 12, fontWeight: "800", width: 82, textAlign: "right" },
  recentCode: { flex: 1, color: palette.text, fontSize: 14, textAlign: "right" },
  recentTime: { color: palette.muted, fontSize: 12 },
});
