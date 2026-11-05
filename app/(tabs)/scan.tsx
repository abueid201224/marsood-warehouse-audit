import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Button, Card, EmptyState, Header, Metric, Notice, ProgressBar, Screen, SectionTitle, StatusBadge } from "@/components/MarsoodUI";
import { ScannerInput } from "@/components/ScannerInput";
import { itemState, type InvoiceView, type ItemRow, type ScanKind, type ScanResult } from "@/lib/core/engine";
import { STATUS_LABELS, formatClock } from "@/lib/core/format";
import { useEngine } from "@/lib/core/hooks";
import { palette } from "@/lib/palette";

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
      if (result.kind === "ok") return { tone: "success", title: `تم مسح ${result.code}`, body: `الممسوح ${result.scanned} من ${result.qty}` };
      if (result.kind === "over") return { tone: "warning", title: "تجهيز زائد", body: `الكود ${result.code}: الممسوح ${result.scanned} والمطلوب ${result.qty}. سُجّل في تقرير الأخطاء.` };
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
      return { tone: "danger", title: "رقم الطلب غير موجود", body: `الكود ${result.code} ليس رقم طلب في البيانات المستوردة، وأكواد الأصناف لا تتجاوز 10 خانات.` };
    case "no-invoice":
      return { tone: "warning", title: "امسح رقم الطلب أولاً", body: `لا توجد فاتورة مفتوحة، والكود ${result.code} ليس رقم طلب معروفاً.` };
    case "locked":
      return { tone: "warning", title: "الفاتورة منتهية", body: `لا يمكن مسح ${result.code} على فاتورة مغلقة. امسح بوليصة أخرى.` };
  }
}

function buzz(result: ScanResult) {
  const kind =
    result.type === "item"
      ? result.kind === "ok" ? Haptics.NotificationFeedbackType.Success : result.kind === "over" ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Error
      : result.type === "order-opened" || result.type === "same-order" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error;
  Haptics.notificationAsync(kind).catch(() => undefined);
}

const ITEM_BADGE = {
  pending: { state: "neutral", label: "لم يُمسح" },
  partial: { state: "warning", label: "ناقص" },
  done: { state: "good", label: "مكتمل" },
  over: { state: "bad", label: "زائد" },
} as const;
const KIND_LABEL: Record<ScanKind, string> = { ok: "مقبول", over: "تجهيز زائد", wrong: "خطأ تجهيز", unknown: "غير مرتبط" };
const KIND_COLOR: Record<ScanKind, string> = { ok: palette.tealDeep, over: palette.amber, wrong: palette.red, unknown: palette.muted };

export default function ScanScreen() {
  const { engine, error } = useEngine();
  const [focused, setFocused] = useState(false);
  const [view, setView] = useState<View_ | null>(null);
  const [recent, setRecent] = useState<Recent>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!engine) return;
    const key = await engine.getCurrent();
    if (!key) {
      setView(null);
      setRecent([]);
      return;
    }
    const data = await engine.getInvoice(key);
    setView(data);
    setRecent(data ? await engine.recentScans(key) : []);
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
        buzz(result);
        await refresh();
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
        const no = result.orderNo ?? "";
        setFeedback({
          tone: result.outcome === "closed" ? "success" : "warning",
          title: result.outcome === "closed" ? "أُنهيت الفاتورة" : "رُحِّلت الفاتورة",
          body: `${result.outcome === "closed" ? `أُقفلت الفاتورة ${no}.` : `رُحِّلت الفاتورة ${no} لاستكمال النواقص.`} امسح بوليصة الفاتورة التالية.`,
        });
      }
      await refresh();
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
      <ScannerInput onScan={onScan} disabled={!focused || !engine} />
      {feedback ? <Notice title={feedback.title} body={feedback.body} tone={tone} /> : null}

      {!invoice ? (
        <Card>
          <EmptyState icon="barcode-scan" title="لا توجد فاتورة مفتوحة" body="امسح رقم الطلب المطبوع على البوليصة لفتح فاتورته، ثم امسح أصنافها واحداً واحداً." />
        </Card>
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
                <Button title="إغلاق العرض" icon="close" variant="outline" onPress={() => finish("close")} disabled={busy} />
              </>
            ) : (
              <View style={styles.actions}>
                <View style={styles.action}>
                  <Button title="إنهاء الفاتورة" icon="check-circle-outline" onPress={() => finish("close")} disabled={busy || invoice.short_items > 0} />
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

          <Card>
            <SectionTitle title="أصناف الفاتورة" hint="غير المكتملة أولاً" />
            <View style={styles.tableHead}>
              <Text style={[styles.th, { flex: 1.2 }]}>الحالة</Text>
              <Text style={[styles.th, { flex: 0.7 }]}>الممسوح</Text>
              <Text style={[styles.th, { flex: 0.7 }]}>المطلوب</Text>
              <Text style={[styles.th, { flex: 0.8 }]}>الوحدة</Text>
              <Text style={[styles.th, { flex: 1.4 }]}>كود الصنف</Text>
            </View>
            {view?.items.map((item) => {
              const badge = ITEM_BADGE[itemState(item)];
              return (
                <View key={item.item_key} style={styles.tr}>
                  <View style={{ flex: 1.2 }}><StatusBadge state={badge.state} label={badge.label} /></View>
                  <Text style={[styles.td, { flex: 0.7, fontWeight: "900" }]}>{item.scanned}</Text>
                  <Text style={[styles.td, { flex: 0.7 }]}>{item.qty}</Text>
                  <Text style={[styles.td, { flex: 0.8 }]} numberOfLines={1}>{item.unit ?? "—"}</Text>
                  <Text style={[styles.td, { flex: 1.4, fontWeight: "800" }]} selectable>{item.item_code}</Text>
                </View>
              );
            })}
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
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  invoiceHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  orderNo: { color: palette.ink, fontSize: 20, fontWeight: "900", textAlign: "right" },
  invoiceNo: { color: palette.muted, fontSize: 13, textAlign: "right", marginTop: 3 },
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
