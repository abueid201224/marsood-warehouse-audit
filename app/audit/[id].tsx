import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Button, Card, Header, Metric, Notice, Screen, SectionTitle, StatusBadge } from "@/components/MarsoodUI";
import { ScannerInput } from "@/components/ScannerInput";
import { adjustScannedQuantity, applyBarcodeScan, canCompleteSession, completeSession, getLineState, getSessionSummary, resolveAmbiguousScan, resolveException, type AuditException, type AuditItem, type AuditSession } from "@/lib/domain/audit";
import { parseLocalizedQuantity } from "@/lib/import/spreadsheet";
import { auditRepository } from "@/lib/storage/repository";
import { palette } from "@/lib/palette";

type Filter = "all" | "remaining" | "mismatch" | "matched";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "كل البنود" },
  { key: "remaining", label: "لم تكتمل" },
  { key: "mismatch", label: "فروقات" },
  { key: "matched", label: "مطابقة" },
];

function qty(value: number) {
  return new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 2 }).format(value);
}
function time(value: string) {
  try { return new Intl.DateTimeFormat("ar-SA", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
  catch { return value; }
}
function lineLabel(item: AuditItem) {
  const state = getLineState(item);
  if (state === "matched") return { label: "مطابق", tone: "good" as const };
  if (state === "over") return { label: `زيادة ${qty(item.scannedQty - item.expectedQty)}`, tone: "bad" as const };
  return { label: `نقص ${qty(item.expectedQty - item.scannedQty)}`, tone: "warning" as const };
}

export default function AuditScreen() {
  const router = useRouter();
  const { id: rawId } = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const [session, setSession] = useState<AuditSession | null>(null);
  const sessionRef = useRef<AuditSession | null>(null);
  const mutationQueue = useRef<Promise<void>>(Promise.resolve());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; tone: "success" | "warning" | "danger" } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [ambiguous, setAmbiguous] = useState<{ exception: AuditException; candidates: AuditItem[] } | null>(null);
  const [resolveTarget, setResolveTarget] = useState<AuditException | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [adjustTarget, setAdjustTarget] = useState<AuditItem | null>(null);
  const [adjustValue, setAdjustValue] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!id) { setLoading(false); return; }
      try {
        const stored = await auditRepository.getSession(id);
        if (mounted) { sessionRef.current = stored ?? null; setSession(stored ?? null); }
      } catch (cause) {
        if (mounted) setError(cause instanceof Error ? cause.message : "تعذر فتح جلسة التدقيق.");
      } finally { if (mounted) setLoading(false); }
    }
    void load();
    return () => { mounted = false; };
  }, [id]);

  const summary = useMemo(() => session ? getSessionSummary(session) : null, [session]);
  const visibleItems = useMemo(() => {
    if (!session) return [];
    return session.items.filter((item) => {
      const state = getLineState(item);
      if (filter === "remaining") return item.scannedQty < item.expectedQty;
      if (filter === "mismatch") return state !== "matched";
      if (filter === "matched") return state === "matched";
      return true;
    });
  }, [session, filter]);

  const commit = useCallback(async (next: AuditSession) => {
    setSaving(true);
    try {
      await auditRepository.saveSession(next);
      sessionRef.current = next;
      setSession(next);
      setError("");
      return true;
    } catch (cause) {
      setError(`لم يُحفظ التغيير محلياً؛ لم يُعتمد: ${cause instanceof Error ? cause.message : "خطأ تخزين غير معروف"}`);
      return false;
    } finally { setSaving(false); }
  }, []);

  const enqueueMutation = useCallback((action: () => Promise<void>) => {
    const job = mutationQueue.current.then(action);
    mutationQueue.current = job.catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "تعذر تنفيذ تحديث جلسة التدقيق.");
    });
  }, []);

  const onScan = useCallback((code: string) => {
    enqueueMutation(async () => {
      const current = sessionRef.current;
      if (!current || current.state === "complete") return;
      setFeedback(null);
      const outcome = applyBarcodeScan(current, code);
      if (outcome.kind === "empty") return;
      const saved = await commit(outcome.session);
      if (!saved) return;
      if (outcome.kind === "unknown") {
        setFeedback({ text: `باركود غير موجود في الفاتورة: ${outcome.exception.barcode}`, tone: "danger" });
      } else if (outcome.kind === "ambiguous") {
        setFeedback({ text: "الباركود متكرر في الفاتورة؛ اختر السطر قبل احتساب الوحدة.", tone: "warning" });
        setAmbiguous({ exception: outcome.exception, candidates: outcome.candidates });
      } else if (outcome.kind === "recorded" && outcome.overage) {
        setFeedback({ text: `تم تسجيل المسح، لكن الكمية أصبحت أعلى من المتوقع للصنف ${outcome.item.description || outcome.item.barcode}.`, tone: "danger" });
      } else if (outcome.kind === "recorded") {
        setFeedback({ text: `تم تسجيل وحدة واحدة للصنف ${outcome.item.description || outcome.item.barcode}.`, tone: "success" });
      }
    });
  }, [commit, enqueueMutation]);

  function chooseAmbiguous(candidateId: string) {
    const exceptionId = ambiguous?.exception.id;
    if (!exceptionId) return;
    enqueueMutation(async () => {
      const current = sessionRef.current;
      if (!current) return;
      const next = resolveAmbiguousScan(current, exceptionId, candidateId);
      if (next === current) { setError("تعذر العثور على استثناء الباركود أو السطر المحدد."); return; }
      if (await commit(next)) {
        setAmbiguous(null);
        setFeedback({ text: "تم اختيار السطر وتسجيل مسح واحد.", tone: "success" });
      }
    });
  }

  function saveResolution() {
    const exceptionId = resolveTarget?.id;
    const note = resolveNote;
    if (!exceptionId || !note.trim()) { setError("اكتب ملاحظة القرار قبل اعتماده."); return; }
    enqueueMutation(async () => {
      const current = sessionRef.current;
      if (!current) return;
      const next = resolveException(current, exceptionId, note);
      if (next === current) { setError("تعذر العثور على الاستثناء المفتوح."); return; }
      if (await commit(next)) { setResolveTarget(null); setResolveNote(""); }
    });
  }

  function saveAdjustment() {
    const itemId = adjustTarget?.id;
    const quantity = parseLocalizedQuantity(adjustValue);
    const reason = adjustReason;
    if (!itemId) return;
    if (quantity === undefined) { setError("أدخل كمية رقمية صحيحة غير سالبة."); return; }
    enqueueMutation(async () => {
      const current = sessionRef.current;
      if (!current) return;
      const result = adjustScannedQuantity(current, itemId, quantity, reason);
      if (result.error || !result.session) { setError(result.error ?? "تعذر حفظ التعديل."); return; }
      if (await commit(result.session)) {
        setAdjustTarget(null); setAdjustValue(""); setAdjustReason("");
        setFeedback({ text: "حُفظ تعديل الكمية في سجل المراجعة.", tone: "warning" });
      }
    });
  }

  function closeSession() {
    enqueueMutation(async () => {
      const current = sessionRef.current;
      if (!current) return;
      const next = completeSession(current);
      if (next.state !== "complete") { setConfirmClose(false); setError("لا يمكن إقفال الفاتورة قبل مطابقة جميع البنود وحسم الاستثناءات."); return; }
      if (await commit(next)) { setConfirmClose(false); setFeedback({ text: "أُقفلت جلسة التدقيق بعد المطابقة الكاملة.", tone: "success" }); }
    });
  }

  if (loading) return <Screen><Header title="جلسة التدقيق" subtitle="جارٍ تحميل البيانات المحلية" /></Screen>;
  if (!session || !summary) return <Screen><Header title="الجلسة غير متاحة" subtitle="تعذر العثور على بيانات هذه الفاتورة" /><Notice title="لا توجد جلسة" body={error || "قد تكون الجلسة حُذفت أو لم يكتمل حفظها."} tone="danger" /><Button title="العودة إلى الفواتير" icon="arrow-right" onPress={() => router.replace("/(tabs)/sessions")} /></Screen>;

  return (
    <Screen>
      <Header title={`فاتورة ${session.invoiceNumber}`} subtitle={`${session.sourceFileName} • ${session.items.length} بند`} right={<Pressable onPress={() => router.back()} style={styles.back}><MaterialCommunityIcons name="arrow-right" size={19} color={palette.ink} /><Text style={styles.backText}>رجوع</Text></Pressable>} />
      {session.state === "complete" ? <Notice title="جلسة مقفلة" body="تمت المطابقة الكاملة. تبقى بيانات الجلسة محفوظة محلياً." tone="success" /> : null}
      {error ? <Notice title="تعذر الحفظ أو الإجراء" body={error} tone="danger" /> : null}
      {feedback ? <Notice title={feedback.tone === "success" ? "تم التسجيل" : feedback.tone === "warning" ? "يحتاج اختياراً" : "تنبيه تدقيق"} body={feedback.text} tone={feedback.tone} /> : null}
      <View style={styles.metrics}>
        <Metric label="بنود مطابقة" value={`${summary.matchedLines}/${summary.lineCount}`} icon="check-circle-outline" accent={palette.teal} />
        <Metric label="المتوقع" value={qty(summary.expectedUnits)} icon="package-variant-closed" accent={palette.blue} />
        <Metric label="الممسوح" value={qty(summary.scannedUnits)} icon="barcode-scan" accent={palette.ink} />
      </View>

      {session.state !== "complete" ? (
        <Card style={styles.scannerCard}>
          <View style={styles.scannerHeading}><View style={{ flex: 1 }}><Text style={styles.scannerTitle}>امسح الصنف التالي</Text><Text style={styles.scannerSub}>المسح الواحد يضيف وحدة واحدة؛ راجع الفرق بعد كل قراءة.</Text></View><View style={styles.scannerIcon}><MaterialCommunityIcons name="line-scan" size={24} color={palette.tealDeep} /></View></View>
          <ScannerInput onScan={onScan} disabled={!!ambiguous || !!resolveTarget || !!adjustTarget || confirmClose} />
          {saving ? <Text style={styles.saving}>جارٍ حفظ آخر تغيير على الجهاز…</Text> : null}
        </Card>
      ) : null}

      {summary.openExceptions > 0 ? (
        <View style={styles.exceptionBlock}>
          <SectionTitle title="استثناءات تحتاج قراراً" hint="لا تُحذف المخالفة؛ وثّق سبب الإجراء البشري" />
          {session.exceptions.filter((exception) => exception.state === "open").map((exception) => (
            <View key={exception.id} style={styles.exceptionRow}>
              <MaterialCommunityIcons name="alert-circle-outline" size={22} color={exception.kind === "overage" ? palette.red : palette.amber} />
              <View style={{ flex: 1 }}><Text style={styles.exceptionMessage}>{exception.message}</Text><Text style={styles.exceptionMeta}>{time(exception.createdAt)} • {exception.barcode}</Text></View>
              {exception.kind !== "ambiguous-barcode" ? <Button title="توثيق القرار" icon="text-box-check-outline" onPress={() => { setResolveTarget(exception); setResolveNote(""); }} compact variant="secondary" disabled={saving} /> : <Button title="اختر السطر" icon="format-list-checks" onPress={() => setAmbiguous({ exception, candidates: session.items.filter((item) => item.barcode === exception.barcode) })} compact variant="secondary" disabled={saving} />}
            </View>
          ))}
        </View>
      ) : null}

      <Card style={styles.linesCard}>
        <SectionTitle title="بنود الفاتورة" hint={`${visibleItems.length} بند معروض`} />
        <View style={styles.filters}>{FILTERS.map((item) => <Pressable key={item.key} onPress={() => setFilter(item.key)} style={[styles.filter, filter === item.key && styles.filterActive]}><Text style={[styles.filterText, filter === item.key && styles.filterTextActive]}>{item.label}</Text></Pressable>)}</View>
        {visibleItems.map((item) => {
          const badge = lineLabel(item);
          return (
            <View key={item.id} style={styles.lineCard}>
              <View style={styles.lineTop}><StatusBadge state={badge.tone} label={badge.label} /><Text style={styles.lineDescription}>{item.description || "صنف بدون وصف"}</Text></View>
              <Text style={styles.barcode}>{item.barcode}</Text>
              <View style={styles.quantityRow}>
                <View style={styles.quantityCell}><Text style={styles.quantityLabel}>متوقع</Text><Text style={styles.quantityValue}>{qty(item.expectedQty)}</Text></View>
                <MaterialCommunityIcons name="arrow-left" size={17} color={palette.subtle} />
                <View style={styles.quantityCell}><Text style={styles.quantityLabel}>ممسوح</Text><Text style={[styles.quantityValue, { color: item.scannedQty > item.expectedQty ? palette.red : palette.ink }]}>{qty(item.scannedQty)}</Text></View>
                <View style={styles.quantityCell}><Text style={styles.quantityLabel}>الفارق</Text><Text style={[styles.quantityValue, { color: item.scannedQty === item.expectedQty ? palette.teal : item.scannedQty > item.expectedQty ? palette.red : palette.amber }]}>{item.scannedQty - item.expectedQty > 0 ? "+" : ""}{qty(item.scannedQty - item.expectedQty)}</Text></View>
              </View>
              {session.state !== "complete" ? <Pressable onPress={() => { setAdjustTarget(item); setAdjustValue(String(item.scannedQty)); setAdjustReason(""); }} style={styles.adjustLink} disabled={saving}><MaterialCommunityIcons name="pencil-outline" size={16} color={palette.tealDeep} /><Text style={styles.adjustText}>تعديل يدوي مع سبب</Text></Pressable> : null}
            </View>
          );
        })}
      </Card>

      <Card>
        <SectionTitle title="سجل العمليات" hint="أحدث القراءات والتعديلات" />
        {session.events.length === 0 ? <Text style={styles.emptyLog}>لم يُسجل أي مسح بعد.</Text> : session.events.slice(-5).reverse().map((event) => (
          <View key={event.id} style={styles.eventRow}><Text style={styles.eventTime}>{time(event.at)}</Text><Text style={styles.eventDetails}>{event.kind === "scan" ? "مسح باركود" : event.kind === "unknown-scan" ? "باركود غير معروف" : `تعديل يدوي (${event.delta ?? 0})`} • {event.barcode}{event.note ? ` • ${event.note}` : ""}</Text></View>
        ))}
      </Card>

      {session.state !== "complete" ? (
        <Card style={styles.closeCard}>
          {canCompleteSession(session) ? <Notice title="كل البنود مطابقة" body="يمكنك إقفال جلسة التدقيق. سيبقى سجلها المحلي للرجوع إليه." tone="success" /> : <Notice title="لا يمكن الإقفال بعد" body={`${summary.shortLines} نقص • ${summary.overLines} زيادة • ${summary.openExceptions} استثناء مفتوح. طابق البنود ووثّق الاستثناءات أولاً.`} tone="warning" />}
          <Button title="مراجعة الإقفال النهائي" icon="lock-check-outline" onPress={() => setConfirmClose(true)} disabled={!canCompleteSession(session) || saving} />
        </Card>
      ) : null}

      <Modal visible={!!ambiguous} transparent animationType="fade" onRequestClose={() => setAmbiguous(null)}>
        <View style={styles.modalShade}><View style={styles.modalCard}><Text style={styles.modalTitle}>الباركود مكرر في الفاتورة</Text><Text style={styles.modalBody}>اختر السطر الصحيح؛ لن ندمج البنود المتكررة آلياً.</Text>{ambiguous?.candidates.map((candidate) => <Pressable key={candidate.id} onPress={() => { chooseAmbiguous(candidate.id); }} style={styles.candidate} disabled={saving}><Text style={styles.candidateQty}>{qty(candidate.scannedQty)} / {qty(candidate.expectedQty)}</Text><View style={{ flex: 1 }}><Text style={styles.candidateName}>{candidate.description || "صنف بدون وصف"}</Text><Text style={styles.candidateCode}>{candidate.barcode} • سطر المصدر {candidate.sourceRow}</Text></View><MaterialCommunityIcons name="chevron-left" size={20} color={palette.subtle} /></Pressable>)}<Button title="إلغاء المسح" variant="outline" onPress={() => setAmbiguous(null)} disabled={saving} /></View></View>
      </Modal>

      <Modal visible={!!resolveTarget} transparent animationType="fade" onRequestClose={() => setResolveTarget(null)}>
        <View style={styles.modalShade}><View style={styles.modalCard}><Text style={styles.modalTitle}>توثيق قرار المراجع</Text><Text style={styles.modalBody}>{resolveTarget?.message}</Text><TextInput value={resolveNote} onChangeText={setResolveNote} placeholder="اكتب سبب القبول أو الإجراء المتخذ" placeholderTextColor={palette.subtle} multiline style={styles.noteInput} textAlign="right" /><Button title="حفظ القرار" icon="content-save-check-outline" onPress={() => { void saveResolution(); }} disabled={!resolveNote.trim() || saving} /><Button title="إلغاء" variant="outline" onPress={() => setResolveTarget(null)} compact /></View></View>
      </Modal>

      <Modal visible={!!adjustTarget} transparent animationType="fade" onRequestClose={() => setAdjustTarget(null)}>
        <View style={styles.modalShade}><View style={styles.modalCard}><Text style={styles.modalTitle}>تعديل الكمية الممسوحة</Text><Text style={styles.modalBody}>{adjustTarget?.description || adjustTarget?.barcode}</Text><TextInput value={adjustValue} onChangeText={setAdjustValue} placeholder="الكمية الفعلية" keyboardType="decimal-pad" style={styles.noteInput} textAlign="center" /><TextInput value={adjustReason} onChangeText={setAdjustReason} placeholder="سبب التعديل مطلوب لسجل التدقيق" multiline style={styles.noteInput} textAlign="right" /><Button title="حفظ التعديل مع السبب" icon="content-save-check-outline" onPress={() => { void saveAdjustment(); }} disabled={!adjustReason.trim() || saving} /><Button title="إلغاء" variant="outline" onPress={() => setAdjustTarget(null)} compact /></View></View>
      </Modal>

      <Modal visible={confirmClose} transparent animationType="fade" onRequestClose={() => setConfirmClose(false)}>
        <View style={styles.modalShade}><View style={styles.modalCard}><Text style={styles.modalTitle}>إقفال جلسة التدقيق؟</Text><Text style={styles.modalBody}>ستتحول هذه الجلسة إلى حالة «مقفلة». لا يمكن تسجيل مسحات أخرى حتى إعادة فتحها في إصدار لاحق.</Text><Button title="تأكيد الإقفال" icon="lock-check-outline" onPress={() => { void closeSession(); }} disabled={!canCompleteSession(session) || saving} /><Button title="العودة للمراجعة" variant="outline" onPress={() => setConfirmClose(false)} /></View></View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: "row", gap: 3, alignItems: "center", padding: 7 },
  backText: { color: palette.ink, fontWeight: "800", fontSize: 12 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  scannerCard: { borderColor: "#B8DBD3", borderWidth: 1.5 },
  scannerHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  scannerTitle: { color: palette.ink, fontSize: 17, fontWeight: "900", textAlign: "right" },
  scannerSub: { color: palette.muted, fontSize: 12, lineHeight: 18, textAlign: "right", marginTop: 3 },
  scannerIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: palette.tealPale, alignItems: "center", justifyContent: "center" },
  saving: { color: palette.muted, fontSize: 11, textAlign: "right" },
  exceptionBlock: { gap: 10 },
  exceptionRow: { flexDirection: "row", alignItems: "center", gap: 9, padding: 13, borderWidth: 1, borderColor: "#F0DAB7", borderRadius: 15, backgroundColor: palette.amberPale },
  exceptionMessage: { color: palette.ink, fontSize: 12, lineHeight: 18, fontWeight: "800", textAlign: "right" },
  exceptionMeta: { color: palette.muted, fontSize: 10, textAlign: "right", marginTop: 3 },
  linesCard: { padding: 16 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  filter: { borderColor: palette.line, borderWidth: 1, borderRadius: 999, backgroundColor: palette.surfaceMuted, paddingHorizontal: 12, paddingVertical: 8 },
  filterActive: { backgroundColor: palette.ink, borderColor: palette.ink },
  filterText: { color: palette.inkSoft, fontSize: 11, fontWeight: "700" },
  filterTextActive: { color: palette.white },
  lineCard: { borderWidth: 1, borderColor: palette.line, borderRadius: 16, padding: 13, gap: 9, backgroundColor: palette.surfaceMuted },
  lineTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 7 },
  lineDescription: { flex: 1, color: palette.ink, fontSize: 14, fontWeight: "900", textAlign: "right" },
  barcode: { color: palette.inkSoft, fontSize: 13, fontWeight: "700", textAlign: "right", writingDirection: "ltr" },
  quantityRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 5, borderTopWidth: 1, borderTopColor: palette.line, paddingTop: 9 },
  quantityCell: { flex: 1, alignItems: "flex-end", gap: 3 },
  quantityLabel: { color: palette.muted, fontSize: 10 },
  quantityValue: { color: palette.ink, fontSize: 17, fontWeight: "900" },
  adjustLink: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingVertical: 3 },
  adjustText: { color: palette.tealDeep, fontSize: 11, fontWeight: "800" },
  emptyLog: { color: palette.muted, textAlign: "right", fontSize: 12 },
  eventRow: { flexDirection: "row", justifyContent: "space-between", gap: 10, borderTopWidth: 1, borderTopColor: palette.line, paddingVertical: 9 },
  eventTime: { color: palette.muted, fontSize: 10 },
  eventDetails: { flex: 1, color: palette.inkSoft, textAlign: "right", fontSize: 11, lineHeight: 18 },
  closeCard: { borderColor: "#C8DDD4" },
  modalShade: { flex: 1, backgroundColor: "rgba(17,35,62,0.52)", justifyContent: "center", alignItems: "center", padding: 22 },
  modalCard: { width: "100%", maxWidth: 540, borderRadius: 21, backgroundColor: palette.surface, padding: 19, gap: 13 },
  modalTitle: { color: palette.ink, fontSize: 18, fontWeight: "900", textAlign: "right" },
  modalBody: { color: palette.muted, fontSize: 13, lineHeight: 20, textAlign: "right" },
  candidate: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderWidth: 1, borderColor: palette.line, borderRadius: 14, backgroundColor: palette.surfaceMuted },
  candidateQty: { color: palette.tealDeep, fontSize: 12, fontWeight: "900" },
  candidateName: { color: palette.ink, fontSize: 13, fontWeight: "800", textAlign: "right" },
  candidateCode: { color: palette.muted, fontSize: 10, textAlign: "right", marginTop: 3 },
  noteInput: { borderWidth: 1, borderColor: palette.line, borderRadius: 13, minHeight: 48, maxHeight: 130, color: palette.text, paddingHorizontal: 12, paddingVertical: 11, fontSize: 13 },
});
