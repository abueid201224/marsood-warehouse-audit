import { describe, expect, it } from "vitest";
import { makeEngine } from "./helpers/sqlite";
import { breakdown, defaultRules, findRule } from "../lib/core/packaging";

const line = (over: Partial<Parameters<Awaited<ReturnType<typeof makeEngine>>["addCountLine"]>[0]> = {}) => ({
  mode: "receive" as const, itemCode: "114110001", cartons: 1, boxes: 2, loose: 3, pieces: 87, mainUnit: "DZ", mainQty: 7.25, ruleName: "x", ...over,
});

describe("الاستلام والجرد", () => {
  it("يسجّل ويجمع الأصناف ويفصل الاستلام عن الجرد", async () => {
    const engine = await makeEngine();
    await engine.addCountLine(line());
    await engine.addCountLine(line({ cartons: 0, boxes: 0, loose: 6, pieces: 6 }));
    await engine.addCountLine(line({ mode: "count", pieces: 10 }));
    const totals = await engine.countTotals("receive");
    expect({ ...totals[0] }).toEqual({ item_code: "114110001", pieces: 93, main_unit: "DZ", entries: 2 });
    expect(totals.length).toBe(1);
    expect((await engine.countTotals("count"))[0].pieces).toBe(10);
    const rule = findRule("114110001", defaultRules())!;
    expect(breakdown(totals[0].pieces, rule)).toEqual({ cartons: 1, boxes: 3, pieces: 3 });
  });
  it("يرفض المدخلات غير الصالحة ويحذف بسجل تدقيق", async () => {
    const engine = await makeEngine();
    await expect(engine.addCountLine(line({ pieces: 0 }))).rejects.toThrow();
    await expect(engine.addCountLine(line({ loose: -1 }))).rejects.toThrow();
    await expect(engine.addCountLine(line({ itemCode: "  " }))).rejects.toThrow();
    const id = await engine.addCountLine(line());
    await engine.deleteCountLine(id);
    expect(await engine.listCountLines("receive")).toEqual([]);
  });
  it("النسخة الاحتياطية تحمل العمليات، والنسخ القديمة بلا الجدول تُستعاد", async () => {
    const engine = await makeEngine();
    await engine.addCountLine(line());
    const snap = await engine.exportSnapshot();
    expect(snap.tables.count_lines.rows.length).toBe(1);
    const old = JSON.parse(JSON.stringify(snap));
    delete old.tables.count_lines;
    await engine.restoreSnapshot(old);
    expect(await engine.listCountLines("receive")).toEqual([]);
    await engine.restoreSnapshot(snap);
    expect((await engine.listCountLines("receive")).length).toBe(1);
  });
});
