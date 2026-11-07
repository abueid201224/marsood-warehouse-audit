import { describe, expect, it } from "vitest";
import { layoutFor } from "../lib/layoutCore";

describe("فئات حجم الشاشة", () => {
  it("هاتف عمودي", () => {
    const l = layoutFor(393, 851);
    expect(l).toMatchObject({ sizeClass: "compact", isWide: false, columns: 1, landscape: false, gutter: 14 });
  });
  it("هاتف أفقي أو لوحي صغير", () => {
    expect(layoutFor(700, 400)).toMatchObject({ sizeClass: "medium", isWide: false, columns: 2, landscape: true });
  });
  it("لوحي أفقي", () => {
    expect(layoutFor(1280, 800)).toMatchObject({ sizeClass: "expanded", isWide: true, columns: 3, maxWidth: 1400 });
    expect(layoutFor(960, 600)).toMatchObject({ sizeClass: "expanded", isWide: true, columns: 2, maxWidth: 1120 });
  });
  it("الحدود", () => {
    expect(layoutFor(599, 900).sizeClass).toBe("compact");
    expect(layoutFor(600, 900).sizeClass).toBe("medium");
    expect(layoutFor(840, 900).isWide).toBe(true);
  });
});
