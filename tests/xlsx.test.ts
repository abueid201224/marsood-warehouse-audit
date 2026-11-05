import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { inspectWorkbook, mapRows } from "../lib/core/importer";

function workbookBytes(rows: unknown[][], sheet = "Sheet1"): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

describe("قراءة ملفات Excel الفعلية", () => {
  it("xlsx بعناوين عربية وأرقام طويلة", () => {
    const bytes = workbookBytes([
      ["رقم الطلب", "رقم الفاتورة", "كود الصنف", "الوحدة", "الكمية"],
      [12345678901234, "INV-1", 1001, "قطعة", 2],
      ["12345678901234", "INV-1", "0042", "كرتونة", 1],
    ]);
    const preview = inspectWorkbook(XLSX, bytes, "فواتير.xlsx");
    expect(preview.positional).toBe(false);
    const parsed = mapRows(preview, preview.columnMap);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.map((r) => r.itemCode)).toEqual(["1001", "0042"]);
    expect(parsed.rows[0].orderNo).toBe("12345678901234");
    expect(parsed.rows[1].unit).toBe("كرتونة");
  });

  it("xlsx بلا عناوين", () => {
    const preview = inspectWorkbook(XLSX, workbookBytes([["A1", "I1", 55, "pcs", 3], ["A1", "I1", 56, "pcs", 1]]), "f.xlsx");
    expect(preview.positional).toBe(true);
    expect(mapRows(preview, preview.columnMap).rows).toHaveLength(2);
  });

  it("اختيار ورقة العمل", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"]]), "ملخص");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Order", "Invoice", "Item Code", "Unit", "Qty"], ["O", "I", "5", "u", 1]]), "بيانات");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    const preview = inspectWorkbook(XLSX, bytes, "f.xlsx", 1);
    expect(preview.sheetNames).toEqual(["ملخص", "بيانات"]);
    expect(mapRows(preview, preview.columnMap).rows).toHaveLength(1);
  });

  it("csv بترميز UTF-8 مع BOM يحفظ الأصفار البادئة", () => {
    const csv = "﻿رقم الطلب,رقم الفاتورة,كود الصنف,الوحدة,الكمية\n00123,INV9,0042,قطعة,4\n";
    const preview = inspectWorkbook(XLSX, new TextEncoder().encode(csv), "f.csv");
    const parsed = mapRows(preview, preview.columnMap);
    expect(parsed.rows[0]).toMatchObject({ orderNo: "00123", itemCode: "0042", unit: "قطعة", qty: 4 });
  });
});
