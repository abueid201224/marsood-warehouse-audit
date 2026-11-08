import { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as LegacyFileSystem from "expo-file-system/legacy";
import { File } from "expo-file-system";
import * as XLSX from "xlsx";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Card, Header, Notice, Screen, SectionTitle } from "@/components/MarsoodUI";
import { base64ToBytes } from "@/lib/core/base64";
import { codeKey } from "@/lib/core/codes";
import type { ImportSummary } from "@/lib/core/engine";
import { useEngine } from "@/lib/core/hooks";
import { FIELD_LABELS, FIELD_ORDER, inspectWorkbook, mapRows, type ColumnMap, type FieldKey, type SheetPreview } from "@/lib/core/importer";
import { palette } from "@/lib/palette";
import { SourceSheet } from "@/components/SourceSheet";
import { ensureStorageAccess } from "@/lib/access";
import { SYNC_FOLDER_KEY, SYNC_PROCESSED_KEY, listSyncFiles, pickSyncFolder } from "@/lib/sync/folder";
import { addProcessed, parseProcessed, pickNewestUnprocessed, syncSignature, type SyncFile } from "@/lib/sync/select";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const REQUIRED: FieldKey[] = ["order", "item", "qty"];

/** يقرأ الملف بأكثر من طريقة لأن سلوك مسارات Android (content:// و file://) يختلف بين الأجهزة. */
async function readBytes(uri: string): Promise<Uint8Array> {
  const failures: string[] = [];
  try {
    const base64 = await LegacyFileSystem.readAsStringAsync(uri, { encoding: LegacyFileSystem.EncodingType.Base64 });
    const bytes = base64ToBytes(base64);
    if (bytes.byteLength > 0) return bytes;
    failures.push("القراءة الأولى أعادت ملفاً فارغاً");
  } catch (cause) {
    failures.push(cause instanceof Error ? cause.message : String(cause));
  }
  try {
    const buffer = await new File(uri).arrayBuffer();
    if (buffer.byteLength > 0) return new Uint8Array(buffer);
    failures.push("القراءة الثانية أعادت ملفاً فارغاً");
  } catch (cause) {
    failures.push(cause instanceof Error ? cause.message : String(cause));
  }
  try {
    const response = await fetch(uri);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > 0) return new Uint8Array(buffer);
    failures.push("القراءة الثالثة أعادت ملفاً فارغاً");
  } catch (cause) {
    failures.push(cause instanceof Error ? cause.message : String(cause));
  }
  throw new Error(`تعذرت قراءة الملف من الجهاز. (${failures.join(" | ")})`);
}

/** زر مستقل بألوان صريحة وحدّ ظاهر دائماً (لا يعتمد على ألوان الأزرار المشتركة). */
function ActionButton({ title, icon, onPress, disabled, solid = true, testID }: { title: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; onPress: () => void; disabled?: boolean; solid?: boolean; testID?: string }) {
  const bg = solid ? "#0B3B4A" : "#FFFFFF";
  const fg = solid ? "#FFFFFF" : "#0B3B4A";
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={{ alignSelf: "stretch", minHeight: 52, borderRadius: 14, borderWidth: 2, borderColor: "#0B3B4A", backgroundColor: bg, opacity: disabled ? 0.5 : 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 16 }}
    >
      <MaterialCommunityIcons name={icon} size={22} color={fg} />
      <Text style={{ color: fg, fontSize: 16, fontWeight: "800", textAlign: "center" }}>{title}</Text>
    </Pressable>
  );
}

