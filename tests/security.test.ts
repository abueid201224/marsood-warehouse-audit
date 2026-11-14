import { beforeEach, describe, expect, it } from "vitest";
import type { AuditEngine } from "../lib/core/engine";
import { hashPin, sha256Hex } from "../lib/core/sha256";
import { memoryDb } from "./helpers/sqlite";
import { makeEngine } from "./helpers/sqlite";

const ORDER = "20012345678901";
const rows = [{ orderNo: ORDER, invoiceNo: "I1", itemCode: "1001", unit: "قطعة", qty: 1, desc: "x", sourceRow: 1 }];

describe("SHA-256", () => {
  it("يطابق المتجهات القياسية", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("a".repeat(1000))).toBe("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
  });
  it("التجزئة مملّحة", () => {
    expect(hashPin("1234", "a", 10)).not.toBe(hashPin("1234", "b", 10));
  });
});

describe("المشغّلون والتدقيق", () => {
  let e: AuditEngine;
  beforeEach(async () => { e = await makeEngine(); });

  it("بلا مشغّلين يعمل كالسابق (وضع قديم)", async () => {
    expect(await e.needsSetup()).toBe(true);
    await e.importRows(rows, "f.xlsx");
    expect((await e.handleScan(ORDER)).type).toBe("order-opened");
  });

  it("أول مشغّل يصبح مشرفاً ويدخل مباشرة، ثم يُشترط الدخول", async () => {
    const boss = await e.createOperator("المشرف", "1234", "operator");
    expect(boss.role).toBe("supervisor");
    await e.logout();
    await expect(e.importRows(rows, "f.xlsx")).rejects.toThrow("سجّل الدخول");
    await expect(e.handleScan(ORDER)).rejects.toThrow("سجّل الدخول");
    expect((await e.login("المشرف", "0000")).ok).toBe(false);
    expect((await e.login("المشرف", "1234")).ok).toBe(true);
  });

  it("القفل بعد 5 محاولات خاطئة", async () => {
    await e.createOperator("سالم", "1234");
    await e.logout();
    for (let i = 0; i < 5; i++) await e.login("سالم", "9999");
    const r = await e.login("سالم", "1234");
    expect(r.ok).toBe(false);
  });

  it("المشغّل العادي لا يدير المشغّلين ولا يستعيد", async () => {
    await e.createOperator("مشرف", "1234");
    await e.createOperator("عامل", "5678", "operator");
    await e.logout();
    await e.login("عامل", "5678");
    await expect(e.createOperator("آخر", "1111")).rejects.toThrow("للمشرف");
    await expect(e.listOperators()).rejects.toThrow("للمشرف");
    await expect(e.auditLog()).rejects.toThrow("للمشرف");
    await expect(e.resetAll()).rejects.toThrow("للمشرف");
  });

  it("يُسجَّل اسم المشغّل في المسحات والتدقيق، والسجل للإضافة فقط", async () => {
    await e.createOperator("سالم", "1234");
    await e.importRows(rows, "f.xlsx");
    await e.handleScan(ORDER);
    await e.handleScan("1001");
    await e.finishCurrent("close");
    const log = await e.auditLog();
    const events = log.map((l) => l.event);
    for (const ev of ["setup", "import", "open", "close"]) expect(events.includes(ev)).toBe(true);
    expect(log.every((l) => l.operator === "سالم")).toBe(true);
    expect((await e.errorReport()).wrong).toHaveLength(0);
    // محاولة العبث بالسجل تفشل
    const db = (e as unknown as { db: { run: (s: string) => Promise<unknown> } }).db;
    await expect(db.run("UPDATE audit_log SET event = 'x'")).rejects.toThrow("append-only");
    await expect(db.run("DELETE FROM audit_log")).rejects.toThrow("append-only");
  });

  it("لا يعطّل المشرف الوحيد ولا نفسه", async () => {
    const boss = await e.createOperator("مشرف", "1234");
    await expect(e.setOperatorActive(boss.id, false)).rejects.toThrow("حسابك الحالي");
  });
});

describe("النسخ الاحتياطي والاستعادة", () => {
  it("لقطة ثم استعادة تعيد الحالة كاملة دون المساس بالسجل", async () => {
    const e = await makeEngine();
    await e.importRows(rows, "f.xlsx");
    await e.handleScan(ORDER);
    await e.handleScan("1001");
    const snap = JSON.parse(JSON.stringify(await e.exportSnapshot()));
    await e.finishCurrent("close");
    await e.resetAll();
    expect((await e.getStats()).total).toBe(0);
    const r = await e.restoreSnapshot(snap);
    expect(r.rows).toBeGreaterThan(0);
    const stats = await e.getStats();
    expect(stats.total).toBe(1);
    const inv = await e.getInvoice(ORDER);
    expect(inv!.items[0].scanned).toBe(1);
    expect(inv!.items[0].item_desc).toBe("x");
    expect(await e.getCurrent()).toBe(ORDER);
  });

  it("يرفض ملفاً غير صالح", async () => {
    const e = await makeEngine();
    await expect(e.restoreSnapshot({ app: "other" } as never)).rejects.toThrow("ليس نسخة");
  });

  it("ملف قديم بقاعدة بلا عمود الوصف يُرقّى بلا فقد", async () => {
    const db = memoryDb();
    await db.exec("CREATE TABLE lines (id INTEGER PRIMARY KEY AUTOINCREMENT, import_id INTEGER, src_row INTEGER, order_no TEXT NOT NULL, order_key TEXT NOT NULL, invoice_no TEXT NOT NULL DEFAULT '', invoice_key TEXT NOT NULL DEFAULT '', item_code TEXT NOT NULL, item_key TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '', qty REAL NOT NULL)");
    await db.run("INSERT INTO lines (order_no, order_key, item_code, item_key, qty) VALUES ('1','1','5','5',2)");
    const { AuditEngine } = await import("../lib/core/engine");
    const e = new AuditEngine(db);
    await e.init();
    expect((await e.getStats()).total).toBe(1);
  });
});
