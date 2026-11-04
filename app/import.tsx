import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button, Card, Header, Notice, Screen, SectionTitle } from "@/components/MarsoodUI";
import { createAuditSession, type AuditSession } from "@/lib/domain/audit";
import { extractPdfText, type PdfLineCandidate, type PdfTextResult } from "@/lib/import/pdf";
import { groupImportRows, inspectWorkbook, mapWorkbookRows, parseLocalizedQuantity, type ColumnKey, type ColumnMap, type WorkbookPreview } from "@/lib/import/spreadsheet";
import { auditRepository } from "@/lib/storage/repository";
import { archiveImportedFile } from "../lib/storage/local-source";
import { palette } from "@/lib/palette";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const COLUMN_LABELS: Record<ColumnKey, string> = {
  invoice: "رقم الفاتورة",
  barcode: "الباركود",
  description: "وصف الصنف",
  quantity: "الكمية المتوقعة",
};
type PdfDraft = PdfLineCandidate & { barcodeText: string; quantityText: string; descriptionText: string; verified: boolean };

function ColumnSelect({
  label,
  value,
  headers,
  optional,
  onChange,
}: {
  label: string;
  value: number | null;
  headers: string[];
  optional: boolean;
  onChange: (value: number | null) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <Pressable onPress={() => setVisible(true)} style={styles.columnSelect} accessibilityRole="button">
        <MaterialCommunityIcons name="chevron-down" size={19} color={palette.muted} />
        <View style={{ flex: 1 }}>
          <Text style={styles.columnLabel}>{label}</Text>
          <Text style={styles.columnValue}>{value === null ? (optional ? "غير مستخدم" : "اختر العمود") : headers[value] ?? `عمود ${value + 1}`}</Text>
        </View>
      </Pressable>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <View style={styles.modalShade}>
          <View style={styles.pickerModal}>
            <Text style={styles.modalTitle}>اختر عمود {label}</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {optional ? (
                <Pressable onPress={() => { onChange(null); setVisible(false); }} style={styles.optionRow}>
                  <Text style={styles.optionText}>غير مستخدم</Text>
                  <MaterialCommunityIcons name="minus-circle-outline" size={19} color={palette.muted} />
                </Pressable>
              ) : null}
              {headers.map((header, index) => (
                <Pressable key={`${index}-${header}`} onPress={() => { onChange(index); setVisible(false); }} style={styles.optionRow}>
                  <Text style={styles.optionText}>{header || `عمود ${index + 1}`}</Text>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileUri, setFileUri] = useState("");
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [workbook, setWorkbook] = useState<WorkbookPreview | null>(null);
  const [columnMap, setColumnMap] = useState<ColumnMap | null>(null);
  const [pdfResult, setPdfResult] = useState<PdfTextResult | null>(null);
  const [pdfRows, setPdfRows] = useState<PdfDraft[]>([]);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [showPdfText, setShowPdfText] = useState(false);
  const [duplicateInvoices, setDuplicateInvoices] = useState<string[]>([]);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);

  const mapped = useMemo(() => workbook && columnMap ? mapWorkbookRows(workbook, columnMap) : null, [workbook, columnMap]);
  const groups = useMemo(() => mapped ? groupImportRows(mapped.rows) : [], [mapped]);
  const pdfReady = pdfRows.length > 0 && pdfRows.every((row) => row.verified && row.barcodeText.trim() && (parseLocalizedQuantity(row.quantityText) ?? 0) > 0);
  const canImportXlsx = !!mapped && mapped.rows.length > 0 && mapped.errors.length === 0 && duplicateInvoices.every(() => allowDuplicate);

  function reset() {
    setError(""); setNotice(""); setFileName(""); setFileUri(""); setFileBytes(null); setWorkbook(null); setColumnMap(null);
    setPdfResult(null); setPdfRows([]); setInvoiceNumber(""); setDuplicateInvoices([]); setAllowDuplicate(false); setShowPdfText(false);
  }

  async function chooseFile() {
    setError(""); setNotice(""); setCreatedCount(0);
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: false });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      const ext = asset.name.split(".").pop()?.toLowerCase() ?? "";
      const isPdf = ext === "pdf" || asset.mimeType === "application/pdf";
      const isSheet = ["xlsx", "xls", "csv"].includes(ext) || ["text/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"].includes(asset.mimeType ?? "");
      if (!isPdf && !isSheet) {
        setError("صيغة الملف غير مدعومة. اختر XLSX أو XLS أو CSV أو PDF.");
        return;
      }
      if (asset.size && asset.size > MAX_FILE_BYTES) {
        setError("حجم الملف أكبر من الحد التجريبي 25 ميغابايت. قسّم الملف أو استخدم نسخة أصغر.");
        return;
      }
      setBusy(true);
      const localFile = asset.file ?? new File(asset.uri);
      const bytes = new Uint8Array(await localFile.arrayBuffer());
      if (bytes.byteLength === 0) throw new Error("الملف فارغ أو تعذر قراءته من الجهاز.");
      if (bytes.byteLength > MAX_FILE_BYTES) throw new Error("حجم الملف أكبر من 25 ميغابايت.");
      setFileName(asset.name);
      setFileUri(asset.uri);
      setFileBytes(bytes);
      setInvoiceNumber(asset.name.replace(/\.[^.]+$/, ""));
      if (isPdf) {
        const result = await extractPdfText({ uri: asset.uri, bytes });
        setPdfResult(result);
        setPdfRows(result.candidates.map((row) => ({ ...row, barcodeText: row.barcode, quantityText: String(row.expectedQty), descriptionText: row.description, verified: false })));
        if (result.candidates.length === 0) setNotice("لم تُنشأ جلسة. لا تعتمد PDF غير المقروء؛ استخدم نسخة نصية قابلة للبحث أو استورد ملف Excel.");
      } else {
        const preview = inspectWorkbook(bytes, asset.name);
        setWorkbook(preview);
        setColumnMap(preview.columnMap);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر قراءة الملف المحدد.");
    } finally {
      setBusy(false);
    }
  }

  function changeSheet(index: number) {
    if (!fileBytes || !fileName) return;
    try {
      const preview = inspectWorkbook(fileBytes, fileName, index);
      setWorkbook(preview);
      setColumnMap(preview.columnMap);
      setDuplicateInvoices([]);
      setAllowDuplicate(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر قراءة ورقة العمل.");
    }
  }

  async function persistSessions(sessions: AuditSession[]) {
    if (!fileUri || !fileName) throw new Error("أعد اختيار الملف؛ لم يعد مساره المؤقت متاحاً.");
    let sourceUri: string | undefined;
    try { sourceUri = await archiveImportedFile(fileUri, fileName); }
    catch { throw new Error("تعذر حفظ نسخة ملف المصدر داخل مساحة التطبيق. أفرغ مساحة ثم أعد المحاولة."); }
    if (Platform.OS !== "web" && !sourceUri) throw new Error("لم يُحفظ ملف المصدر على الجهاز؛ لم تُنشأ جلسة تدقيق.");
    const prepared = sessions.map((session) => ({ ...session, ...(sourceUri ? { sourceUri } : {}) }));
    await auditRepository.saveSessions(prepared);
    setCreatedCount(prepared.length);
    setNotice(sourceUri ? `تم حفظ ${prepared.length} جلسة محلياً مع نسخة من الملف الأصلي.` : `حُفظت الجلسة مؤقتاً في معاينة الويب؛ في APK Android تُحفظ الجلسات في SQLite على الجهاز.`);
    if (prepared.length === 1) router.replace({ pathname: "/audit/[id]", params: { id: prepared[0].id } });
    else router.replace("/(tabs)/sessions");
  }

  async function checkDuplicates(invoiceNumbers: string[]) {
    const existing = await auditRepository.listSessions();
    const current = new Set(existing.map((session) => session.invoiceNumber.trim().toLowerCase()));
    return Array.from(new Set(invoiceNumbers.filter((number) => current.has(number.trim().toLowerCase()))));
  }

  async function importWorkbook() {
    if (!mapped || mapped.rows.length === 0) return;
    if (mapped.errors.length > 0) { setError("عالج الصفوف غير الصالحة في المصدر ثم أعد الاستيراد؛ لن نتجاوز أسطراً بصمت."); return; }
    setBusy(true); setError("");
    try {
      const duplicate = await checkDuplicates(groups.map((group) => group.invoiceNumber));
      if (duplicate.length > 0 && !allowDuplicate) { setDuplicateInvoices(duplicate); setError("يوجد رقم فاتورة مستورد مسبقاً. راجع الموجود، أو أكّد إنشاء جلسة جديدة مكررة عمداً."); return; }
      const sessions = groups.map((group) => createAuditSession(group.invoiceNumber, fileName, group.rows));
      await persistSessions(sessions);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حفظ الفواتير في التخزين المحلي.");
    } finally {
      setBusy(false);
    }
  }

  async function importPdf() {
    if (!pdfReady || !pdfResult) return;
    setBusy(true); setError("");
    try {
      const duplicate = await checkDuplicates([invoiceNumber]);
      if (duplicate.length > 0 && !allowDuplicate) { setDuplicateInvoices(duplicate); setError("يوجد رقم فاتورة مستورد مسبقاً. راجع الموجود أو أكّد إنشاء جلسة جديدة مكررة عمداً."); return; }
      const rows = pdfRows.map((row, index) => ({
        barcode: row.barcodeText.trim(),
        description: row.descriptionText.trim(),
        expectedQty: parseLocalizedQuantity(row.quantityText) as number,
        sourceRow: row.sourceRow || index + 1,
      }));
      const session = createAuditSession(invoiceNumber.trim() || fileName.replace(/\.[^.]+$/, ""), fileName, rows);
      await persistSessions([session]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حفظ PDF في التخزين المحلي.");
    } finally {
      setBusy(false);
    }
  }

  function updatePdfRow(index: number, patch: Partial<PdfDraft>) {
    setPdfRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch, verified: false } : row));
  }

  return (
    <Screen>
      <Header title="استيراد مستند" subtitle="الملف يُقرأ ويُحفظ داخل التطبيق على هذا الجهاز" right={<Pressable onPress={() => router.back()} style={styles.backButton}><MaterialCommunityIcons name="arrow-right" size={20} color={palette.ink} /><Text style={styles.backText}>رجوع</Text></Pressable>} />
      <Notice title="خصوصية البيانات" body={Platform.OS === "web" ? "هذه معاينة ويب مؤقتة ولا تثبت التخزين الدائم؛ لا تدخل بيانات حقيقية هنا. يعمل APK Android على الملفات محلياً دون رفع." : "لا تُرفع الفواتير. يحفظ Android ملف المصدر وبيانات البنود داخل مساحة التطبيق الخاصة على الجهاز."} tone="success" icon="shield-lock-outline" />
      {error ? <Notice title="يلزم الانتباه" body={error} tone="danger" /> : null}
      {notice && createdCount > 0 ? <Notice title="تم الحفظ" body={notice} tone="success" /> : null}
      {!fileName ? (
        <Card style={styles.pickCard}>
          <View style={styles.pickIcon}><MaterialCommunityIcons name="file-upload-outline" size={31} color={palette.tealDeep} /></View>
          <Text style={styles.pickTitle}>اختر ملف الفاتورة</Text>
          <Text style={styles.pickBody}>يدعم XLSX وXLS وCSV وPDF حتى 25 ميغابايت. لن تُعتمد البنود قبل معاينتها.</Text>
          <Button title={busy ? "جارٍ قراءة الملف…" : "تحديد ملف من الجهاز"} icon="folder-open-outline" onPress={chooseFile} disabled={busy} />
          <Text style={styles.helperText}>لا نطلب صلاحية عامة للوصول إلى التخزين؛ يختار المستخدم الملف من منتقي Android.</Text>
        </Card>
      ) : null}

      {fileName ? (
        <Card style={styles.fileCard}>
          <View style={styles.fileIcon}><MaterialCommunityIcons name={pdfResult ? "file-pdf-box" : "file-excel-box"} size={25} color={pdfResult ? palette.red : palette.teal} /></View>
          <View style={{ flex: 1 }}><Text style={styles.fileTitle} numberOfLines={1}>{fileName}</Text><Text style={styles.fileMeta}>{pdfResult ? `${pdfResult.pageCount || 0} صفحة • معاينة أولية` : workbook ? `${workbook.rows.length} صف بيانات مبدئي • ${workbook.sheetNames.length} ورقة` : "جارٍ التحليل"}</Text></View>
          <Pressable onPress={reset} accessibilityLabel="اختيار ملف آخر"><MaterialCommunityIcons name="close-circle-outline" size={23} color={palette.muted} /></Pressable>
        </Card>
      ) : null}

      {workbook && columnMap ? (
        <>
          {workbook.sheetNames.length > 1 ? (
            <Card>
              <SectionTitle title="ورقة العمل" hint="اختر الورقة التي تحتوي قائمة الأصناف" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {workbook.sheetNames.map((sheet, index) => <Pressable key={sheet} onPress={() => changeSheet(index)} style={[styles.sheetChip, workbook.sheetIndex === index && styles.sheetActive]}><Text style={[styles.sheetText, workbook.sheetIndex === index && styles.sheetTextActive]}>{sheet}</Text></Pressable>)}
              </ScrollView>
            </Card>
          ) : null}
          <Card>
            <SectionTitle title="ربط الحقول" hint={`صف العناوين ${workbook.headerRowIndex + 1} • أكد الحقول قبل الاعتماد`} />
            <View style={styles.columnsGrid}>
              {(["barcode", "quantity", "description", "invoice"] as ColumnKey[]).map((key) => <ColumnSelect key={key} label={COLUMN_LABELS[key]} value={columnMap[key]} headers={workbook.headers} optional={key === "description" || key === "invoice"} onChange={(value) => setColumnMap((current) => current ? { ...current, [key]: value } : current)} />)}
            </View>
            {mapped?.errors.length ? <Notice title={`${mapped.errors.length} صف يحتاج معالجة`} body={`${mapped.errors.slice(0, 3).map((row) => `صف ${row.sourceRow}: ${row.message}`).join(" • ")} لن يتم إسقاط صفوف غير صالحة تلقائياً.`} tone="warning" /> : null}
            {mapped?.rows.length ? <Notice title="معاينة قبل الحفظ" body={`${mapped.rows.length} بند صالح في ${groups.length} فاتورة. التكرارات محفوظة كسطور منفصلة ولا تُدمج.`} tone="info" /> : null}
            {mapped?.rows.length ? (
              <View style={styles.previewTable}>
                <View style={styles.previewHead}><Text style={[styles.previewCell, styles.previewHeadText]}>الكمية</Text><Text style={[styles.previewCell, styles.previewHeadText]}>الباركود</Text><Text style={[styles.previewDescription, styles.previewHeadText]}>الوصف</Text></View>
                {mapped.rows.slice(0, 6).map((row, index) => <View key={`${row.sourceRow}-${index}`} style={styles.previewRow}><Text style={styles.previewCell}>{row.expectedQty}</Text><Text style={styles.previewCell} numberOfLines={1}>{row.barcode}</Text><Text style={styles.previewDescription} numberOfLines={1}>{row.description || "—"}</Text></View>)}
              </View>
            ) : null}
            {duplicateInvoices.length > 0 ? <Pressable onPress={() => setAllowDuplicate((value) => !value)} style={styles.confirmDuplicate}><MaterialCommunityIcons name={allowDuplicate ? "checkbox-marked-outline" : "checkbox-blank-outline"} size={22} color={allowDuplicate ? palette.teal : palette.muted} /><Text style={styles.confirmText}>أفهم أن {duplicateInvoices.join("، ")} مستورد مسبقاً؛ أنشئ جلسة تدقيق جديدة مكررة عمداً.</Text></Pressable> : null}
            <Button title={busy ? "جارٍ الحفظ الذري…" : `حفظ ${groups.length} فاتورة محلياً`} icon="database-check-outline" onPress={importWorkbook} disabled={!canImportXlsx || busy} />
            <Text style={styles.helperText}>عند وجود أي صف ناقص أو كمية غير صالحة، يتوقف الاستيراد بدلاً من تجاوز البيانات بصمت.</Text>
          </Card>
        </>
      ) : null}

      {pdfResult ? (
        <>
          <Notice title="استخراج PDF يحتاج مراجعة بشرية" body={pdfResult.warning ?? "راجع البيانات قبل اعتمادها."} tone={pdfRows.length ? "warning" : "danger"} />
          {pdfRows.length > 0 ? (
            <Card>
              <SectionTitle title="بنود مرشحة من PDF" hint={`${pdfRows.filter((row) => row.verified).length} من ${pdfRows.length} بند مؤكد يدوياً`} />
              <TextInput value={invoiceNumber} onChangeText={setInvoiceNumber} placeholder="رقم الفاتورة (الافتراضي اسم الملف)" placeholderTextColor={palette.subtle} style={styles.invoiceInput} textAlign="right" />
              {pdfRows.map((row, index) => (
                <View key={`${row.sourceRow}-${index}`} style={styles.pdfRow}>
                  <View style={styles.pdfRowHeading}><Pressable onPress={() => setPdfRows((current) => current.map((item, i) => i === index ? { ...item, verified: !item.verified } : item))} style={styles.verifyButton}><MaterialCommunityIcons name={row.verified ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"} size={22} color={row.verified ? palette.teal : palette.subtle} /><Text style={styles.verifyText}>{row.verified ? "تمت المراجعة" : "أكد بعد المراجعة"}</Text></Pressable><Text style={styles.rowNumber}>سطر {row.sourceRow}</Text></View>
                  <View style={styles.pdfInputs}><TextInput value={row.barcodeText} onChangeText={(value) => updatePdfRow(index, { barcodeText: value })} style={[styles.pdfInput, { flex: 1.15 }]} placeholder="الباركود" textAlign="right" autoCapitalize="characters" /><TextInput value={row.quantityText} onChangeText={(value) => updatePdfRow(index, { quantityText: value })} style={[styles.pdfInput, { flex: 0.55 }]} placeholder="الكمية" keyboardType="decimal-pad" textAlign="center" /><TextInput value={row.descriptionText} onChangeText={(value) => updatePdfRow(index, { descriptionText: value })} style={[styles.pdfInput, { flex: 1.35 }]} placeholder="وصف الصنف" textAlign="right" /></View>
                  <Text style={styles.sourceText} numberOfLines={2}>{row.sourceText}</Text>
                </View>
              ))}
              {duplicateInvoices.length > 0 ? <Pressable onPress={() => setAllowDuplicate((value) => !value)} style={styles.confirmDuplicate}><MaterialCommunityIcons name={allowDuplicate ? "checkbox-marked-outline" : "checkbox-blank-outline"} size={22} color={allowDuplicate ? palette.teal : palette.muted} /><Text style={styles.confirmText}>أفهم أن رقم الفاتورة مستورد مسبقاً؛ أنشئ جلسة جديدة مكررة عمداً.</Text></Pressable> : null}
              <Button title={busy ? "جارٍ الحفظ…" : "تأكيد البنود وحفظ محلياً"} icon="clipboard-check-outline" onPress={importPdf} disabled={!pdfReady || busy} />
              <Text style={styles.helperText}>لا يمكن قراءة PDF المصور بهذه النسخة. البنود لا تُعتمد إلا بعد تعديلها/تأكيدها يدوياً.</Text>
            </Card>
          ) : null}
          {pdfResult.lines.length > 0 ? (
            <Card>
              <Pressable onPress={() => setShowPdfText((value) => !value)} style={styles.pdfTextToggle}><MaterialCommunityIcons name={showPdfText ? "chevron-up" : "chevron-down"} size={20} color={palette.tealDeep} /><Text style={styles.sectionInline}>عرض النص المستخرج للمراجعة</Text></Pressable>
              {showPdfText ? <View style={styles.extractedText}>{pdfResult.lines.slice(0, 120).map((line, index) => <Text key={`${index}-${line}`} style={styles.extractedLine}>{line}</Text>)}</View> : null}
            </Card>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  backButton: { flexDirection: "row", alignItems: "center", gap: 4, padding: 8 },
  backText: { color: palette.ink, fontWeight: "800", fontSize: 13 },
  pickCard: { minHeight: 270, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  pickIcon: { width: 68, height: 68, borderRadius: 23, backgroundColor: palette.tealPale, alignItems: "center", justifyContent: "center" },
  pickTitle: { color: palette.ink, fontSize: 19, fontWeight: "900" },
  pickBody: { color: palette.muted, fontSize: 13, lineHeight: 21, textAlign: "center", maxWidth: 520 },
  helperText: { color: palette.muted, fontSize: 11, lineHeight: 18, textAlign: "right", alignSelf: "stretch" },
  fileCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  fileIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: palette.surfaceMuted, alignItems: "center", justifyContent: "center" },
  fileTitle: { color: palette.ink, fontWeight: "900", fontSize: 14, textAlign: "right" },
  fileMeta: { color: palette.muted, fontSize: 11, textAlign: "right", marginTop: 4 },
  columnsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  columnSelect: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surfaceMuted, minWidth: 190, flexGrow: 1, borderRadius: 13, padding: 12 },
  columnLabel: { color: palette.muted, fontSize: 10, textAlign: "right", fontWeight: "700" },
  columnValue: { color: palette.ink, fontSize: 13, textAlign: "right", fontWeight: "800", marginTop: 3 },
  sheetChip: { borderColor: palette.line, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: palette.surfaceMuted },
  sheetActive: { backgroundColor: palette.ink, borderColor: palette.ink },
  sheetText: { color: palette.inkSoft, fontSize: 12, fontWeight: "800" },
  sheetTextActive: { color: palette.white },
  previewTable: { borderWidth: 1, borderColor: palette.line, borderRadius: 14, overflow: "hidden" },
  previewHead: { flexDirection: "row", gap: 8, padding: 10, backgroundColor: palette.surfaceMuted, borderBottomWidth: 1, borderBottomColor: palette.line },
  previewHeadText: { color: palette.ink, fontWeight: "900" },
  previewRow: { flexDirection: "row", gap: 8, padding: 10, borderBottomWidth: 1, borderBottomColor: palette.line },
  previewCell: { flex: 0.8, color: palette.text, fontSize: 12, textAlign: "right" },
  previewDescription: { flex: 1.3, color: palette.text, fontSize: 12, textAlign: "right" },
  confirmDuplicate: { flexDirection: "row", alignItems: "center", gap: 8 },
  confirmText: { color: palette.inkSoft, flex: 1, fontSize: 12, lineHeight: 18, textAlign: "right" },
  modalShade: { flex: 1, backgroundColor: "rgba(17,35,62,0.48)", justifyContent: "center", alignItems: "center", padding: 24 },
  pickerModal: { width: "100%", maxWidth: 520, backgroundColor: palette.surface, borderRadius: 20, padding: 18, gap: 14 },
  modalTitle: { color: palette.ink, fontSize: 17, fontWeight: "900", textAlign: "right" },
  optionRow: { minHeight: 48, borderBottomWidth: 1, borderBottomColor: palette.line, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, paddingHorizontal: 8 },
  optionText: { color: palette.ink, fontSize: 14, textAlign: "right", flex: 1 },
  optionIndex: { color: palette.muted, fontSize: 12, width: 22, textAlign: "left" },
  invoiceInput: { borderWidth: 1, borderColor: palette.line, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, color: palette.ink },
  pdfRow: { backgroundColor: palette.surfaceMuted, borderWidth: 1, borderColor: palette.line, borderRadius: 15, padding: 12, gap: 10 },
  pdfRowHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  verifyButton: { flexDirection: "row", alignItems: "center", gap: 6 },
  verifyText: { color: palette.inkSoft, fontSize: 11, fontWeight: "800" },
  rowNumber: { color: palette.muted, fontSize: 11 },
  pdfInputs: { flexDirection: "row", gap: 7 },
  pdfInput: { minWidth: 70, borderWidth: 1, borderColor: palette.line, borderRadius: 10, color: palette.ink, paddingHorizontal: 9, paddingVertical: 9, fontSize: 12, backgroundColor: palette.white },
  sourceText: { color: palette.muted, fontSize: 10, lineHeight: 16, textAlign: "right" },
  pdfTextToggle: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionInline: { color: palette.tealDeep, fontWeight: "800", fontSize: 13, flex: 1, textAlign: "right" },
  extractedText: { borderTopWidth: 1, borderTopColor: palette.line, paddingTop: 10, gap: 5 },
  extractedLine: { color: palette.inkSoft, fontSize: 11, lineHeight: 17, textAlign: "right" },
});
