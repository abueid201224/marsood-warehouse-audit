import { describe, expect, it } from "vitest";
import { addProcessed, isSpreadsheetName, nameFromUri, parseProcessed, pickNewestUnprocessed, sortSyncFiles, syncSignature } from "../lib/sync/select";

describe("مزامنة المجلد", () => {
  it("يستخرج اسم الملف من رابط SAF", () => {
    expect(nameFromUri("content://x/tree/primary%3ASync/document/primary%3ASync%2Finv_2026-11-04.xlsx")).toBe("inv_2026-11-04.xlsx");
  });
  it("يقبل الجداول فقط ويتجاهل المؤقت والمخفي", () => {
    expect(isSpreadsheetName("a.XLSX")).toBe(true);
    expect(isSpreadsheetName("a.csv")).toBe(true);
    expect(isSpreadsheetName("~$a.xlsx")).toBe(false);
    expect(isSpreadsheetName(".a.xlsx")).toBe(false);
    expect(isSpreadsheetName("a.pdf")).toBe(false);
    expect(isSpreadsheetName("xlsx")).toBe(false);
  });
  it("يرتب الأحدث أولاً بالتاريخ ثم بالاسم الرقمي", () => {
    const sorted = sortSyncFiles([
      { name: "inv_9.xlsx", uri: "a" }, { name: "inv_10.xlsx", uri: "b" }, { name: "x.pdf", uri: "c" },
      { name: "old.xlsx", uri: "d", modified: 1 }, { name: "new.csv", uri: "e", modified: 5 },
    ]);
    expect(sorted.map((f) => f.name)).toEqual(["new.csv", "old.xlsx", "inv_10.xlsx", "inv_9.xlsx"]);
  });
  it("يختار أحدث ملف لم يُستورد", () => {
    const files = sortSyncFiles([{ name: "a.xlsx", uri: "a", modified: 2, size: 10 }, { name: "b.xlsx", uri: "b", modified: 1, size: 9 }]);
    expect(pickNewestUnprocessed(files, new Set())?.name).toBe("a.xlsx");
    expect(pickNewestUnprocessed(files, new Set([syncSignature(files[0])]))?.name).toBe("b.xlsx");
    expect(pickNewestUnprocessed(files, new Set(files.map(syncSignature)))).toBeNull();
  });
  it("تغير الحجم أو التاريخ يعني ملفاً جديداً بنفس الاسم", () => {
    expect(syncSignature({ name: "a.xlsx", uri: "", size: 1, modified: 1 })).not.toBe(syncSignature({ name: "a.xlsx", uri: "", size: 2, modified: 1 }));
  });
  it("سجل المعالجة يتحمل البيانات التالفة ويقتطع", () => {
    expect(parseProcessed("{bad")).toEqual([]);
    expect(parseProcessed(null)).toEqual([]);
    let list: string[] = [];
    for (let i = 0; i < 250; i++) list = addProcessed(list, `s${i}`);
    expect(list).toHaveLength(200);
    expect(list[199]).toBe("s249");
    expect(addProcessed(["a", "b"], "a")).toEqual(["b", "a"]);
  });
});
