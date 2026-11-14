import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Button, Card, Header, Notice, Screen, SectionTitle } from "@/components/MarsoodUI";
import type { PrintConfig } from "@/lib/core/engine";
import { useEngine } from "@/lib/core/hooks";
import { palette } from "@/lib/palette";
import { AdminPanel } from "@/components/AdminPanel";
import { SourceSheet } from "@/components/SourceSheet";
import { ensureStorageAccess } from "@/lib/access";
import { addPdfFiles, clearPdfIndex, chooseFolderAndIndex, inspectPrinter, kickPrintQueue, reindexNow, sendTestPage } from "@/lib/print/runtime";
import { folderLabel } from "@/lib/print/names";
import { usePrintSummary } from "@/lib/print/hooks";

type Tone = "info" | "success" | "danger" | "warning";

export default function SettingsScreen() {
  const { engine, error } = useEngine();
  const { summary, reload } = usePrintSummary(engine);
  const [session, setSession] = useState(engine?.getSession() ?? null);
  useEffect(() => {
    if (!engine) return;
    setSession(engine.getSession());
    return engine.subscribeSession(() => setSession(engine.getSession()));
  }, [engine]);
  const [config, setConfig] = useState<PrintConfig | null>(null);
  const [counts, setCounts] = useState<{ invoices: number; labels: number } | null>(null);
  const [invoicePrinter, setInvoicePrinter] = useState("");
  const [labelPrinter, setLabelPrinter] = useState("");
  const [note, setNote] = useState<{ tone: Tone; title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | "files">(null);

  const load = useCallback(() => {
    if (!engine) return;
    Promise.all([engine.getPrintConfig(), engine.printIndexCounts()])
      .then(([cfg, idx]) => {
        setConfig(cfg);
        setCounts(idx);
        setInvoicePrinter(cfg.invoicePrinter ?? "");
        setLabelPrinter(cfg.labelPrinter ?? "");
      })
      .catch((cause: unknown) => setNote({ tone: "danger", title: "تعذر قراءة الإعدادات", body: cause instanceof Error ? cause.message : "" }));
  }, [engine]);
  useFocusEffect(load);

  async function run(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } catch (cause) {
      setNote({ tone: "danger", title: "تعذر التنفيذ", body: cause instanceof Error ? cause.message : "خطأ غير متوقع." });
    } finally {
      setBusy(false);
    }
  }

  const toggle = (value: boolean) =>
    run(async () => {
      await engine?.setSetting("print_enabled", value ? "1" : "0");
      setConfig((c) => (c ? { ...c, enabled: value } : c));
      setNote({ tone: value ? "success" : "warning", title: value ? "الطباعة التلقائية مفعّلة" : "الطباعة التلقائية معطّلة", body: value ? "ستبدأ مهمتا طباعة الفاتورة والبوليصة عند إنهاء كل طلب." : "لن تُطبع المستندات في هذه الجلسة. يمكنك إعادة الطباعة يدوياً من شاشة المسح." });
    });

  const saveBasics = () =>
    run(async () => {
      if (!engine) return;
      await engine.setSetting("printer_invoice", invoicePrinter.trim());
      await engine.setSetting("printer_label", labelPrinter.trim());
      setNote({ tone: "success", title: "تم الحفظ", body: "حُفظت إعدادات الطابعات." });
      load();
    });

  const pickFolder = () =>
    run(async () => {
      if (!engine) return;
      const result = await chooseFolderAndIndex(engine);
      if (!result) return setNote({ tone: "info", title: "لم يُختر مجلد", body: "لم يتغير شيء." });
      setNote({ tone: result.invoices + result.labels > 0 ? "success" : "warning", title: "تمت تهيئة قاعدة بيانات الفواتير", body: `عُثر على ${result.invoices} فاتورة (_b_Invoice.pdf) و${result.labels} بوليصة (_c_Label.pdf).${result.invoices + result.labels === 0 ? " تأكد أن الملفات داخل المجلد المختار مباشرة وبالصيغة المطلوبة." : ""}` });
      load();
    });

  const addFiles = () =>
    run(async () => {
      if (!engine) return;
      setSheet(null);
      const access = await ensureStorageAccess();
      const result = await addPdfFiles(engine);
      if (!result) return setNote({ tone: "info", title: "لم تُختر ملفات", body: "لم يتغير شيء." });
      const problems = [result.ignored ? `${result.ignored} ملف لا يطابق الصيغة (_b_Invoice.pdf / _c_Label.pdf) فتُجوهل.` : "", result.failed.length ? `تعذر نسخ ${result.failed.length} ملف: ${result.failed[0]}` : "", access === "denied" ? "لم يُمنح إذن التخزين العام، لكن الملفات المختارة قُرئت عبر منتقي النظام." : ""].filter(Boolean).join(" ");
      setNote({ tone: result.added > 0 && !result.failed.length ? "success" : "warning", title: `أُضيف ${result.added} ملف إلى قاعدة الفواتير`, body: `الإجمالي المفهرس: ${result.invoices} فاتورة و${result.labels} بوليصة. ${problems}` });
      load();
    });

  const clearIndex = () =>
    run(async () => {
      if (!engine) return;
      await clearPdfIndex(engine);
      setNote({ tone: "info", title: "مُسح الفهرس", body: "حُذفت الملفات المنسوخة وفهرس PDF. المجلد المختار لم يُمس." });
      load();
    });

  const reindex = () =>
    run(async () => {
      if (!engine) return;
      const result = await reindexNow(engine);
      setNote({ tone: "success", title: "اكتملت إعادة الفهرسة", body: result ? `${result.invoices} فاتورة و${result.labels} بوليصة.` : "اختر مجلداً أولاً." });
      load();
    });

  const testConnection = (url: string, label: string) =>
    run(async () => {
      if (!url.trim()) return setNote({ tone: "warning", title: "أدخل عنوان الطابعة", body: `عنوان طابعة ${label} فارغ.` });
      const info = await inspectPrinter(url.trim());
      setNote({
        tone: info.pdfSupported ? "success" : "warning",
        title: `${label}: ${info.name || info.model || "طابعة"} — ${info.state}`,
        body: info.pdfSupported ? `الطابعة تقبل ملفات PDF مباشرة.${info.stateReasons.length ? ` تنبيهات: ${info.stateReasons.join("، ")}` : ""}` : "الطابعة لا تعلن دعم PDF المباشر؛ قد لا تعمل الطباعة الصامتة معها. استخدم طابعة تدعم IPP وPDF.",
      });
    });

  const testPage = (url: string, label: string) =>
    run(async () => {
      if (!url.trim()) return setNote({ tone: "warning", title: "أدخل عنوان الطابعة", body: `عنوان طابعة ${label} فارغ.` });
      await sendTestPage(url.trim(), label);
      setNote({ tone: "success", title: "أُرسلت صفحة الاختبار", body: `تحقق من خروجها من طابعة ${label}.` });
    });

  const retry = () =>
    run(async () => {
      if (!engine) return;
      const n = await engine.retryPrints();
      kickPrintQueue(engine);
      reload();
      setNote({ tone: "info", title: "أُعيدت المحاولة", body: `${n} مهمة أُعيدت إلى الطابور.` });
    });

  const enabled = config?.enabled ?? true;

  return (
    <Screen>
      <Header title="الإعدادات" subtitle="المشغّل والطباعة الصامتة وقاعدة بيانات ملفات PDF" />
      {error ? <Notice title="تعذر فتح قاعدة البيانات" body={error} tone="danger" /> : null}
      {note ? <Notice title={note.title} body={note.body} tone={note.tone} /> : null}

      <View style={styles.grid}>
      <Card style={styles.cell}>
        <SectionTitle title="الطباعة التلقائية" hint="عند إنهاء كل طلب تبدأ مهمتان منفصلتان: الفاتورة ثم البوليصة" />
        <View style={styles.switchRow}>
          <Switch value={enabled} onValueChange={toggle} disabled={busy || !engine} trackColor={{ true: palette.teal, false: palette.line }} accessibilityLabel="تفعيل الطباعة التلقائية" />
          <Text style={[styles.switchText, { color: enabled ? palette.tealDeep : palette.red }]}>{enabled ? "مفعّلة" : "معطّلة لهذه الجلسة"}</Text>
        </View>
        {summary ? (
          <Text style={styles.line}>
            بانتظار: {summary.pending + summary.printing} • طُبعت: {summary.done} • فشلت: {summary.failed} • ملف غير موجود: {summary.missing}
          </Text>
        ) : null}
        <Button title="إعادة محاولة الفاشل والمفقود" icon="printer-alert" variant="outline" onPress={retry} disabled={busy || !summary || summary.failed + summary.missing === 0} />
      </Card>

      <Card style={styles.cell}>
        <SectionTitle title="قاعدة بيانات الفواتير (PDF)" hint="المجلد الذي يحوي «رقم الطلب_b_Invoice.pdf» و«رقم الطلب_c_Label.pdf»" />
        <Text style={styles.line} selectable>{config?.folder ? `المجلد: ${folderLabel(config.folder)}` : "لم يُختر مجلد بعد."}</Text>
        {counts ? <Text style={styles.line}>المفهرس: {counts.invoices} فاتورة • {counts.labels} بوليصة</Text> : null}
        <View style={styles.actions}>
          <View style={styles.action}><Button title="اختيار المجلد وتهيئة الفهرس" icon="folder-search-outline" onPress={pickFolder} disabled={busy} /></View>
          <View style={styles.action}><Button title="إضافة ملفات PDF (Drive / OneDrive / الجهاز)" icon="cloud-download-outline" variant="outline" onPress={() => setSheet("files")} disabled={busy} /></View>
          <View style={styles.action}><Button title="مسح الفهرس" icon="delete-outline" variant="outline" onPress={clearIndex} disabled={busy || !counts || counts.invoices + counts.labels === 0} /></View>
          <View style={styles.action}><Button title="إعادة الفهرسة" icon="refresh" variant="outline" onPress={reindex} disabled={busy || !config?.folder} /></View>
        </View>
        <Text style={styles.hint}>يُبحث بنفس الرقم الممسوح (رقم الطلب أو الفاتورة) مع تجاهل الأصفار البادئة. المجلد يُقرأ دون المجلدات الفرعية.</Text>
      </Card>

      <Card style={styles.cell}>
        <SectionTitle title="الطابعات الشبكية (IPP)" hint="عنوان الطابعة مثل 192.168.1.50 أو ipp://192.168.1.50/ipp/print" />
        <Text style={styles.label}>طابعة الفواتير</Text>
        <TextInput value={invoicePrinter} onChangeText={setInvoicePrinter} placeholder="192.168.1.50" placeholderTextColor={palette.subtle} style={styles.input} autoCapitalize="none" autoCorrect={false} keyboardType="url" textAlign="left" />
        <View style={styles.actions}>
          <View style={styles.action}><Button title="اختبار الاتصال" icon="lan-connect" variant="outline" compact onPress={() => testConnection(invoicePrinter, "الفواتير")} disabled={busy} /></View>
          <View style={styles.action}><Button title="صفحة اختبار" icon="file-send-outline" variant="outline" compact onPress={() => testPage(invoicePrinter, "الفواتير")} disabled={busy} /></View>
        </View>
        <Text style={styles.label}>طابعة البوليصات</Text>
        <TextInput value={labelPrinter} onChangeText={setLabelPrinter} placeholder="192.168.1.51" placeholderTextColor={palette.subtle} style={styles.input} autoCapitalize="none" autoCorrect={false} keyboardType="url" textAlign="left" />
        <View style={styles.actions}>
          <View style={styles.action}><Button title="اختبار الاتصال" icon="lan-connect" variant="outline" compact onPress={() => testConnection(labelPrinter, "البوليصات")} disabled={busy} /></View>
          <View style={styles.action}><Button title="صفحة اختبار" icon="file-send-outline" variant="outline" compact onPress={() => testPage(labelPrinter, "البوليصات")} disabled={busy} /></View>
        </View>
        <Button title="حفظ الإعدادات" icon="content-save-outline" onPress={saveBasics} disabled={busy || !engine} />
        <Text style={styles.hint}>الطباعة الصامتة تعمل مع الطابعات التي تدعم IPP واستلام PDF مباشرة، والجهاز على الشبكة المحلية نفسها.</Text>
      </Card>

      {engine && session ? <AdminPanel engine={engine} session={session} /> : null}
      </View>
      <SourceSheet visible={sheet === "files"} kind="pdf" onConfirm={addFiles} onCancel={() => setSheet(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 16, alignItems: "flex-start" },
  cell: { flexGrow: 1, flexShrink: 1, flexBasis: 360, minWidth: 0 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  switchText: { fontSize: 16, fontWeight: "900" },
  line: { color: palette.inkSoft, fontSize: 13, textAlign: "right" },
  hint: { color: palette.muted, fontSize: 12, textAlign: "right" },
  label: { color: palette.ink, fontSize: 13, fontWeight: "800", textAlign: "right" },
  input: { borderWidth: 1, borderColor: palette.line, backgroundColor: palette.white, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: palette.ink, fontSize: 15 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  action: { flexGrow: 1, minWidth: 160 },
});
