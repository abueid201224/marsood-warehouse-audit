import { MAX_ITEM_CODE_LENGTH, normalizeCode, parseQuantity } from "./codes";

/** الأعمدة الخمسة المطلوبة في ملف Excel. */
export type FieldKey = "order" | "invoice" | "item" | "unit" | "qty" | "desc";
export type ColumnMap = Record<FieldKey, number | null>;
export type Cell = string | number;

export const FIELD_LABELS: Record<FieldKey, string> = {
  order: "رقم الطلب",
  invoice: "رقم الفاتورة",
  item: "كود الصنف",
  unit: "الوحدة",
  qty: "الكمية",
  desc: "بيان الصنف",
};
export const FIELD_ORDER: FieldKey[] = ["order", "invoice", "item", "unit", "qty", "desc"];
/** أعمدة اختيارية: لا يمنع غيابها الاستيراد. */
export const OPTIONAL_FIELDS: FieldKey[] = ["invoice", "unit", "desc"];

export interface SheetPreview {
  fileName: string;
  sheetNames: string[];
  sheetIndex: number;
  /** فهرس صف العناوين، أو -1 إذا لم يوجد صف عناوين (افتراض ترتيب الأعمدة الخمسة). */
  headerRowIndex: number;
  headers: string[];
  rows: Cell[][];
  columnMap: ColumnMap;
  /** true إذا لم تُعرف العناوين فاعتُمد ترتيب الأعمدة الافتراضي. */
  positional: boolean;
}

export interface ImportRow {
  orderNo: string;
  invoiceNo: string;
  itemCode: string;
  unit: string;
  qty: number;
  /** بيان الصنف (ITEM DESQ) إن وُجد العمود. */
  desc?: string;
  sourceRow: number;
}
export interface ImportRowError {
  sourceRow: number;
  message: string;
}
export interface ParsedImport {
  rows: ImportRow[];
  errors: ImportRowError[];
  totalRows: number;
}

const HEADER_TERMS: Record<FieldKey, string[]> = {
  order: ["order", "order no", "order number", "order id", "order #", "waybill", "awb", "رقم الطلب", "الطلب", "طلب", "رقم الاوردر", "الاوردر", "اوردر", "رقم البوليصه", "البوليصه", "بوليصه"],
  invoice: ["invoice", "invoice no", "invoice number", "invoice #", "inv", "inv no", "رقم الفاتوره", "الفاتوره", "فاتوره"],
  item: ["item code", "item", "item no", "code", "sku", "barcode", "product code", "كود الصنف", "كود", "رمز الصنف", "رقم الصنف", "الصنف", "كود المنتج", "باركود", "الباركود"],
  unit: ["unit", "uom", "unit of measure", "الوحده", "وحده"],
  desc: ["item desq", "item desc", "item description", "item name", "description", "desq", "desc", "بيان الصنف", "بيان", "وصف الصنف", "الوصف", "وصف", "اسم الصنف", "اسم المنتج"],
  qty: ["qty", "quantity", "count", "الكميه", "كميه", "الكمية", "كمية", "العدد", "عدد"],
};

/** يطبّع نص عنوان العمود (همزات/تاء مربوطة/فواصل) مع إبقاء المسافات بين الكلمات. */
function headerText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[_\-.:#/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectColumns(headerRow: unknown[]): ColumnMap {
  const map: ColumnMap = { order: null, invoice: null, item: null, unit: null, qty: null, desc: null };
  const used = new Set<number>();
  const cells = headerRow.map(headerText);
  // مطابقة تامة أولاً ثم احتواء، بترتيب الأخصّ فالأعم لتجنب أن يلتقط «كود» عمود «رقم الطلب».
  const passes: Array<(cell: string, term: string) => boolean> = [
    (cell, term) => cell === term,
    (cell, term) => cell.length > 0 && term.length >= 3 && cell.includes(term),
  ];
  for (const match of passes) {
    for (const key of FIELD_ORDER) {
      if (map[key] !== null) continue;
      const terms = HEADER_TERMS[key].map(headerText);
      const index = cells.findIndex((cell, i) => !used.has(i) && terms.some((term) => match(cell, term)));
      if (index >= 0) {
        map[key] = index;
        used.add(index);
      }
    }
  }
  return map;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value).trim();
}