function ColumnSelect({ label, required, value, headers, onChange }: { label: string; required: boolean; value: number | null; headers: string[]; onChange: (value: number | null) => void }) {
  const [visible, setVisible] = useState(false);
  const missing = required && value === null;
  return (
    <>
      <Pressable onPress={() => setVisible(true)} style={[styles.columnSelect, missing && { borderColor: palette.red }]} accessibilityRole="button">
        <MaterialCommunityIcons name="chevron-down" size={19} color={palette.muted} />
        <View style={{ flex: 1 }}>
          <Text style={styles.columnLabel}>{label}{required ? " *" : ""}</Text>
          <Text style={[styles.columnValue, missing && { color: palette.red }]}>{value === null ? (required ? "اختر العمود" : "غير مستخدم") : headers[value] ?? `عمود ${value + 1}`}</Text>
        </View>
      </Pressable>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <View style={styles.modalShade}>
          <View style={styles.pickerModal}>
            <Text style={styles.modalTitle}>اختر عمود «{label}»</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {!required ? (
                <Pressable onPress={() => { onChange(null); setVisible(false); }} style={styles.optionRow}>
                  <Text style={styles.optionText}>غير مستخدم</Text>
                </Pressable>
              ) : null}
              {headers.map((header, index) => (
                <Pressable key={`${index}-${header}`} onPress={() => { onChange(index); setVisible(false); }} style={styles.optionRow}>
                  <Text style={styles.optionText}>{header}</Text>
                  <Text style={styles.optionIndex}>{index + 1}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Button title="إغلاق" variant="outline" onPress={() => setVisible(false)} compact />
          </View>
        </View>
      </Modal>
    </>
  );
}

export default function ImportScreen() {
  const router = useRouter();
  const { engine, error: engineError } = useEngine();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [sheet, setSheet] = useState(false);
  const [status, setStatus] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [syncFiles, setSyncFiles] = useState<SyncFile[]>([]);
  const [processed, setProcessed] = useState<string[]>([]);
  const [currentSig, setCurrentSig] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState("");

  useEffect(() => {
    if (!engine) return;
    let alive = true;
    (async () => {
      const [savedFolder, savedProcessed] = await Promise.all([engine.getSetting(SYNC_FOLDER_KEY), engine.getSetting(SYNC_PROCESSED_KEY)]);
      if (!alive) return;
      setFolder(savedFolder || null);
      setProcessed(parseProcessed(savedProcessed));
      setLastSync((await engine.getSetting("sync:last")) ?? "");
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [engine]);

  const parsed = useMemo(() => (preview && map ? mapRows(preview, map) : null), [preview, map]);
  const stats = useMemo(() => {
    if (!parsed) return null;
    const invoicesByOrder = new Map<string, Set<string>>();
    for (const row of parsed.rows) {
      const key = codeKey(row.orderNo);
      const set = invoicesByOrder.get(key) ?? new Set<string>();
      if (row.invoiceNo) set.add(row.invoiceNo);
      invoicesByOrder.set(key, set);
    }
    return { orders: invoicesByOrder.size, multiInvoice: Array.from(invoicesByOrder.values()).filter((set) => set.size > 1).length };
  }, [parsed]);

  function reset() {
    setError(""); setFileName(""); setBytes(null); setPreview(null); setMap(null); setSummary(null);
  }

  async function chooseFile() {
    setSheet(false);
    setError(""); setSummary(null);
    setBusy(true);
    setStatus("جارٍ فتح منتقي الملفات…");
    try {
      const access = await ensureStorageAccess();
      if (access === "denied") setError("لم يُمنح إذن التخزين العام؛ سيُفتح منتقي النظام ويمكنك اختيار الملف منه مباشرة.");
      setStatus("اختر الملف من المنتقي…");
      const picked = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: false });
      if (picked.canceled || !picked.assets?.[0]) return;
      setStatus("جارٍ نسخ الملف وقراءته…");
      const asset = picked.assets[0];
      const ext = asset.name.split(".").pop()?.toLowerCase() ?? "";
      const mime = (asset.mimeType ?? "").toLowerCase();
      const known = ["xlsx", "xls", "csv", "txt"].includes(ext) || /spreadsheet|excel|csv|text\/plain/.test(mime);
      // ملفات Drive/OneDrive قد تصل بلا امتداد أو بنوع عام: نحكم بمحتوى الملف لا باسمه
      const rejected = ["pdf", "jpg", "jpeg", "png", "doc", "docx", "zip"].includes(ext) && !known;
      if (rejected) {
        setError("صيغة الملف غير مدعومة. اختر ملف Excel (XLSX أو XLS) أو CSV. ملفات Google Sheets الأصلية: احفظها من Drive بصيغة Excel أولاً.");
        return;
      }
      if (asset.size && asset.size > MAX_FILE_BYTES) {
        setError("حجم الملف أكبر من 25 ميغابايت. قسّم الملف إلى أجزاء.");
        return;
      }
      const data = await readBytes(asset.uri);
      loadWorkbook(data, asset.name, known);
      setCurrentSig(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر قراءة الملف المحدد.");
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  function loadWorkbook(data: Uint8Array, name: string, known = true) {
    if (data.byteLength > MAX_FILE_BYTES) throw new Error("حجم الملف أكبر من 25 ميغابايت.");
    let displayName = name;
    const looksBinary = (data[0] === 0x50 && data[1] === 0x4b) || (data[0] === 0xd0 && data[1] === 0xcf);
    if (!known && !looksBinary && data.byteLength > 0 && name.indexOf(".") === -1) displayName = `${name}.csv`;
    let next: SheetPreview;
    try {
      next = inspectWorkbook(XLSX, data, displayName);
    } catch (cause) {
      throw new Error(`تعذر تحليل الملف كجدول Excel: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    setFileName(displayName);
    setBytes(data);
    setPreview(next);
    setMap(next.columnMap);
  }

  async function chooseSyncFolder() {
    setError(""); setSummary(null);
    setBusy(true);
    setStatus("جارٍ فتح منتقي المجلدات…");
    try {
      const uri = await pickSyncFolder();
      if (!uri) return;
      await engine?.setSetting(SYNC_FOLDER_KEY, uri);
      setFolder(uri);
      await syncNow(uri);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر فتح المجلد.");
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  async function openSyncFile(file: SyncFile) {
    setError(""); setSummary(null);
    setBusy(true);
    setStatus(`جارٍ قراءة ${file.name}…`);
    try {
      const data = await readBytes(file.uri);
      loadWorkbook(data, file.name);
      setCurrentSig(syncSignature(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر قراءة الملف.");
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  /** مزامنة: يسرد المجلد ويفتح أحدث ملف لم يُستورد بعد. */
  async function syncNow(target: string | null = folder) {
    if (!target) { await chooseSyncFolder(); return; }
    setError(""); setSummary(null);
    setBusy(true);
    setStatus("جارٍ فحص مجلد المزامنة…");
    try {
      const files = await listSyncFiles(target);
      setSyncFiles(files);
      if (files.length === 0) {
        setError("لا توجد ملفات Excel أو CSV في المجلد المختار. تأكد أن المزامنة اليومية وضعت الملف فيه، أو اختر مجلداً آخر.");
        return;
      }
      const fresh = pickNewestUnprocessed(files, new Set(processed));
      if (!fresh) {
        setStatus("");
        setError("لا توجد ملفات جديدة: كل ملفات المجلد مستوردة سابقاً. اضغط على ملف من القائمة لإعادة فتحه عند الحاجة.");
        return;
      }
      setStatus(`جارٍ قراءة ${fresh.name}…`);
      const data = await readBytes(fresh.uri);
      loadWorkbook(data, fresh.name);
      setCurrentSig(syncSignature(fresh));
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(`تعذرت المزامنة: ${text}. إن تغير المجلد أو انتهى إذنه فاضغط «تغيير المجلد».`);
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  function changeSheet(index: number) {
    if (!bytes || !fileName) return;
    try {
      const next = inspectWorkbook(XLSX, bytes, fileName, index);
      setPreview(next);
      setMap(next.columnMap);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر قراءة ورقة العمل.");
    }
  }

  async function doImport() {
    if (!engine || !parsed || parsed.rows.length === 0) return;
    setBusy(true); setError("");
    try {
      setSummary(await engine.importRows(parsed.rows, fileName));
      if (currentSig) {
        const next = addProcessed(processed, currentSig);
        setProcessed(next);
        await engine.setSetting(SYNC_PROCESSED_KEY, JSON.stringify(next)).catch(() => undefined);
        const stamp = new Date().toLocaleString("ar-SA");
        setLastSync(stamp);
        await engine.setSetting("sync:last", stamp).catch(() => undefined);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حفظ البيانات في قاعدة البيانات المحلية.");
    } finally {
      setBusy(false);
    }
  }

  const missingRequired = map ? REQUIRED.filter((key) => map[key] === null) : [];

  return (
    <Screen>
      <Header title="استيراد جدول الفواتير" subtitle="ملف Excel بخمسة أعمدة: رقم الطلب، رقم الفاتورة، كود الصنف، الوحدة، الكمية" right={<Pressable onPress={() => router.back()} style={styles.backButton}><MaterialCommunityIcons name="arrow-right" size={20} color={palette.ink} /><Text style={styles.backText}>رجوع</Text></Pressable>} />
      {status ? <Notice title="جارٍ العمل" body={status} tone="info" /> : null}
      {error || engineError ? <Notice title="يلزم الانتباه" body={error || engineError} tone="danger" /> : null}

      {summary ? (
        <Card>
          <Notice
            title="تم الاستيراد"
            body={`أُضيف ${summary.orders} طلب (${summary.inserted} سطر).${summary.replaced ? ` استُبدل ${summary.replaced} طلب موجود لم تبدأ مراجعته.` : ""}${summary.skippedOrders.length ? ` تُخطي ${summary.skippedOrders.length} طلب بدأت مراجعته: ${summary.skippedOrders.slice(0, 5).join("، ")}${summary.skippedOrders.length > 5 ? "…" : ""}.` : ""}`}
            tone={summary.skippedOrders.length ? "warning" : "success"}
          />
          <Button title="بدء المسح" icon="barcode-scan" onPress={() => router.replace("/scan")} />
          <Button title="استيراد ملف آخر" icon="file-upload-outline" variant="outline" onPress={reset} />
        </Card>
      ) : null}

      {!fileName && !summary ? (
        <>
          <View style={styles.syncCard}>
            <View style={styles.pickIcon}><MaterialCommunityIcons name="folder-sync-outline" size={32} color={palette.tealDeep} /></View>
            <Text style={styles.pickTitle}>مزامنة المجلد اليومي</Text>
            <Text style={styles.pickBody}>
              {folder ? "المجلد محفوظ. اضغط «مزامنة الآن» ليُفتح أحدث ملف فواتير جديد في المجلد، ولا يُستورد الملف نفسه مرتين." : "اختر مرة واحدة المجلد الذي تضع فيه المزامنة اليومية ملف الفواتير (مثل مجلد OneDrive على الجهاز)."}
            </Text>
            {lastSync ? <Text style={styles.pickBody}>آخر استيراد من المجلد: {lastSync}</Text> : null}
            {folder ? <ActionButton testID="sync-now" title={busy ? "جارٍ العمل…" : "مزامنة الآن"} icon="sync" onPress={() => void syncNow()} disabled={busy} /> : null}
            <ActionButton testID="sync-folder" title={folder ? "تغيير المجلد" : "اختيار مجلد المزامنة"} icon="folder-open-outline" solid={!folder} onPress={() => void chooseSyncFolder()} disabled={busy} />
          </View>

          {syncFiles.length > 0 ? (
            <View style={styles.syncCard}>
              <Text style={styles.pickTitle}>ملفات المجلد (الأحدث أولاً)</Text>
              {syncFiles.slice(0, 12).map((file) => {
                const done = processed.includes(syncSignature(file));
                return (
                  <Pressable key={file.uri} onPress={() => void openSyncFile(file)} disabled={busy} style={styles.fileOption} accessibilityRole="button">
                    <Text style={[styles.fileState, done && { color: palette.muted }]}>{done ? "مستورد" : "جديد"}</Text>
                    <Text style={styles.fileOptionName} numberOfLines={1}>{file.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <View style={styles.syncCard}>
            <Text style={styles.pickTitle}>أو اختر ملفاً واحداً</Text>
            <Text style={styles.pickBody}>XLSX وXLS وCSV حتى 25 ميغابايت، من الجهاز أو Google Drive أو OneDrive. لا يغادر الملف هذا الجهاز.</Text>
            <ActionButton testID="pick-file" title={busy ? "جارٍ قراءة الملف…" : "تحديد ملف من الجهاز / Drive / OneDrive"} icon="file-excel-outline" solid={false} onPress={() => setSheet(true)} disabled={busy} />
          </View>
        </>
      ) : null}

      {preview && map && !summary ? (
        <>
          <Card>
            <View style={styles.fileRow}>
              <Pressable onPress={reset} accessibilityLabel="اختيار ملف آخر"><MaterialCommunityIcons name="close-circle-outline" size={24} color={palette.muted} /></Pressable>
              <View style={{ flex: 1 }}>
                <Text style={styles.fileTitle} numberOfLines={1}>{fileName}</Text>
                <Text style={styles.fileMeta}>{preview.rows.length} صف بيانات • {preview.sheetNames.length} ورقة</Text>
              </View>
            </View>
            {preview.sheetNames.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {preview.sheetNames.map((sheet, index) => (
                  <Pressable key={sheet} onPress={() => changeSheet(index)} style={[styles.sheetChip, preview.sheetIndex === index && styles.sheetActive]}>
                    <Text style={[styles.sheetText, preview.sheetIndex === index && styles.sheetTextActive]}>{sheet}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
          </Card>

          <Card>
            <SectionTitle title="ربط الأعمدة" hint={preview.positional ? "لم تُعرف العناوين؛ افتُرض الترتيب: الطلب، الفاتورة، الصنف، الوحدة، الكمية. عدّل عند اللزوم." : "عُرفت الأعمدة من العناوين؛ راجعها قبل الاستيراد."} />
            <View style={styles.columnsGrid}>
              {FIELD_ORDER.map((key) => (
                <ColumnSelect key={key} label={FIELD_LABELS[key]} required={REQUIRED.includes(key)} value={map[key]} headers={preview.headers} onChange={(value) => setMap((current) => (current ? { ...current, [key]: value } : current))} />
              ))}
            </View>
          </Card>

          {parsed ? (
            <Card>
              <SectionTitle title="معاينة قبل الاستيراد" />
              {missingRequired.length > 0 ? <Notice title="أعمدة ناقصة" body={`اختر: ${missingRequired.map((key) => FIELD_LABELS[key]).join("، ")}.`} tone="danger" /> : (
                <Notice title={`${parsed.rows.length} سطر صالح في ${stats?.orders ?? 0} طلب`} body={parsed.errors.length ? `سيُستبعد ${parsed.errors.length} سطر معيب (مبيّن أدناه) ويُستورد الباقي.` : "كل الأسطر صالحة."} tone={parsed.errors.length ? "warning" : "success"} />
              )}
              {stats && stats.multiInvoice > 0 ? <Notice title="طلبات بأكثر من فاتورة" body={`${stats.multiInvoice} طلب يحمل أكثر من رقم فاتورة؛ يُراجع كل طلب كفاتورة واحدة عند مسح بوليصته، ويقبل مسح رقم الفاتورة أيضاً.`} tone="info" /> : null}
              {parsed.rows.length > 0 ? (
                <View style={styles.previewTable}>
                  <View style={styles.previewHead}>
                    {["الطلب", "الفاتورة", "كود الصنف", "الوحدة", "الكمية"].map((title) => <Text key={title} style={[styles.previewCell, styles.previewHeadText]}>{title}</Text>)}
                  </View>
                  {parsed.rows.slice(0, 6).map((row) => (
                    <View key={row.sourceRow} style={styles.previewRow}>
                      <Text style={styles.previewCell} numberOfLines={1}>{row.orderNo}</Text>
                      <Text style={styles.previewCell} numberOfLines={1}>{row.invoiceNo || "—"}</Text>
                      <Text style={styles.previewCell} numberOfLines={1}>{row.itemCode}</Text>
                      <Text style={styles.previewCell} numberOfLines={1}>{row.unit || "—"}</Text>
                      <Text style={styles.previewCell}>{row.qty}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {parsed.errors.length > 0 ? (
                <View style={styles.errorsBox}>
                  <Text style={styles.errorsTitle}>أسطر مستبعدة ({parsed.errors.length})</Text>
                  {parsed.errors.slice(0, 8).map((row) => <Text key={`${row.sourceRow}-${row.message}`} style={styles.errorLine}>صف {row.sourceRow}: {row.message}</Text>)}
                  {parsed.errors.length > 8 ? <Text style={styles.errorLine}>و{parsed.errors.length - 8} أسطر أخرى…</Text> : null}
                </View>
              ) : null}
              <Button title={busy ? "جارٍ الحفظ…" : `استيراد ${parsed.rows.length} سطر`} icon="database-import-outline" onPress={doImport} disabled={busy || !engine || parsed.rows.length === 0 || missingRequired.length > 0} />
            </Card>
          ) : null}
        </>
      ) : null}
      <SourceSheet visible={sheet} kind="excel" onConfirm={chooseFile} onCancel={() => setSheet(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  backButton: { flexDirection: "row", alignItems: "center", gap: 4, padding: 8 },
  backText: { color: palette.ink, fontWeight: "800", fontSize: 13 },
  syncCard: { alignItems: "center", gap: 14, padding: 18, borderRadius: 18, borderWidth: 1, borderColor: "#CBD5E1", backgroundColor: "#FFFFFF" },
  fileOption: { alignSelf: "stretch", minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: "#E2E8F0", paddingHorizontal: 6 },
  fileOptionName: { flex: 1, color: "#0F172A", fontSize: 14, fontWeight: "700", textAlign: "right" },
  fileState: { color: "#047857", fontSize: 12, fontWeight: "800", width: 52 },
  pickCard: { minHeight: 270, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  pickIcon: { width: 68, height: 68, borderRadius: 23, backgroundColor: palette.tealPale, alignItems: "center", justifyContent: "center" },
  pickTitle: { color: palette.ink, fontSize: 19, fontWeight: "900" },
  pickBody: { color: palette.muted, fontSize: 13, lineHeight: 21, textAlign: "center", maxWidth: 520 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  fileTitle: { color: palette.ink, fontWeight: "900", fontSize: 14, textAlign: "right" },
  fileMeta: { color: palette.muted, fontSize: 11, textAlign: "right", marginTop: 4 },
  columnsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  columnSelect: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surfaceMuted, minWidth: 190, flexGrow: 1, borderRadius: 13, padding: 12 },
  columnLabel: { color: palette.muted, fontSize: 11, textAlign: "right", fontWeight: "700" },
  columnValue: { color: palette.ink, fontSize: 14, textAlign: "right", fontWeight: "800", marginTop: 3 },
  sheetChip: { borderColor: palette.line, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: palette.surfaceMuted },
  sheetActive: { backgroundColor: palette.ink, borderColor: palette.ink },
  sheetText: { color: palette.inkSoft, fontSize: 12, fontWeight: "800" },
  sheetTextActive: { color: palette.white },
  previewTable: { borderWidth: 1, borderColor: palette.line, borderRadius: 14, overflow: "hidden" },
  previewHead: { flexDirection: "row", gap: 8, padding: 10, backgroundColor: palette.surfaceMuted, borderBottomWidth: 1, borderBottomColor: palette.line },
  previewHeadText: { color: palette.ink, fontWeight: "900" },
  previewRow: { flexDirection: "row", gap: 8, padding: 10, borderBottomWidth: 1, borderBottomColor: palette.line },
  previewCell: { flex: 1, color: palette.text, fontSize: 12, textAlign: "right" },
  errorsBox: { backgroundColor: palette.amberPale, borderRadius: 12, padding: 12, gap: 4 },
  errorsTitle: { color: palette.amber, fontWeight: "900", fontSize: 13, textAlign: "right" },
  errorLine: { color: palette.inkSoft, fontSize: 12, textAlign: "right" },
  modalShade: { flex: 1, backgroundColor: "rgba(17,35,62,0.48)", justifyContent: "center", alignItems: "center", padding: 24 },
  pickerModal: { width: "100%", maxWidth: 520, backgroundColor: palette.surface, borderRadius: 20, padding: 18, gap: 14 },
  modalTitle: { color: palette.ink, fontSize: 17, fontWeight: "900", textAlign: "right" },
  optionRow: { minHeight: 48, borderBottomWidth: 1, borderBottomColor: palette.line, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, paddingHorizontal: 8 },
  optionText: { color: palette.ink, fontSize: 14, textAlign: "right", flex: 1 },
  optionIndex: { color: palette.muted, fontSize: 12, width: 22, textAlign: "left" },
});
