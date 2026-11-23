import { describe, expect, it } from "vitest";
import { AuditSessionEngine, classifyItemScan, computeVariances, itemPercent } from "../lib/core/auditSession";
import type { ImportRow } from "../lib/core/importer";
import { makeEngine } from "./helpers/sqlite";

const A = "12345678901234";
const B = "98765432109876";
let n = 0;
const row = (o: string, i: string, code: string, qty: number): ImportRow => ({ orderNo: o, invoiceNo: i, itemCode: code, unit: "قطعة", qty, sourceRow: ++n });

/** ساعة يدوية بالمللي ثانية لاختبار نافذة الثانيتين. */
function clock(start = Date.UTC(2026, 10, 5, 8, 0, 0)) {
  let t = start;
  return { now: () => new Date(t).toISOString(), advance: (ms: number) => { t += ms; } };
}

describe("AuditSessionEngine (منطق نقي)", () => {
  it("تصنيف المسحة ونسبة الصنف", () => {
    expect(classifyItemScan(0, 2)).toBe("ok");
    expect(classifyItemScan(1, 2)).toBe("ok");
    expect(classifyItemScan(2, 2)).toBe("over");
    expect(itemPercent(1, 4)).toBe(25);
    expect(itemPercent(9, 4)).toBe(100);
    expect(itemPercent(0, 0)).toBe(0);
  });
  it("عجز صنف لا يُعوَّض بزيادة صنف آخر", () => {
    const v = computeVariances([
      { item_key: "a", qty: 5, scanned: 3 }, // عجز 2
      { item_key: "b", qty: 2, scanned: 4 }, // زيادة 2
      { item_key: "c", qty: 1, scanned: 1 },
    ]);
    expect(v).toMatchObject({ shortLines: 1, overLines: 1, matchedLines: 1, shortUnits: 2, overUnits: 2, requiredUnits: 8, acceptedUnits: 6, percent: 75 });
  });
  it("وضع الأمان: مسح مزدوج خلال نافذة 2 ثانية", () => {
    const e = new AuditSessionEngine();
    expect(e.evaluateSwitch(false, "X", 0)).toBe("proceed");
    expect(e.evaluateSwitch(true, "X", 1000)).toBe("confirm");
    expect(e.evaluateSwitch(true, "X", 2500)).toBe("proceed");
    expect(e.evaluateSwitch(true, "X", 3000)).toBe("confirm");
    expect(e.evaluateSwitch(true, "X", 5001)).toBe("confirm"); // بعد النافذة
    expect(e.evaluateSwitch(true, "Y", 5500)).toBe("confirm"); // كود مختلف
    expect(e.evaluateSwitch(true, "X", 5800)).toBe("confirm"); // الطلب المعلّق صار Y
  });
});

