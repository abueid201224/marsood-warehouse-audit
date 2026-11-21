import { describe, expect, it } from "vitest";
import {
  PackagingError, BOX_SIZES, applyMainUnit, boxCountOptions, makeRange, breakdown, compose, convert, defaultRules, describeComposite, findOverlaps, findRule, fromPieces,
  parseRules, resolveLine, rulesInScope, toPieces, toScaled, validateRule, type PackRule,
} from "../lib/core/packaging";

const rules = defaultRules();
const rule = (id: string) => rules.find((r) => r.id === id)!;

describe("PackagingEngine: الوحدات", () => {
  it("DZ=2HDZ=12EH", () => {
    expect(toPieces(1, "DZ").pieces).toBe(12);
    expect(toPieces(1, "HDZ").pieces).toBe(6);
    expect(toPieces(2, "HDZ").pieces).toBe(toPieces(1, "DZ").pieces);
    expect(convert(1, "DZ", "HDZ")).toBe(2);
    expect(convert(12, "EH", "DZ")).toBe(1);
    expect(convert(6, "PCS", "HDZ")).toBe(1);
  });
  it("الكسور بـ4 أرقام عشرية: عدد/12", () => {
    expect(fromPieces(1, "DZ")).toBe(0.0833);
    expect(fromPieces(5, "DZ")).toBe(0.4167);
    expect(fromPieces(7, "DZ")).toBe(0.5833);
    expect(fromPieces(11, "DZ")).toBe(0.9167);
    expect(fromPieces(12, "DZ")).toBe(1);
  });
  it("العودة من الكسر المقرّب إلى الحبات دون فقد", () => {
    for (let p = 0; p <= 500; p++) expect(toPieces(fromPieces(p, "DZ"), "DZ").pieces).toBe(p);
  });
  it("لا أخطاء عائمة: 0.1+0.2 وأمثالها", () => {
    expect(toScaled(0.1 + 0.2)).toBe(3000);
    expect(toScaled("0.5")).toBe(5000);
    expect(toScaled("٠٫٥")).toBe(5000);
    expect(toScaled("1e-7")).toBe(0);
    expect(toPieces(0.5, "DZ")).toEqual({ pieces: 6, exact: true });
    expect(toPieces(0.0833, "DZ").pieces).toBe(1);
    expect(toPieces(0.3, "DZ")).toEqual({ pieces: 4, exact: false });
  });
  it("مدخلات غير صالحة تُرفض", () => {
    expect(() => toScaled("abc")).toThrow(PackagingError);
    expect(() => toScaled(NaN)).toThrow(PackagingError);
    expect(() => fromPieces(1.5, "DZ")).toThrow(PackagingError);
    expect(() => toPieces(1, "BOX")).toThrow(PackagingError);
  });
});

