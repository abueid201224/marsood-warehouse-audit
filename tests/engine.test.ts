import { beforeEach, describe, expect, it } from "vitest";
import type { AuditEngine } from "../lib/core/engine";
import type { ImportRow } from "../lib/core/importer";
import { makeEngine } from "./helpers/sqlite";

const ORDER_A = "12345678901234"; // رقم طلب بالبوليصة (> 10 خانات)
const ORDER_B = "98765432109876";
let n = 0;
const row = (orderNo: string, invoiceNo: string, itemCode: string, qty: number, unit = "قطعة"): ImportRow => ({
  orderNo, invoiceNo, itemCode, unit, qty, sourceRow: ++n,
});

const SAMPLE: ImportRow[] = [
  row(ORDER_A, "INV-1", "1001", 2),
  row(ORDER_A, "INV-1", "1002", 1),
  row(ORDER_A, "INV-1", "1003", 3, "كرتونة"),
  row(ORDER_B, "INV-2", "2001", 1),
  row(ORDER_B, "INV-2", "2002", 2),
];

let engine: AuditEngine;
beforeEach(async () => {
  engine = await makeEngine();
  await engine.importRows(SAMPLE, "sample.xlsx");
});

describe("الاستخلاص من قاعدة البيانات", () => {
  it("يستخلص الفواتير والبنود بالاستعلامات", async () => {
    const stats = await engine.getStats();
    expect(stats.total).toBe(2);
    expect(stats.remaining).toBe(2);
    const list = await engine.listInvoices();
    expect(list.map((i) => i.order_no).sort()).toEqual([ORDER_A, ORDER_B]);
    const a = list.find((i) => i.order_no === ORDER_A)!;
    expect(a.item_count).toBe(3);
    expect(a.total_qty).toBe(6);
    expect(a.invoices).toBe("INV-1");
    expect(a.progress).toBe(0);
  });

  it("يجمع الأسطر المتكررة لنفس الصنف داخل الطلب", async () => {
    const e = await makeEngine();
    await e.importRows([row("555", "I", "77", 2), row("555", "I", "77", 3)], "dup.xlsx");
    const inv = await e.getInvoice("555");
    expect(inv!.items).toHaveLength(1);
    expect(inv!.items[0].qty).toBe(5);
  });

  it("يطابق الأصفار البادئة وإعادة الاستيراد تستبدل الطلبات غير المبدوءة", async () => {
    const e = await makeEngine();
    await e.importRows([row("00123", "I", "0042", 1)], "a.xlsx");
    const first = await e.handleScan("123");
    expect(first.type).toBe("order-opened");
    const item = await e.handleScan("42");
    expect(item).toMatchObject({ type: "item", kind: "ok" });
  });
});

