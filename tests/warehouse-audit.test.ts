import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import {
  adjustScannedQuantity,
  applyBarcodeScan,
  canCompleteSession,
  completeSession,
  createAuditSession,
  getLineState,
  getSessionSummary,
  normalizeBarcode,
  resolveAmbiguousScan,
} from "../lib/domain/audit";
import { detectPdfLineCandidates } from "../lib/import/pdf-common";
import { extractPdfText } from "../lib/import/pdf.web";
import { groupImportRows, inspectWorkbook, mapWorkbookRows, parseLocalizedQuantity } from "../lib/import/spreadsheet";

function makeWorkbook(): Uint8Array {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["تقرير حركة المخزون"],
    ["رقم الفاتورة", "باركود", "اسم الصنف", "الكمية"],
    ["INV-10", "٠٠١٢٣٤٥٦٧٨٩٠", "قلم أزرق", "٢"],
    ["INV-10", "001234567890", "قلم أزرق - لون آخر", "١٬٢٥٠"],
    ["INV-11", "009998887776", "دفتر", "3"],
    ["INV-11", "", "سطر ناقص", "1"],
  ]);
  XLSX.utils.book_append_sheet(book, sheet, "الفواتير");
  return new Uint8Array(XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer);
}

describe("warehouse quantity and barcode rules", () => {
  it("normalizes Arabic and Persian barcode digits without dropping leading zeroes", () => {
    expect(normalizeBarcode(" ٠٠١٢٣٤ ")).toBe("001234");
    expect(normalizeBarcode(" ۰۰۱abc ")).toBe("001ABC");
  });

  it("records one HID scan per unit and reports short or over quantities", () => {
    const source = createAuditSession("INV-1", "invoice.xlsx", [
      { barcode: "012345678901", description: "Box", expectedQty: 2, sourceRow: 2 },
    ], "2026-01-01T00:00:00.000Z");
    const first = applyBarcodeScan(source, "٠١٢٣٤٥٦٧٨٩٠١", "2026-01-01T00:00:01.000Z");
    expect(first.kind).toBe("recorded");
    if (first.kind !== "recorded") return;
    expect(first.item.scannedQty).toBe(1);
    expect(getLineState(first.item)).toBe("short");
    const second = applyBarcodeScan(first.session, "012345678901", "2026-01-01T00:00:02.000Z");
    expect(second.kind).toBe("recorded");
    if (second.kind !== "recorded") return;
    expect(getLineState(second.item)).toBe("matched");
    const over = applyBarcodeScan(second.session, "012345678901", "2026-01-01T00:00:03.000Z");
    expect(over.kind).toBe("recorded");
    if (over.kind !== "recorded") return;
    expect(over.overage).toBe(true);
    expect(getLineState(over.item)).toBe("over");
    expect(getSessionSummary(over.session).openExceptions).toBe(1);
    expect(canCompleteSession(over.session)).toBe(false);
  });

  it("counts consecutive scans of the same barcode as separate units", () => {
    const session = createAuditSession("INV-REPEAT", "invoice.xlsx", [
      { barcode: "222333", description: "Repeated item", expectedQty: 3, sourceRow: 2 },
    ]);
    const first = applyBarcodeScan(session, "222333");
    if (first.kind !== "recorded") throw new Error("expected first scan to be recorded");
    const second = applyBarcodeScan(first.session, "222333");
    expect(second.kind).toBe("recorded");
    if (second.kind !== "recorded") return;
    expect(second.item.scannedQty).toBe(2);
    expect(second.session.events.filter((event) => event.kind === "scan")).toHaveLength(2);
  });

  it("keeps unknown barcodes as unresolved exceptions without changing invoice lines", () => {
    const session = createAuditSession("INV-2", "invoice.xlsx", [
      { barcode: "000001", description: "Item", expectedQty: 1, sourceRow: 2 },
    ]);
    const result = applyBarcodeScan(session, "999999");
    expect(result.kind).toBe("unknown");
    if (result.kind !== "unknown") return;
    expect(result.session.items[0]?.scannedQty).toBe(0);
    expect(result.session.exceptions[0]?.state).toBe("open");
    expect(result.session.events[0]?.kind).toBe("unknown-scan");
    expect(canCompleteSession(result.session)).toBe(false);
  });

  it("does not choose duplicate-barcode invoice lines automatically", () => {
    const session = createAuditSession("INV-3", "invoice.xlsx", [
      { barcode: "AB123456", description: "First line", expectedQty: 1, sourceRow: 2 },
      { barcode: "AB123456", description: "Second line", expectedQty: 1, sourceRow: 3 },
    ]);
    const result = applyBarcodeScan(session, "AB123456");
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") return;
    expect(result.candidates).toHaveLength(2);
    expect(result.session.items.every((item) => item.scannedQty === 0)).toBe(true);
    const resolved = resolveAmbiguousScan(result.session, result.exception.id, result.candidates[1]!.id);
    expect(resolved.items[0]?.scannedQty).toBe(0);
    expect(resolved.items[1]?.scannedQty).toBe(1);
    expect(resolved.exceptions[0]?.state).toBe("resolved");
  });

  it("requires a reason for manual quantity edits and records the reason", () => {
    const session = createAuditSession("INV-4", "invoice.xlsx", [
      { barcode: "ZX987654", description: "Widget", expectedQty: 2, sourceRow: 2 },
    ]);
    const rejected = adjustScannedQuantity(session, session.items[0]!.id, 2, "  ");
    expect(rejected.error).toContain("سبب");
    const accepted = adjustScannedQuantity(session, session.items[0]!.id, 2, "مراجعة الرف الفعلي");
    expect(accepted.session?.items[0]?.scannedQty).toBe(2);
    expect(accepted.session?.events.at(-1)?.kind).toBe("manual-adjustment");
    expect(accepted.session?.events.at(-1)?.note).toBe("مراجعة الرف الفعلي");
  });

  it("allows closure only after each line matches and exceptions are closed", () => {
    const session = createAuditSession("INV-5", "invoice.xlsx", [
      { barcode: "AB000001", description: "A", expectedQty: 1, sourceRow: 2 },
      { barcode: "AB000002", description: "B", expectedQty: 2, sourceRow: 3 },
    ]);
    const one = applyBarcodeScan(session, "AB000001");
    if (one.kind !== "recorded") throw new Error("expected a recorded scan");
    const two = applyBarcodeScan(one.session, "AB000002");
    if (two.kind !== "recorded") throw new Error("expected a recorded scan");
    expect(canCompleteSession(two.session)).toBe(false);
    const three = applyBarcodeScan(two.session, "AB000002");
    if (three.kind !== "recorded") throw new Error("expected a recorded scan");
    expect(canCompleteSession(three.session)).toBe(true);
    expect(completeSession(three.session).state).toBe("complete");
  });
});

