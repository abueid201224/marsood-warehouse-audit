import { describe, expect, it } from "vitest";
import { buildReportHtml, reportToCsv } from "../lib/core/report";
import type { ErrorReport } from "../lib/core/engine";

const base: ErrorReport = {
  generatedAt: "2026-11-05T08:00:00.000Z",
  stats: { total: 3, closed: 1, posted: 1, open: 0, fresh: 1, remaining: 2, unknownScans: 0, wrongScans: 1, overScans: 1, timeline: [] },
  wrong: [{ kind: "wrong", orderNo: "123", invoices: "I<1>", code: "9", count: 2, firstAt: "2026-11-05T08:01:00.000Z", expected: null, scanned: null, operator: "سالم" }],
  over: [{ kind: "over", orderNo: "123", invoices: "", code: "5", count: 1, firstAt: "2026-11-05T08:02:00.000Z", expected: 1, scanned: 2, operator: "" }],
  shortages: [{ orderNo: "456", invoices: "I2", code: "7", unit: "كرتونة", expected: 3, scanned: 1 }],
  unknown: [],
  kpis: { acceptedUnits: 3, accuracy: 60, firstPassYield: 50, avgCycleSeconds: 95, activeHours: 0.5, unitsPerHour: 6, invoicesPerHour: 2, remainingUnits: 4, etaMinutes: 40, pareto: [{ code: "9", kind: "wrong", count: 2 }], oldestPostedAt: null },
  printLog: [{ orderNo: "123", invoices: "", kind: "label", status: "missing", detail: "لم يُعثر", fileName: "", updatedAt: "2026-11-05T08:05:00.000Z" }],
};

describe("تقرير الطباعة", () => {
  it("يتضمن الأقسام والأرقام ويهرّب HTML", () => {
    const html = buildReportHtml(base);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("أخطاء التجهيز");
    expect(html).toContain("I&lt;1&gt;");
    expect(html).toContain("<td>2</td>"); // الناقص = 3 - 1
    expect(html).toContain("لا توجد مسحات غير مرتبطة.");
  });
  it("يتضمن المؤشرات وسجل الطباعة والمشغّل", () => {
    const html = buildReportHtml(base);
    expect(html).toContain("مؤشرات الأداء");
    expect(html).toContain("سجل الطباعة الصامتة");
    expect(html).toContain("سالم");
    expect(html).toContain("الملف غير موجود");
  });
  it("يصدّر CSV مع BOM وتهريب الفواصل", () => {
    const csv = reportToCsv({ ...base, wrong: [{ ...base.wrong[0], invoices: 'a,"b"' }] });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"a,""b"""');
    expect(csv.split("\r\n")).toHaveLength(4);
  });
  it("يعرض رسالة بدل الجدول الفارغ", () => {
    const html = buildReportHtml({ ...base, wrong: [], over: [], shortages: [] });
    expect(html).toContain("لا توجد أخطاء تجهيز.");
    expect(html).toContain("لا يوجد تجهيز زائد.");
  });
});