describe("قواعد المسح", () => {
  it("مسح رقم الطلب يفتح الفاتورة", async () => {
    const r = await engine.handleScan(ORDER_A);
    expect(r).toMatchObject({ type: "order-opened", orderNo: ORDER_A, readonly: false });
    expect(await engine.getCurrent()).toBe(ORDER_A);
    expect((await engine.listInvoices({ status: "open" })).length).toBe(1);
  });

  it("مسح صنف صحيح يزيد التقدم", async () => {
    await engine.handleScan(ORDER_A);
    const r = await engine.handleScan("1001");
    expect(r).toMatchObject({ type: "item", kind: "ok", scanned: 1, qty: 2 });
    const inv = await engine.getInvoice(ORDER_A);
    expect(inv!.invoice.done_qty).toBe(1);
    expect(inv!.invoice.progress).toBe(17); // 1 من 6
  });

  it("كود غير موجود بالفاتورة = خطأ تجهيز ولا يغير الكميات", async () => {
    await engine.handleScan(ORDER_A);
    const r = await engine.handleScan("9999");
    expect(r).toMatchObject({ type: "item", kind: "wrong", code: "9999" });
    const inv = await engine.getInvoice(ORDER_A);
    expect(inv!.invoice.wrong_scans).toBe(1);
    expect(inv!.invoice.done_qty).toBe(0);
  });

  it("مسح أكثر من الكمية = تجهيز زائد (يُسجَّل ويُسمح به)", async () => {
    await engine.handleScan(ORDER_A);
    await engine.handleScan("1002"); // الكمية 1
    const r = await engine.handleScan("1002");
    expect(r).toMatchObject({ type: "item", kind: "over", scanned: 2, qty: 1 });
    const inv = await engine.getInvoice(ORDER_A);
    expect(inv!.invoice.over_scans).toBe(1);
    expect(inv!.invoice.over_items).toBe(1);
    // التقدم لا يتجاوز الكمية المسجلة
    expect(inv!.invoice.done_qty).toBe(1);
  });

  it("الكود الأطول من 10 خانات لا يُعد صنفاً: يُفتح كطلب أو يُرفض", async () => {
    await engine.handleScan(ORDER_A);
    const unknown = await engine.handleScan("11111111111");
    expect(unknown).toMatchObject({ type: "order-not-found" });
    const inv = await engine.getInvoice(ORDER_A);
    expect(inv!.invoice.wrong_scans).toBe(0); // لا يُحتسب خطأ تجهيز على الفاتورة
    const report = await engine.errorReport();
    expect(report.unknown.map((u) => u.code)).toEqual(["11111111111"]);
  });

  it("كود قصير بلا فاتورة مفتوحة يطلب مسح البوليصة أولاً", async () => {
    const r = await engine.handleScan("1001");
    expect(r).toMatchObject({ type: "no-invoice" });
  });

  it("مسح بوليصة أخرى يرحّل الحالية بنواقص ويفتح الجديدة", async () => {
    await engine.handleScan(ORDER_A);
    await engine.handleScan("1001");
    const r = await engine.handleScan(ORDER_B);
    expect(r).toMatchObject({ type: "order-opened", orderNo: ORDER_B });
    expect((r as { left?: { outcome: string } }).left?.outcome).toBe("posted");
    const a = await engine.getInvoice(ORDER_A);
    expect(a!.invoice.status).toBe("posted");
  });

  it("مسح بوليصة أخرى دون أي مسح يعيد الحالية جديدة", async () => {
    await engine.handleScan(ORDER_A);
    const r = await engine.handleScan(ORDER_B);
    expect((r as { left?: { outcome: string } }).left?.outcome).toBe("released");
    expect((await engine.getInvoice(ORDER_A))!.invoice.status).toBe("new");
  });

  it("إعادة مسح بوليصة مرحّلة تستأنفها مع الاحتفاظ بالمسحات", async () => {
    await engine.handleScan(ORDER_A);
    await engine.handleScan("1001");
    await engine.handleScan(ORDER_B);
    const r = await engine.handleScan(ORDER_A);
    expect(r).toMatchObject({ type: "order-opened", orderNo: ORDER_A, resumed: true });
    expect((await engine.getInvoice(ORDER_A))!.invoice.done_qty).toBe(1);
  });

  it("مسح البوليصة نفسها مرتين لا يغيّر شيئاً", async () => {
    await engine.handleScan(ORDER_A);
    expect(await engine.handleScan(ORDER_A)).toMatchObject({ type: "same-order" });
  });

  it("يقبل رقم الفاتورة بديلاً عن رقم الطلب", async () => {
    const r = await engine.handleScan("inv-2");
    expect(r).toMatchObject({ type: "order-opened", orderNo: ORDER_B });
  });

  it("الأرقام العربية في المسح تُطبَّع", async () => {
    await engine.handleScan(ORDER_A);
    const r = await engine.handleScan("١٠٠١");
    expect(r).toMatchObject({ type: "item", kind: "ok" });
  });
});