describe("PackagingEngine: العبوات والقواعد", () => {
  it("الملابس الداخلية: كرتون=6DZ=12HDZ=72", () => {
    const r = rule("under-drosh");
    expect(toPieces(1, "CARTON", r).pieces).toBe(72);
    expect(convert(1, "CARTON", "DZ", r)).toBe(6);
    expect(convert(1, "CARTON", "HDZ", r)).toBe(12);
    expect(toPieces(1, "BOX", r).pieces).toBe(6);
  });
  it("الفرو والحراري: كرتون=1DZ=2 علبة", () => {
    const r = rule("pj-fleece");
    expect(convert(1, "CARTON", "BOX", r)).toBe(2);
    expect(convert(1, "BOX", "EH", r)).toBe(6);
  });
  it("كمية مركبة 3 كراتين + 5 علب + 2 حبة وعكسها", () => {
    const r = rule("under-drosh");
    const total = compose({ cartons: 3, boxes: 5, pieces: 2 }, r);
    expect(total).toBe(3 * 72 + 5 * 6 + 2);
    expect(breakdown(total, r)).toEqual({ cartons: 3, boxes: 5, pieces: 2 });
    expect(describeComposite(breakdown(total, r))).toBe("3 كرتون + 5 علبة + 2 حبة");
    expect(describeComposite({ cartons: 0, boxes: 0, pieces: 0 })).toBe("0 حبة");
  });
  it("تفكيك/تجميع شامل لعبوات 12–72 حبة وعلب 1–12", () => {
    for (let boxes = 1; boxes <= 12; boxes++) {
      for (let perBox = 1; perBox <= 72; perBox++) {
        const cartonPieces = boxes * perBox;
        if (cartonPieces < 12 || cartonPieces > 72 || !BOX_SIZES.includes(perBox)) continue;
        const r: PackRule = { id: "x", name: "x", from: 1, to: 9, cartonPieces, boxesPerCarton: boxes, issueUnit: "EH", mainUnit: "EH", enabled: true };
        expect(validateRule(r)).toEqual([]);
        for (const p of [0, 1, cartonPieces - 1, cartonPieces, cartonPieces * 3 + perBox + 1, 1000]) expect(compose(breakdown(p, r), r)).toBe(p);
      }
    }
  });
  it("لا قسمة على صفر ولا عبوة غير قابلة للقسمة", () => {
    const bad = { ...rule("shemagh"), boxesPerCarton: 0 };
    expect(validateRule(bad).length).toBeGreaterThan(0);
    expect(() => breakdown(10, bad)).toThrow(PackagingError);
    expect(validateRule({ ...rule("shemagh"), cartonPieces: 20, boxesPerCarton: 3 })).toContain("حبات الكرتون لا تقبل القسمة على عدد العلب");
    expect(validateRule({ ...rule("shemagh"), cartonPieces: 100 }).length).toBeGreaterThan(0);
    expect(validateRule({ ...rule("shemagh"), cartonPieces: 6, boxesPerCarton: 2 }).length).toBeGreaterThan(0);
    expect(validateRule({ ...rule("shemagh"), from: 10, to: 5 })).toContain("باركود البداية أكبر من النهاية");
  });
  it("حجم العلبة: 3/4/5/6 أو درزن 12؛ 7–11 مرفوضة (جزء من الدرزن) ولا علب 8", () => {
    const mk = (perBox: number, boxes: number): PackRule => ({ ...rule("shemagh"), cartonPieces: perBox * boxes, boxesPerCarton: boxes });
    for (const size of [3, 4, 5, 6, 12]) expect(validateRule(mk(size, boxCountOptions(size)[0])), String(size)).toEqual([]);
    for (const size of [7, 8, 9, 10, 11]) expect(validateRule(mk(size, 2)).length, String(size)).toBeGreaterThan(0);
    expect(boxCountOptions(6)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(boxCountOptions(12)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(boxCountOptions(3)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
  it("إضافة مدى أو كود واحد", () => {
    const range = makeRange({ name: "بيجاما 4 درزن", from: 910378600, to: 910378700, boxPieces: 6, boxesPerCarton: 8, issueUnit: "EH", mainUnit: "EH" }, "a");
    expect(range.cartonPieces).toBe(48);
    expect(findRule(910378650, [range])?.id).toBe("a");
    const single = makeRange({ name: "كود", from: 123, boxPieces: 12, boxesPerCarton: 2, issueUnit: "DZ", mainUnit: "DZ" }, "b");
    expect([single.from, single.to, single.cartonPieces]).toEqual([123, 123, 24]);
    expect(() => makeRange({ name: "x", from: 5, to: 1, boxPieces: 6, boxesPerCarton: 2, issueUnit: "EH", mainUnit: "EH" })).toThrow(PackagingError);
    expect(() => makeRange({ name: "x", from: 1, boxPieces: 8, boxesPerCarton: 3, issueUnit: "EH", mainUnit: "EH" })).toThrow(PackagingError);
  });
  it("جدول الشروط الافتراضي صالح ولا تداخل فيه", () => {
    for (const r of rules) expect(validateRule(r), r.name).toEqual([]);
    expect(findOverlaps(rules)).toEqual([]);
  });
});

describe("PackagingEngine: المدى والنطاق", () => {
  it("اختيار القاعدة بحدود المدى الشاملة", () => {
    expect(findRule("114110001", rules)?.id).toBe("under-drosh");
    expect(findRule("115412004", rules)?.id).toBe("under-drosh");
    expect(findRule("115412005", rules)).toBeNull();
    expect(findRule("abc", rules)).toBeNull();
    expect(findRule("0114110001", rules)?.id).toBe("under-drosh");
  });
  it("الأضيق مدىً يفوز عند التداخل ويُبلَّغ عنه", () => {
    const wide = { ...rule("shemagh"), id: "wide" };
    const narrow: PackRule = { ...wide, id: "narrow", from: 600000000, to: 600000100, cartonPieces: 48, boxesPerCarton: 8 };
    expect(findRule(600000050, [wide, narrow])?.id).toBe("narrow");
    expect(findRule(500000000 + 11107155, [narrow, wide])?.id).toBe("wide");
    expect(findOverlaps([wide, narrow]).length).toBe(1);
  });
  it("القاعدة المعطّلة لا تُطبَّق", () => {
    expect(findRule(114110001, [{ ...rule("under-drosh"), enabled: false }])).toBeNull();
  });
  it("نطاق التنفيذ من باركود إلى باركود", () => {
    const scope = { from: 114110001, to: 138412003 };
    expect(findRule(114110001, rules, scope)?.id).toBe("under-drosh");
    expect(findRule(511107155, rules, scope)).toBeNull();
    expect(rulesInScope(rules, scope).map((r) => r.id)).toEqual(["under-drosh", "under-pioneer", "pj-fleece"]);
    expect(() => rulesInScope(rules, { from: 5, to: 1 })).toThrow(PackagingError);
  });
  it("تعيين الوحدة الرئيسية داخل النطاق فقط", () => {
    const out = applyMainUnit(rules, { from: 116100551, to: 116190191 }, "EH");
    expect(out.find((r) => r.id === "pj-fleece")!.mainUnit).toBe("EH");
    expect(out.find((r) => r.id === "shemagh")!.mainUnit).toBe("PCS");
    expect(() => applyMainUnit(rules, { from: 1, to: 2 }, "XX" as never)).toThrow(PackagingError);
  });
});

describe("PackagingEngine: سطور الفواتير", () => {
  it("علبة HDZ في ملابس داخلية: 13 علبة = كرتون + علبة، 6.5 درزن", () => {
    const r = resolveLine("114110001", 13, "HDZ", rules)!;
    expect(r.pieces).toBe(78);
    expect(r.composite).toEqual({ cartons: 1, boxes: 1, pieces: 0 });
    expect(r.inMain).toBe(6.5);
  });
  it("صرف الفرو بالدرزن مع كسر", () => {
    const r = resolveLine("116100551", 1.5, "DZ", rules)!;
    expect(r.pieces).toBe(18);
    expect(r.composite).toEqual({ cartons: 1, boxes: 1, pieces: 0 });
    const frac = resolveLine("116100551", 0.0833, "DZ", rules)!;
    expect(frac.pieces).toBe(1);
  });
  it("وحدة فارغة → وحدة صرف القاعدة؛ EA = EH", () => {
    expect(resolveLine("910371600", 24, "EA", rules)!.composite).toEqual({ cartons: 1, boxes: 0, pieces: 0 });
    expect(resolveLine("511107155", 5, "", rules)!.pieces).toBe(5);
    expect(resolveLine("999", 1, "DZ", rules)).toBeNull();
  });
  it("تحليل القواعد المخزّنة يتجاهل التالف", () => {
    expect(parseRules(null)).toEqual([]);
    expect(parseRules("not json")).toEqual([]);
    expect(parseRules(JSON.stringify([rule("shemagh"), { id: "bad" }])).length).toBe(1);
    expect(parseRules(JSON.stringify(rules)).length).toBe(rules.length);
  });
});