describe("local file import validation", () => {
  it("detects Arabic headers after a preamble and groups duplicate lines by invoice", () => {
    const preview = inspectWorkbook(makeWorkbook(), "orders.xlsx");
    expect(preview.headerRowIndex).toBe(1);
    expect(preview.columnMap.barcode).toBe(1);
    expect(preview.columnMap.quantity).toBe(3);
    const mapped = mapWorkbookRows(preview, preview.columnMap);
    expect(mapped.rows).toHaveLength(3);
    expect(mapped.errors).toHaveLength(1);
    expect(mapped.rows[0]?.barcode).toBe("001234567890");
    expect(mapped.rows[1]?.expectedQty).toBe(1250);
    expect(groupImportRows(mapped.rows).map((group) => group.invoiceNumber)).toEqual(["INV-10", "INV-11"]);
    expect(groupImportRows(mapped.rows)[0]?.rows).toHaveLength(2);
  });

  it("parses Arabic decimal/thousands separators conservatively", () => {
    expect(parseLocalizedQuantity("١٬٢٥٠")).toBe(1250);
    expect(parseLocalizedQuantity("١٫٥")).toBe(1.5);
    expect(parseLocalizedQuantity("۱۲٫۵")).toBe(12.5);
    expect(parseLocalizedQuantity("1,5")).toBe(1.5);
    expect(parseLocalizedQuantity("1.234,5")).toBe(1234.5);
    expect(parseLocalizedQuantity("غير رقم")).toBeUndefined();
    expect(parseLocalizedQuantity("-2")).toBeUndefined();
  });

  it("extracts cautious PDF row candidates and always marks them for review", () => {
    const candidates = detectPdfLineCandidates([
      "Item name 1234567890123 ٢",
      "غير معروف نص فقط",
      "Another product ZX123456 ١٬٠٠٠",
    ]);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ barcode: "1234567890123", expectedQty: 2, confidence: "needs-review" });
    expect(candidates[1]?.expectedQty).toBe(1000);
  });

  it("extracts text and candidate rows from a synthetic searchable PDF", async () => {
    const bytes = new Uint8Array(readFileSync("tests/fixtures/warehouse-sample.pdf"));
    const result = await extractPdfText({ uri: "file:///warehouse-sample.pdf", bytes });
    expect(result.pageCount).toBe(1);
    expect(result.lines.some((line) => line.includes("Invoice INV-TEST"))).toBe(true);
    expect(result.candidates.map((row) => row.barcode)).toContain("1234567890123");
    expect(result.candidates.map((row) => row.barcode)).toContain("ZX123456");
    expect(result.candidates.every((row) => row.confidence === "needs-review")).toBe(true);
  });

  it("reports corrupt or scanned PDF input without crashing the import flow", async () => {
    const result = await extractPdfText({ uri: "file:///invalid.pdf", bytes: new Uint8Array([1, 2, 3, 4, 5]) });
    expect(result.candidates).toEqual([]);
    expect(result.warning).toContain("PDF");
  });
});
