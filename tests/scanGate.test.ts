import { describe, expect, it } from "vitest";
import { createScanGate, sanitizeScan } from "../lib/scanGate";

describe("بوّابة المسح بالكاميرا", () => {
  it("ينظف المسافات والرموز الخفية", () => {
    expect(sanitizeScan(" 20​01 23﻿\n")).toBe("200123");
    expect(sanitizeScan("‏ ")).toBe("");
  });

  it("الكود الظاهر باستمرار يُقبل مرة واحدة فقط", () => {
    const gate = createScanGate();
    expect(gate.accept("1001", 0)).toBe(true);
    for (let t = 100; t <= 3000; t += 100) expect(gate.accept("1001", t)).toBe(false);
  });

  it("سحب الصنف ثم إعادته يُحتسب مسحة جديدة", () => {
    const gate = createScanGate();
    expect(gate.accept("1001", 0)).toBe(true);
    expect(gate.accept("1001", 200)).toBe(false);
    expect(gate.accept("1001", 1200)).toBe(true); // غاب أكثر من 800ms
  });

  it("كود مختلف يُقبل فوراً بعد الحد الأدنى للفاصل", () => {
    const gate = createScanGate();
    expect(gate.accept("1001", 0)).toBe(true);
    expect(gate.accept("2002", 100)).toBe(false); // أسرع من 350ms
    expect(gate.accept("2002", 500)).toBe(true);
  });

  it("reset يعيد التسليح", () => {
    const gate = createScanGate();
    expect(gate.accept("1001", 0)).toBe(true);
    gate.reset();
    expect(gate.accept("1001", 10)).toBe(true);
  });

  it("يرفض القراءات الفارغة", () => {
    expect(createScanGate().accept("  ​ ", 0)).toBe(false);
  });
});