describe("الإنهاء والترحيل", () => {
  it("لا تُقفل الفاتورة بوجود نواقص لكن يُسمح بالترحيل", async () => {
    await engine.handleScan(ORDER_A);
    await engine.handleScan("1001");
    const close = await engine.finishCurrent("close");
    expect(close.ok).toBe(false);
    const post = await engine.finishCurrent("post");
    expect(post).toMatchObject({ ok: true, outcome: "posted" });
    expect(await engine.getCurrent()).toBeNull();
    const stats = await engine.getStats();
    expect(stats.posted).toBe(1);
    expect(stats.closed).toBe(0);
  });

  it("الفاتورة المكتملة تُقفل وتدخل الإحصاءات والرسم الزمني", async () => {
    await engine.handleScan(ORDER_B);
    await engine.handleScan("2001");
    await engine.handleScan("2002");
    await engine.handleScan("2002");
    const done = await engine.finishCurrent("close");
    expect(done).toMatchObject({ ok: true, outcome: "closed" });
    const stats = await engine.getStats();
    expect(stats).toMatchObject({ total: 2, closed: 1, remaining: 1 });
    expect(stats.timeline).toHaveLength(1);
    expect((await engine.getInvoice(ORDER_B))!.invoice.progress).toBe(100);
  });

  it("التجهيز الزائد لا يمنع الإقفال لكنه يبقى في التقرير", async () => {
    await engine.handleScan(ORDER_B);
    await engine.handleScan("2001");
    await engine.handleScan("2001"); // زائد
    await engine.handleScan("2002");
    await engine.handleScan("2002");
    expect((await engine.finishCurrent("close")).ok).toBe(true);
    const report = await engine.errorReport();
    expect(report.over).toHaveLength(1);
    expect(report.over[0]).toMatchObject({ orderNo: ORDER_B, code: "2001", count: 1, expected: 1, scanned: 2 });
  });

  it("الفاتورة المغلقة تُعرض للقراءة فقط ولا تقبل مسح أصناف", async () => {
    await engine.handleScan(ORDER_B);
    for (const c of ["2001", "2002", "2002"]) await engine.handleScan(c);
    await engine.finishCurrent("close");
    const reopened = await engine.handleScan(ORDER_B);
    expect(reopened).toMatchObject({ type: "order-opened", readonly: true });
    expect(await engine.handleScan("2001")).toMatchObject({ type: "locked" });
    expect((await engine.getInvoice(ORDER_B))!.invoice.done_qty).toBe(3);
  });

  it("التراجع عن آخر مسح", async () => {
    await engine.handleScan(ORDER_A);
    await engine.handleScan("1001");
    await engine.handleScan("9999");
    expect(await engine.undoLastScan(ORDER_A)).toMatchObject({ removed: true, code: "9999" });
    expect((await engine.getInvoice(ORDER_A))!.invoice.wrong_scans).toBe(0);
  });
});

describe("التقرير والإحصاء", () => {
  it("يجمع أخطاء التجهيز والنواقص المرحّلة", async () => {
    await engine.handleScan(ORDER_A);
    await engine.handleScan("1001");
    await engine.handleScan("5555");
    await engine.handleScan("5555");
    await engine.finishCurrent("post");
    const report = await engine.errorReport();
    expect(report.wrong).toHaveLength(1);
    expect(report.wrong[0]).toMatchObject({ orderNo: ORDER_A, code: "5555", count: 2 });
    const short = report.shortages.map((s) => `${s.code}:${s.expected - s.scanned}`).sort();
    expect(short).toEqual(["1001:1", "1002:1", "1003:3"]);
    expect(report.stats.wrongScans).toBe(2);
  });

  it("إعادة الاستيراد تتخطى الطلبات التي بدأت مراجعتها", async () => {
    await engine.handleScan(ORDER_A);
    await engine.handleScan("1001");
    const summary = await engine.importRows([row(ORDER_A, "X", "1001", 9), row("777", "I3", "3001", 1)], "again.xlsx");
    expect(summary.skippedOrders).toEqual([ORDER_A]);
    expect(summary.orders).toBe(1);
    expect((await engine.getInvoice(ORDER_A))!.invoice.total_qty).toBe(6);
    expect((await engine.getStats()).total).toBe(3);
  });

  it("المسحات السريعة المتزامنة تُنفَّذ بالتتابع دون فقد", async () => {
    await engine.handleScan(ORDER_A);
    await Promise.all(["1001", "1001", "1002", "1003", "1003", "1003"].map((c) => engine.handleScan(c)));
    const inv = await engine.getInvoice(ORDER_A);
    expect(inv!.invoice.done_qty).toBe(6);
    expect(inv!.invoice.progress).toBe(100);
  });

  it("resetAll يمسح كل شيء", async () => {
    await engine.handleScan(ORDER_A);
    await engine.resetAll();
    expect((await engine.getStats()).total).toBe(0);
    expect(await engine.getCurrent()).toBeNull();
  });
});
