import type { ErrorReport, InvoiceView } from "../core/engine";
import { PRINT_KIND_LABELS, PRINT_STATUS_LABELS, formatDateTime } from "../core/format";

type XLSXModule = typeof import("xlsx");
type Cell = string | number | null;

const STATUS_LABEL: Record<string, string> = { new: "جديدة", open: "قيد المراجعة", posted: "مرحّلة بنواقص", closed: "منتهية" };

function sheet(XLSX: XLSXModule, rows: Cell[][], widths: number[]) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = widths.map((wch) => ({ wch }));
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, rows.length - 1), c: Math.max(0, (rows[0]?.length ?? 1) - 1) } }) };
  return ws;
}

/** يضيف صف إجماليات بمعادلة SUM حقيقية (مع قيمة مخزنة لتظهر في كل القارئات) لعمود رقمي. */
function withTotal(XLSX: XLSXModule, ws: import("xlsx").WorkSheet, rows: Cell[][], label: string, labelCol: number, sumCols: number[]) {
  if (rows.length < 2) return;
  const last = rows.length; // آخر صف بيانات (1-based) = rows.length
  const totalRow = last; // 0-based index للصف الجديد
  ws[XLSX.utils.encode_cell({ r: totalRow, c: labelCol })] = { t: "s", v: label };
  for (const col of sumCols) {
    const letter = XLSX.utils.encode_col(col);
    const value = rows.slice(1).reduce((sum, row) => sum + (typeof row[col] === "number" ? (row[col] as number) : 0), 0);
    ws[XLSX.utils.encode_cell({ r: totalRow, c: col })] = { t: "n", v: value, f: `SUM(${letter}2:${letter}${last})` };
  }
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  range.e.r = Math.max(range.e.r, totalRow);
  ws["!ref"] = XLSX.utils.encode_range(range);
}

/**
 * مصنف Excel كامل للتقرير: ملخص ومؤشرات، حالة الفواتير، أخطاء التجهيز، التجهيز الزائد، النواقص، سجل الطباعة.
 * اتجاه الأوراق من اليمين لليسار، وعمود الإجماليات بمعادلات SUM حقيقية.
 */
