import { describe, expect, it } from "vitest";
import { codeKey, fitsItemCode, normalizeCode, parseQuantity } from "../lib/core/codes";
import { inspectGrid, mapRows } from "../lib/core/importer";

describe("الأكواد", () => {
  it("يطبّع الأرقام العربية والمسافات", () => {
    expect(normalizeCode(" ١٢٣ 45‏ ")).toBe("12345");
    expect(codeKey("000123")).toBe("123");
    expect(codeKey("ab-01")).toBe("AB-01");
  });
  it("حد العشر خانات", () => {
    expect(fitsItemCode("1234567890")).toBe(true);
    expect(fitsItemCode("12345678901")).toBe(false);
    expect(fitsItemCode("")).toBe(false);
  });
  it("يحلل الكميات", () => {
    expect(parseQuantity("١٢")).toBe(12);
    expect(parseQuantity("1,250")).toBe(1250);
    expect(parseQuantity("2,5")).toBe(2.5);
    expect(parseQuantity("abc")).toBeUndefined();
    expect(parseQuantity(-1)).toBeUndefined();
  });
});

describe("قراءة جدول الأعمدة الخمسة", () => {
  const header = ["رقم الطلب", "رقم الفاتورة", "كود الصنف", "الوحدة", "الكمية"];

  it("يتعرف على العناوين العربية بأي ترتيب", () => {
    const grid = [["الكمية", "الوحدة", "كود الصنف", "رقم الفاتورة", "رقم الطلب"], [3, "قطعة", "1001", "INV1", "5550001112223"]];
    const preview = inspectGrid(grid, "f.xlsx");
    expect(preview.positional).toBe(false);
    expect(preview.columnMap).toEqual({ order: 4, invoice: 3, item: 2, unit: 1, qty: 0, desc: null });
    const parsed = mapRows(preview, preview.columnMap);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ orderNo: "5550001112223", invoiceNo: "INV1", itemCode: "1001", unit: "قطعة", qty: 3 });
  });

  it("يتعرف على العناوين الإنجليزية", () => {
    const preview = inspectGrid([["Order No", "Invoice No", "Item Code", "Unit", "Qty"], ["A1", "I1", "55", "PCS", 2]], "f.xlsx");
    expect(preview.positional).toBe(false);
    expect(mapRows(preview, preview.columnMap).rows[0].qty).toBe(2);
  });

  it("بلا عناوين: يفترض ترتيب الأعمدة الخمسة", () => {
    const preview = inspectGrid([["A1", "I1", "55", "PCS", 2], ["A1", "I1", "56", "PCS", 1]], "f.xlsx");
    expect(preview.positional).toBe(true);
    expect(preview.headerRowIndex).toBe(-1);
    expect(mapRows(preview, preview.columnMap).rows).toHaveLength(2);
  });

  it("عناوين غير معروفة بترتيب افتراضي: الصف الأول عناوين", () => {
    const preview = inspectGrid([["c1", "c2", "c3", "c4", "c5"], ["A1", "I1", "55", "PCS", 2]], "f.xlsx");
    expect(preview.positional).toBe(true);
    expect(preview.headerRowIndex).toBe(0);
    expect(mapRows(preview, preview.columnMap).rows).toHaveLength(1);
  });

  it("يبقي الأرقام الطويلة سليمة ويتجاوز الصفوف الفارغة", () => {
    const preview = inspectGrid([header, [1234567890123, 987, 1001, "ك", 4], ["", "", "", "", ""]], "f.xlsx");
    const parsed = mapRows(preview, preview.columnMap);
    expect(parsed.rows[0].orderNo).toBe("1234567890123");
    expect(parsed.totalRows).toBe(1);
  });

  it("الصفوف المعيبة تُستبعد مع تسجيل السبب لا بصمت", () => {
    const preview = inspectGrid(
      [header, ["", "I", "1", "u", 1], ["O1", "I", "", "u", 1], ["O1", "I", "12345678901", "u", 1], ["O1", "I", "5", "u", "x"], ["O1", "I", "6", "u", 0], ["O1", "I", "7", "u", 2]],
      "f.xlsx",
    );
    const parsed = mapRows(preview, preview.columnMap);
    expect(parsed.rows.map((r) => r.itemCode)).toEqual(["7"]);
    expect(parsed.errors).toHaveLength(5);
    expect(parsed.errors[2].message).toContain("10");
  });

  it("يبلغ عن أعمدة ناقصة", () => {
    const preview = inspectGrid([header, ["O", "I", "1", "u", 1]], "f.xlsx");
    const parsed = mapRows(preview, { ...preview.columnMap, item: null });
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.errors[0].message).toContain("كود الصنف");
  });
});

describe("العمود السادس: بيان الصنف", () => {
  it("يتعرف على ITEM DESQ ولا يخلطه مع كود الصنف", () => {
    const grid = [["Order No", "Invoice No", "Item Code", "Unit", "Qty", "ITEM DESQ"], ["2001234567890", "INV1", "1001", "PCS", 2, "زيت محرك 1 لتر"]];
    const preview = inspectGrid(grid, "f.xlsx");
    expect(preview.columnMap).toEqual({ order: 0, invoice: 1, item: 2, unit: 3, qty: 4, desc: 5 });
    expect(mapRows(preview, preview.columnMap).rows[0]).toMatchObject({ itemCode: "1001", desc: "زيت محرك 1 لتر" });
  });
  it("بلا عناوين: العمود السادس هو البيان، وغيابه لا يمنع الاستيراد", () => {
    const six = inspectGrid([["2001234567890", "I", "1001", "PCS", 2, "وصف"]], "f.xlsx");
    expect(mapRows(six, six.columnMap).rows[0].desc).toBe("وصف");
    const five = inspectGrid([["2001234567890", "I", "1001", "PCS", 2]], "f.xlsx");
    expect(mapRows(five, five.columnMap).rows[0].desc).toBe("");
  });
  it("عنوان عربي «بيان الصنف»", () => {
    const preview = inspectGrid([["رقم الطلب", "رقم الفاتورة", "كود الصنف", "الوحدة", "الكمية", "بيان الصنف"], ["2001234567890", "I", "1001", "قطعة", 1, "x"]], "f.xlsx");
    expect(preview.columnMap.desc).toBe(5);
    expect(preview.columnMap.item).toBe(2);
  });
});
