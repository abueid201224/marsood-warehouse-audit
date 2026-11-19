import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import type { ErrorReport, InvoiceView } from "../lib/core/engine";
import { decodeText, inspectWorkbook, jsonToGrid, mapRows } from "../lib/core/importer";
import { buildReportWorkbook, invoicesToCsv } from "../lib/export/workbook";

const report = {
  generatedAt: "2026-11-02T10:00:00.000Z",
  stats: { total: 3, closed: 1, posted: 1, remaining: 1 },
  wrong: [{ kind: "wrong", orderNo: "2001", invoices: "I1", code: "9999", count: 2, firstAt: "2026-11-02T09:00:00.000Z", expected: null, scanned: null, operator: "سالم" }],
  over: [{ kind: "over", orderNo: "2001", invoices: "I1", code: "1001", count: 1, firstAt: "2026-11-02T09:01:00.000Z", expected: 1, scanned: 2, operator: "سالم" }],
  shortages: [{ orderNo: "2002", invoices: "I2", code: "1002", unit: "قطعة", expected: 5, scanned: 2 }, { orderNo: "2002", invoices: "I2", code: "1003", unit: "", expected: 3, scanned: 0 }],
  unknown: [],
  kpis: { accuracy: 95.5, firstPassYield: 80, unitsPerHour: 120.44, invoicesPerHour: 10, avgCycleSeconds: 90, etaMinutes: null, pareto: [] },
  printLog: [],
} as unknown as ErrorReport;

const invoices = [
  { order_key: "2001", order_no: "2001", invoices: "I1", status: "closed", opened_at: "2026-11-02T08:00:00.000Z", closed_at: "2026-11-02T08:05:00.000Z", posted_at: null, item_count: 2, total_qty: 4, done_qty: 4, done_items: 2, short_items: 0, over_items: 0, wrong_scans: 2, over_scans: 1, progress: 100 },
  { order_key: "2002", order_no: "2002", invoices: "I2, \"x\"", status: "posted", opened_at: null, closed_at: null, posted_at: "2026-11-02T09:00:00.000Z", item_count: 2, total_qty: 8, done_qty: 2, done_items: 0, short_items: 2, over_items: 0, wrong_scans: 0, over_scans: 0, progress: 25 },
] as unknown as InvoiceView[];

describe("تصدير Excel", () => {
  const bytes = buildReportWorkbook(XLSX, report, invoices);
  const wb = XLSX.read(bytes, { type: "array" });

  it("أوراق عربية بالترتيب مع اتجاه RTL", () => {
    expect(wb.SheetNames).toEqual(["الملخص", "حالة الفواتير", "أخطاء التجهيز", "التجهيز الزائد", "النواقص", "سجل الطباعة"]);
    expect(wb.Workbook?.Views?.every((v) => v.RTL)).toBe(true);
  });

  it("الإجماليات والنواقص بمعادلات حقيقية وقيم صحيحة", () => {
    const ws = wb.Sheets["النواقص"];
    expect(ws["G2"].f).toBe("E2-F2");
    expect(ws["G2"].v).toBe(3);
    expect(ws["E4"].f).toBe("SUM(E2:E3)");
    expect(ws["E4"].v).toBe(8);
    expect(ws["G4"].v).toBe(6);
    const inv = wb.Sheets["حالة الفواتير"];
    expect(inv["F4"].f).toBe("SUM(F2:F3)");
    expect(inv["F4"].v).toBe(12);
  });

  it("الأرقام الطويلة والنصوص العربية تبقى سليمة", () => {
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["أخطاء التجهيز"], { header: 1 });
    expect(rows[0][0]).toBe("رقم الطلب");
    expect(rows[1][2]).toBe("9999");
    expect(rows[1][4]).toBe("سالم");
  });

  it("CSV الفواتير: BOM و CRLF وهروب علامات الاقتباس (RFC 4180)", () => {
    const csv = invoicesToCsv(invoices);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv).toContain('"I2, ""x"""');
  });
});

describe("استيراد JSON وUTF-16", () => {
  const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

  it("مصفوفة كائنات بعناوين عربية وإنجليزية", () => {
    const preview = inspectWorkbook(XLSX, enc([
      { "رقم الطلب": 2001234567890, "رقم الفاتورة": "I1", "كود الصنف": "1001", "الوحدة": "قطعة", "الكمية": 2, "ITEM DESQ": "زيت" },
    ]), "d.json");
    const parsed = mapRows(preview, preview.columnMap);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ orderNo: "2001234567890", itemCode: "1001", qty: 2, desc: "زيت" });
  });

  it("كائن يحوي rows، ومصفوفات صفوف", () => {
    expect(jsonToGrid(JSON.stringify({ rows: [["a", "b"], [1, 2]] }))).toEqual([["a", "b"], [1, 2]]);
    expect(jsonToGrid(JSON.stringify([{ a: 1 }, { b: 2 }]))).toEqual([["a", "b"], [1, ""], ["", 2]]);
  });

  it("رسائل خطأ واضحة للملف التالف", () => {
    expect(() => jsonToGrid("{bad")).toThrow("JSON تالف");
    expect(() => jsonToGrid("{}")).toThrow("مصفوفة الأسطر");
    expect(() => jsonToGrid("[]")).toThrow("لا يحتوي");
    expect(() => jsonToGrid("[1,2]")).toThrow("كائناً");
  });

  it("CSV بترميز UTF-16LE (Unicode Text من Excel) يُقرأ صحيحاً", () => {
    const text = "رقم الطلب\tرقم الفاتورة\tكود الصنف\tالوحدة\tالكمية\r\n2001234567890\tI1\t0042\tقطعة\t3";
    const body = new Uint8Array(2 + text.length * 2);
    body[0] = 0xff; body[1] = 0xfe;
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); body[2 + i * 2] = c & 0xff; body[3 + i * 2] = c >> 8; }
    expect(decodeText(body)).toBe(text);
    const preview = inspectWorkbook(XLSX, body, "u16.txt");
    const parsed = mapRows(preview, preview.columnMap);
    expect(parsed.rows[0]).toMatchObject({ itemCode: "0042", qty: 3, unit: "قطعة" });
  });

  it("UTF-8 مع BOM", () => {
    const bytes = new TextEncoder().encode("﻿رقم الطلب,رقم الفاتورة,كود الصنف,الوحدة,الكمية\n2001234567890,I,1,قطعة,1");
    const preview = inspectWorkbook(XLSX, bytes, "a.csv");
    expect(mapRows(preview, preview.columnMap).rows).toHaveLength(1);
  });
});
