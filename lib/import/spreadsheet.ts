import * as XLSX from "xlsx";
import { normalizeBarcode } from "../domain/audit";

export type ColumnKey = "invoice" | "barcode" | "description" | "quantity";
export type ColumnMap = Record<ColumnKey, number | null>;
export interface WorkbookPreview {
  fileName: string;
  sheetNames: string[];
  sheetIndex: number;
  headerRowIndex: number;
  headers: string[];
  rows: string[][];
  columnMap: ColumnMap;
}
export interface ImportRow {
  invoiceNumber: string;
  barcode: string;
  description: string;
  expectedQty: number;
  sourceRow: number;
}
export interface MappedRows {
  rows: ImportRow[];
  errors: { sourceRow: number; message: string; raw: string[] }[];
}

const HEADER_TERMS: Record<ColumnKey, string[]> = {
  invoice: ["invoice", "invoice no", "invoice number", "order", "order no", "رقم الفاتورة", "رقم الطلب", "الفاتورة"],
  barcode: ["barcode", "bar code", "ean", "upc", "sku", "item code", "رمز", "باركود", "الباركود", "كود الصنف"],
  description: ["description", "product", "item name", "name", "الصنف", "وصف", "المنتج", "اسم الصنف"],
  quantity: ["qty", "quantity", "count", "units", "الكمية", "كميه", "العدد", "عدد الوحدات"],
};

function normalizeDigits(value: string): string {
  const ar = "٠١٢٣٤٥٦٧٨٩";
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  return value
    .replace(/[٠-٩]/g, (char) => String(ar.indexOf(char)))
    .replace(/[۰-۹]/g, (char) => String(fa.indexOf(char)));
}

function normalizeHeader(value: string): string {
  return normalizeDigits(value).trim().toLowerCase().replace(/[\s_\-]+/g, " ");
}

function headerMap(row: string[]): ColumnMap {
  const map: ColumnMap = { invoice: null, barcode: null, description: null, quantity: null };
  for (const key of Object.keys(HEADER_TERMS) as ColumnKey[]) {
    const terms = HEADER_TERMS[key].map(normalizeHeader);
    const index = row.findIndex((cell) => terms.some((term) => normalizeHeader(cell) === term));
    map[key] = index < 0 ? null : index;
  }
  return map;
}

export function parseLocalizedQuantity(value: string): number | undefined {
  let source = normalizeDigits(value).replace(/[٬\s]/g, "").replace(/[−–]/g, "-");
  if (!source) return undefined;
  if (source.includes("٫")) source = source.replace(/\./g, "").replace("٫", ".");
  else if (source.includes(",") && source.includes(".")) {
    const decimalAt = Math.max(source.lastIndexOf(","), source.lastIndexOf("."));
    const decimal = source[decimalAt];
    source = source.slice(0, decimalAt).replace(/[.,]/g, "") + "." + source.slice(decimalAt + 1).replace(/[.,]/g, "");
  } else if (source.includes(",")) {
    const groups = source.split(",");
    source = groups.length === 2 && groups[1].length !== 3 ? `${groups[0]}.${groups[1]}` : groups.join("");
  }
  const quantity = Number(source);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : undefined;
}

export function inspectWorkbook(bytes: Uint8Array, fileName: string, sheetIndex = 0): WorkbookPreview {
  const workbook = XLSX.read(bytes, { type: "array", raw: false, cellDates: false });
  if (workbook.SheetNames.length === 0) throw new Error("لا يحتوي ملف Excel على أوراق عمل.");
  const safeSheetIndex = Math.max(0, Math.min(sheetIndex, workbook.SheetNames.length - 1));
  const sheet = workbook.Sheets[workbook.SheetNames[safeSheetIndex]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
  const normalizedGrid = grid.map((row) => row.map((value) => String(value ?? "").trim()));
  if (normalizedGrid.length === 0) throw new Error("ورقة العمل فارغة.");

  let headerRowIndex = 0;
  let detectedMap: ColumnMap = headerMap(normalizedGrid[0]);
  for (let index = 0; index < Math.min(normalizedGrid.length, 30); index += 1) {
    const candidate = headerMap(normalizedGrid[index]);
    if (candidate.barcode !== null && candidate.quantity !== null) {
      headerRowIndex = index;
      detectedMap = candidate;
      break;
    }
  }

  const headers = normalizedGrid[headerRowIndex].map((value, index) => value || `عمود ${index + 1}`);
  const rows = normalizedGrid.slice(headerRowIndex + 1).filter((row) => row.some((value) => value.trim().length > 0));
  return {
    fileName,
    sheetNames: workbook.SheetNames,
    sheetIndex: safeSheetIndex,
    headerRowIndex,
    headers,
    rows,
    columnMap: detectedMap,
  };
}

export function mapWorkbookRows(preview: WorkbookPreview, map: ColumnMap): MappedRows {
  const errors: MappedRows["errors"] = [];
  const rows: ImportRow[] = [];
  const fallbackInvoice = preview.fileName.replace(/\.[^.]+$/, "");
  if (map.barcode === null || map.quantity === null) {
    return {
      rows,
      errors: [{ sourceRow: preview.headerRowIndex + 1, message: "اختر عمود الباركود وعمود الكمية أولاً.", raw: [] }],
    };
  }
  const barcodeIndex = map.barcode;
  const quantityIndex = map.quantity;
  const descriptionIndex = map.description;
  const invoiceIndex = map.invoice;

  preview.rows.forEach((cells, index) => {
    const sourceRow = preview.headerRowIndex + index + 2;
    const barcode = normalizeBarcode(cells[barcodeIndex] ?? "");
    const qtyRaw = cells[quantityIndex] ?? "";
    const expectedQty = parseLocalizedQuantity(qtyRaw);
    const description = descriptionIndex === null ? "" : (cells[descriptionIndex] ?? "").trim();
    const invoiceNumber = invoiceIndex === null ? fallbackInvoice : (cells[invoiceIndex] ?? "").trim() || fallbackInvoice;
    const issues: string[] = [];
    if (!barcode) issues.push("الباركود فارغ.");
    if (expectedQty === undefined) issues.push("الكمية غير رقمية أو سالبة.");
    if (expectedQty === 0) issues.push("الكمية صفر؛ تحقق من السطر قبل الاستيراد.");
    if (issues.length > 0) {
      errors.push({ sourceRow, message: issues.join(" "), raw: cells });
      return;
    }
    rows.push({ invoiceNumber, barcode, description, expectedQty: expectedQty as number, sourceRow });
  });

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ sourceRow: preview.headerRowIndex + 2, message: "لم توجد بنود بعد صف العناوين.", raw: [] });
  }
  return { rows, errors };
}

export function groupImportRows(rows: ImportRow[]): Array<{ invoiceNumber: string; rows: ImportRow[] }> {
  const groups = new Map<string, ImportRow[]>();
  rows.forEach((row) => {
    const invoice = row.invoiceNumber.trim() || "فاتورة بدون رقم";
    const group = groups.get(invoice) ?? [];
    group.push(row);
    groups.set(invoice, group);
  });
  return Array.from(groups, ([invoiceNumber, groupRows]) => ({ invoiceNumber, rows: groupRows }));
}