export function buildReportWorkbook(XLSX: XLSXModule, report: ErrorReport, invoices: InvoiceView[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  const k = report.kpis;
  const summary: Cell[][] = [
    ["البند", "القيمة"],
    ["تاريخ التقرير", formatDateTime(report.generatedAt)],
    ["إجمالي الفواتير", report.stats.total],
    ["الفواتير المنتهية", report.stats.closed],
    ["المرحّلة بنواقص", report.stats.posted],
    ["المتبقية", report.stats.remaining],
    ["أخطاء التجهيز (مرات)", report.wrong.reduce((n, r) => n + r.count, 0)],
    ["التجهيز الزائد (مرات)", report.over.reduce((n, r) => n + r.count, 0)],
    ["دقة المسح %", k.accuracy ?? null],
    ["إنجاز من أول مرة FPY %", k.firstPassYield ?? null],
    ["وحدة/ساعة", k.unitsPerHour == null ? null : Math.round(k.unitsPerHour * 10) / 10],
    ["فاتورة/ساعة", k.invoicesPerHour == null ? null : Math.round(k.invoicesPerHour * 10) / 10],
    ["متوسط زمن الفاتورة (ثانية)", k.avgCycleSeconds == null ? null : Math.round(k.avgCycleSeconds)],
  ];
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, summary, [32, 24]), "الملخص");

  const inv: Cell[][] = [["رقم الطلب", "الفواتير", "الحالة", "التقدم %", "الأصناف", "الوحدات المطلوبة", "الوحدات الممسوحة", "أصناف ناقصة", "أخطاء تجهيز", "تجهيز زائد", "فُتحت", "أُنهيت/رُحّلت"]];
  for (const i of invoices) {
    inv.push([i.order_no, i.invoices ?? "", STATUS_LABEL[i.status] ?? i.status, Math.round(i.progress), i.item_count, i.total_qty, i.done_qty, i.short_items, i.wrong_scans, i.over_scans, i.opened_at ? formatDateTime(i.opened_at) : "", formatDateTime(i.closed_at ?? i.posted_at ?? "")]);
  }
  const invWs = sheet(XLSX, inv, [18, 20, 16, 10, 10, 16, 16, 12, 12, 12, 20, 20]);
  withTotal(XLSX, invWs, inv, "الإجمالي", 0, [4, 5, 6, 7, 8, 9]);
  XLSX.utils.book_append_sheet(wb, invWs, "حالة الفواتير");

  const wrong: Cell[][] = [["رقم الطلب", "رقم الفاتورة", "الكود الممسوح", "المرات", "المشغّل", "وقت أول مسح"]];
  report.wrong.forEach((r) => wrong.push([r.orderNo, r.invoices, r.code, r.count, r.operator, formatDateTime(r.firstAt)]));
  const wrongWs = sheet(XLSX, wrong, [18, 20, 18, 10, 16, 20]);
  withTotal(XLSX, wrongWs, wrong, "الإجمالي", 0, [3]);
  XLSX.utils.book_append_sheet(wb, wrongWs, "أخطاء التجهيز");

  const over: Cell[][] = [["رقم الطلب", "رقم الفاتورة", "كود الصنف", "المطلوب", "الممسوح", "المرات", "المشغّل", "وقت أول مسح"]];
  report.over.forEach((r) => over.push([r.orderNo, r.invoices, r.code, r.expected ?? "", r.scanned ?? "", r.count, r.operator, formatDateTime(r.firstAt)]));
  const overWs = sheet(XLSX, over, [18, 20, 18, 10, 10, 10, 16, 20]);
  withTotal(XLSX, overWs, over, "الإجمالي", 0, [5]);
  XLSX.utils.book_append_sheet(wb, overWs, "التجهيز الزائد");

  const short: Cell[][] = [["رقم الطلب", "رقم الفاتورة", "كود الصنف", "الوحدة", "المطلوب", "الممسوح", "الناقص"]];
  report.shortages.forEach((r, i) => short.push([r.orderNo, r.invoices, r.code, r.unit, r.expected, r.scanned, r.expected - r.scanned]));
  const shortWs = sheet(XLSX, short, [18, 20, 18, 12, 10, 10, 10]);
  // عمود الناقص بمعادلة حقيقية = المطلوب − الممسوح
  for (let r = 1; r < short.length; r += 1) shortWs[XLSX.utils.encode_cell({ r, c: 6 })] = { t: "n", v: short[r][6] as number, f: `E${r + 1}-F${r + 1}` };
  withTotal(XLSX, shortWs, short, "الإجمالي", 0, [4, 5, 6]);
  XLSX.utils.book_append_sheet(wb, shortWs, "النواقص");

  const print: Cell[][] = [["رقم الطلب", "المستند", "الحالة", "الملف", "تفاصيل", "آخر تحديث"]];
  report.printLog.forEach((r) => print.push([r.orderNo, PRINT_KIND_LABELS[r.kind], PRINT_STATUS_LABELS[r.status], r.fileName, r.detail, formatDateTime(r.updatedAt)]));
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, print, [18, 12, 16, 28, 40, 20]), "سجل الطباعة");

  wb.Workbook = { Views: wb.SheetNames.map(() => ({ RTL: true })) };
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

/** CSV لحالة الفواتير (RFC 4180، UTF-8 مع BOM، فواصل أسطر CRLF). */
export function invoicesToCsv(invoices: InvoiceView[]): string {
  const cell = (v: unknown) => {
    const t = String(v ?? "");
    return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const rows: Cell[][] = [["رقم الطلب", "الفواتير", "الحالة", "التقدم %", "الأصناف", "الوحدات المطلوبة", "الوحدات الممسوحة", "أصناف ناقصة", "أخطاء تجهيز", "تجهيز زائد"]];
  for (const i of invoices) rows.push([i.order_no, i.invoices ?? "", STATUS_LABEL[i.status] ?? i.status, Math.round(i.progress), i.item_count, i.total_qty, i.done_qty, i.short_items, i.wrong_scans, i.over_scans]);
  return `﻿${rows.map((r) => r.map(cell).join(",")).join("\r\n")}`;
}
