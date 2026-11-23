import { describe, expect, it } from "vitest";
import type { ScanResult } from "../lib/core/engine";
import { applyPrefs, planForFinish, planForScan } from "../lib/feedback";
import type { ImportRow } from "../lib/core/importer";
import { ALERT_TONES, buildWav } from "../lib/tones";
import { makeEngine } from "./helpers/sqlite";

const item = (kind: "ok" | "over" | "wrong", scanned?: number, qty?: number): ScanResult => ({ type: "item", kind, code: "1", orderKey: "o", scanned, qty });

describe("المرحلة 3: خطط التنبيه", () => {
  it("مسح صحيح: نغمة قصيرة + اهتزاز خفيف", () => {
    expect(planForScan(item("ok", 1, 3))).toEqual({ tone: "ok", haptic: "tick" });
  });
  it("اكتمال صنف 100%: نغمة إتمام + اهتزاز مزدوج", () => {
    expect(planForScan(item("ok", 3, 3))).toEqual({ tone: "itemDone", haptic: "double" });
  });
  it("تجاوز الكمية وخطأ/باركود مرفوض: نغمات تحذير مختلفة", () => {
    expect(planForScan(item("over", 4, 3))).toEqual({ tone: "over", haptic: "warn" });
    expect(planForScan(item("wrong"))).toEqual({ tone: "wrong", haptic: "error" });
    expect(planForScan({ type: "order-not-found", code: "x" })).toEqual({ tone: "wrong", haptic: "error" });
    expect(planForScan({ type: "locked", code: "x", orderKey: "o" }).tone).toBe("wrong");
    expect(planForScan({ type: "blocked", code: "x", orderNo: "o", shortItems: 1 }).tone).toBe("blocked");
  });
  it("إغلاق فاتورة تلقائياً ثم اكتمال الجلسة", () => {
    const opened = (outcome: "closed" | "posted"): ScanResult => ({ type: "order-opened", orderKey: "o", orderNo: "o", readonly: false, resumed: false, left: { orderKey: "p", orderNo: "p", outcome, shortItems: 0 } });
    expect(planForScan(opened("closed"))).toEqual({ tone: "invoiceClosed", haptic: "double" });
    expect(planForScan(opened("closed"), { sessionComplete: true })).toEqual({ tone: "sessionDone", haptic: "finale" });
    expect(planForScan(opened("posted")).tone).toBeNull();
  });
  it("إنهاء الفاتورة بالزر", () => {
    expect(planForFinish("closed")).toEqual({ tone: "invoiceClosed", haptic: "double" });
    expect(planForFinish("closed", { sessionComplete: true }).tone).toBe("sessionDone");
    expect(planForFinish("posted").tone).toBe("closed");
    expect(planForFinish(undefined)).toEqual({ tone: null, haptic: null });
  });
  it("نغمة الختام تختلف عن نغمة الصنف العادي وكل النغمات غير صامتة", () => {
    expect(ALERT_TONES.sessionDone).not.toEqual(ALERT_TONES.itemDone);
    expect(ALERT_TONES.sessionDone).not.toEqual(ALERT_TONES.ok);
    const kinds = ["ok", "itemDone", "invoiceClosed", "sessionDone", "wrong", "over", "blocked", "closed"] as const;
    expect(new Set(kinds.map((k) => JSON.stringify(ALERT_TONES[k]))).size).toBe(kinds.length);
    for (const k of kinds) expect(buildWav(ALERT_TONES[k]).length).toBeGreaterThan(44);
  });
  it("الكتم يلغي الصوت فقط وإيقاف الاهتزاز يلغي الاهتزاز فقط", () => {
    const plan = { tone: "wrong", haptic: "error" } as const;
    expect(applyPrefs(plan, { sound: false, vibration: true })).toEqual({ tone: null, haptic: "error" });
    expect(applyPrefs(plan, { sound: true, vibration: false })).toEqual({ tone: "wrong", haptic: null });
    expect(applyPrefs(plan, { sound: false, vibration: false })).toEqual({ tone: null, haptic: null });
  });
  it("منطق المسح لا يتأثر بالتفضيلات: النتائج متطابقة", async () => {
    const run = async () => {
      const e = await makeEngine();
      const rows: ImportRow[] = [{ orderNo: "12345678901234", invoiceNo: "I", itemCode: "1001", unit: "قطعة", qty: 2, sourceRow: 1 }];
      await e.importRows(rows, "x.xlsx");
      const out: ScanResult[] = [];
      for (const code of ["12345678901234", "1001", "1001", "1001", "9999"]) out.push(await e.handleScan(code));
      return out.map((r) => (r.type === "item" ? `${r.kind === "ok" || r.kind === "over" ? "item" : r.kind}:${r.scanned ?? ""}` : r.type));
    };
    const first = await run();
    // التفضيلات تُطبَّق بعد المسح على الخطة فقط، فلا تدخل في المحرك؛ النتيجة ثابتة
    for (const r of [first, await run()]) expect(r).toEqual(["order-opened", "item:1", "item:2", "item:3", "wrong:"]);
  });
});