/** يبني المعاينة من شبكة خلايا خام (صفوف × أعمدة). مستقلة عن مكتبة xlsx لتسهيل الاختبار. */
export function inspectGrid(
  grid: unknown[][],
  fileName: string,
  sheetNames: string[] = ["Sheet1"],
  sheetIndex = 0,
): SheetPreview {
  const cleaned: Cell[][] = grid.map((row) =>
    row.map((value) => (typeof value === "number" ? value : cellText(value))),
  );
  const nonEmpty = (row: Cell[]) => row.some((value) => cellText(value) !== "");
  if (!cleaned.some(nonEmpty)) throw new Error("ورقة العمل فارغة.");

  let headerRowIndex = -1;
  let columnMap: ColumnMap = { order: 0, invoice: 1, item: 2, unit: 3, qty: 4, desc: 5 };
  let positional = true;
  for (let index = 0; index < Math.min(cleaned.length, 30); index += 1) {
    const candidate = detectColumns(cleaned[index]);
    const found = FIELD_ORDER.filter((key) => candidate[key] !== null).length;
    if (candidate.order !== null && candidate.item !== null && candidate.qty !== null && found >= 3) {
      headerRowIndex = index;
      columnMap = candidate;
      positional = false;
      break;
    }
  }

  if (positional) {
    // لا عناوين معروفة: إذا كان أول صف غير فارغ لا يحمل كمية رقمية في العمود الخامس فهو عناوين.
    const firstIndex = cleaned.findIndex(nonEmpty);
    const first = cleaned[firstIndex] ?? [];
    const qtyOfFirst = parseQuantity(first[4]);
    headerRowIndex = qtyOfFirst === undefined ? firstIndex : firstIndex - 1;
  }

  const widest = cleaned.reduce((max, row) => Math.max(max, row.length), 0);
  const headerCells = headerRowIndex >= 0 ? cleaned[headerRowIndex] : [];
  const headers = Array.from({ length: widest }, (_, i) => cellText(headerCells[i]) || `عمود ${i + 1}`);
  const rows = cleaned.slice(headerRowIndex + 1).filter(nonEmpty);
  return { fileName, sheetNames, sheetIndex, headerRowIndex, headers, rows, columnMap, positional };
}

/** يقرأ ملف Excel/CSV؛ تُمرَّر مكتبة xlsx حتى لا تُحمَّل في الاختبارات التي لا تحتاجها. */
export function inspectWorkbook(
  XLSX: typeof import("xlsx"),
  bytes: Uint8Array,
  fileName: string,
  sheetIndex = 0,
): SheetPreview {
  const isCsv = /\.(csv|txt)$/i.test(fileName);
  // CSV يُقرأ كنص UTF-8 صريحاً (حتى لا تتلف الحروف العربية) وraw يحفظ الأصفار البادئة في الأكواد
  const workbook = isCsv
    ? XLSX.read(new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, ""), { type: "string", raw: true })
    : XLSX.read(bytes, { type: "array", cellDates: false, raw: true });
  if (workbook.SheetNames.length === 0) throw new Error("لا يحتوي الملف على أوراق عمل.");
  const safeIndex = Math.max(0, Math.min(sheetIndex, workbook.SheetNames.length - 1));
  const sheet = workbook.Sheets[workbook.SheetNames[safeIndex]];
  // raw:true يبقي الأرقام الطويلة (13 خانة مثلاً) سليمة بدل صيغة 1.2E+12.
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "", blankrows: false }) as unknown[][];
  return inspectGrid(grid, fileName, workbook.SheetNames, safeIndex);
}

export function mapRows(preview: SheetPreview, map: ColumnMap): ParsedImport {
  const rows: ImportRow[] = [];
  const errors: ImportRowError[] = [];
  const missing = FIELD_ORDER.filter((key) => !OPTIONAL_FIELDS.includes(key) && map[key] === null);
  if (missing.length > 0) {
    return {
      rows,
      errors: [{ sourceRow: preview.headerRowIndex + 1, message: `اختر الأعمدة المطلوبة: ${missing.map((key) => FIELD_LABELS[key]).join("، ")}.` }],
      totalRows: preview.rows.length,
    };
  }
  const at = (cells: Cell[], key: FieldKey): Cell => (map[key] === null ? "" : (cells[map[key] as number] ?? ""));

  preview.rows.forEach((cells, index) => {
    const sourceRow = preview.headerRowIndex + index + 2;
    const orderNo = normalizeCode(at(cells, "order"));
    const invoiceNo = cellText(at(cells, "invoice"));
    const itemCode = normalizeCode(at(cells, "item"));
    const unit = cellText(at(cells, "unit"));
    const desc = cellText(at(cells, "desc"));
    const qty = parseQuantity(at(cells, "qty"));
    const issues: string[] = [];
    if (!orderNo) issues.push("رقم الطلب فارغ");
    if (!itemCode) issues.push("كود الصنف فارغ");
    else if (itemCode.length > MAX_ITEM_CODE_LENGTH) issues.push(`كود الصنف أطول من ${MAX_ITEM_CODE_LENGTH} خانات فلا يُعد كود صنف`);
    if (qty === undefined) issues.push("الكمية غير رقمية أو سالبة");
    else if (qty === 0) issues.push("الكمية صفر");
    if (issues.length > 0) {
      errors.push({ sourceRow, message: issues.join("، ") });
      return;
    }
    rows.push({ orderNo, invoiceNo, itemCode, unit, qty: qty as number, desc, sourceRow });
  });
  return { rows, errors, totalRows: preview.rows.length };
}