describe("المرحلة 1: المحرك", () => {
  it("المسح السريع المتزامن لا يفقد أي قراءة", async () => {
    const e = await makeEngine();
    await e.importRows([row(A, "I", "1001", 100), row(A, "I", "1002", 1)], "x.xlsx");
    await e.handleScan(A);
    const results = await Promise.all(Array.from({ length: 105 }, () => e.handleScan("1001")));
    expect(results.filter((r) => r.type === "item" && r.kind === "ok")).toHaveLength(100);
    expect(results.filter((r) => r.type === "item" && r.kind === "over")).toHaveLength(5);
    const inv = await e.getInvoice(A);
    expect(inv!.items.find((i) => i.item_code === "1001")!.scanned).toBe(105);
  });

  it("الوضع القياسي: الانتقال التلقائي فوري ويغلق المكتملة", async () => {
    const c = clock();
    const e = await makeEngine(c.now);
    await e.importRows([row(A, "I1", "1001", 1), row(B, "I2", "2001", 1)], "x.xlsx");
    await e.handleScan(A);
    await e.handleScan("1001");
    const r = await e.handleScan(B);
    expect(r).toMatchObject({ type: "order-opened", left: { outcome: "closed" } });
  });

  it("وضع الأمان: تأكيد بمسحة ثانية خلال ثانيتين، وإلا يُعاد الطلب", async () => {
    const c = clock();
    const e = await makeEngine(c.now);
    await e.importRows([row(A, "I1", "1001", 1), row(B, "I2", "2001", 1)], "x.xlsx");
    await e.setSetting("safe_switch", "1");
    await e.handleScan(A);
    await e.handleScan("1001");
    expect(await e.handleScan(B)).toMatchObject({ type: "confirm-switch", targetNo: B });
    expect((await e.getCurrent())).toBe(A); // لم يحدث انتقال
    c.advance(3000);
    expect((await e.handleScan(B)).type).toBe("confirm-switch"); // تجاوزت النافذة
    c.advance(1000);
    expect(await e.handleScan(B)).toMatchObject({ type: "order-opened", left: { outcome: "closed" } });
    expect(await e.getCurrent()).toBe(B);
  });

  it("وضع الأمان لا يتدخل في المنع عند وجود نواقص ولا في مسح الأصناف", async () => {
    const e = await makeEngine(clock().now);
    await e.importRows([row(A, "I1", "1001", 2), row(B, "I2", "2001", 1)], "x.xlsx");
    await e.setSetting("safe_switch", "1");
    await e.handleScan(A);
    expect(await e.handleScan("1001")).toMatchObject({ type: "item", kind: "ok" });
    expect((await e.handleScan(B)).type).toBe("blocked");
  });

  it("إعادة فتح فاتورة وإغلاقها لا تكرر الفروقات", async () => {
    const e = await makeEngine();
    await e.importRows([row(A, "I1", "1001", 1), row(A, "I1", "1002", 1)], "x.xlsx");
    await e.handleScan(A);
    await e.handleScan("1001");
    await e.handleScan("1001"); // زيادة
    await e.handleScan("1002");
    await e.handleScan("9999"); // خطأ تجهيز
    await e.finishCurrent("close");
    const before = await e.errorReport();
    for (let i = 0; i < 3; i++) {
      await e.reopenInvoice(A);
      await e.finishCurrent("close");
    }
    const after = await e.errorReport();
    expect(after.over.map((r) => [r.code, r.count])).toEqual(before.over.map((r) => [r.code, r.count]));
    expect(after.wrong.map((r) => [r.code, r.count])).toEqual(before.wrong.map((r) => [r.code, r.count]));
    expect(after.shortages).toEqual(before.shortages);
    expect(before.over).toHaveLength(1);
    expect(before.wrong).toHaveLength(1);
  });

  it("معرّف الجلسة ونقطة الحفظ وتجدّد المعرّف عند دفعة جديدة", async () => {
    const c = clock();
    const e = await makeEngine(c.now);
    await e.importRows([row(A, "I1", "1001", 1)], "x.xlsx");
    const s1 = await e.sessionInfo();
    expect(s1.id).toMatch(/^S\d{14}-/);
    expect((await e.sessionInfo()).id).toBe(s1.id);
    expect(s1.checkpointAt).toBeNull();
    c.advance(5000);
    await e.handleScan(A);
    const s2 = await e.sessionInfo();
    expect(s2.id).toBe(s1.id);
    expect(s2.checkpointAt).not.toBeNull();
    expect((await e.errorReport()).sessionId).toBe(s1.id);
    c.advance(5000);
    await e.resetAll();
    expect((await e.sessionInfo()).id).not.toBe(s1.id);
  });

  it("اكتمال كل فواتير الجلسة يعطي تقريراً شاملاً", async () => {
    const e = await makeEngine();
    await e.importRows([row(A, "I1", "1001", 1), row(B, "I2", "2001", 2)], "x.xlsx");
    await e.handleScan(A);
    await e.handleScan("1001");
    await e.handleScan(B);
    await e.handleScan("2001");
    await e.handleScan("2001");
    await e.finishCurrent("close");
    const report = await e.errorReport();
    expect(report.stats.remaining).toBe(0);
    expect(report.stats.total).toBe(2);
    expect(report.shortages).toHaveLength(0);
  });
});
