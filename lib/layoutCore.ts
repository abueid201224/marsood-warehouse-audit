/** فئات حجم الشاشة وفق إرشادات Material (Window size classes). */
export type SizeClass = "compact" | "medium" | "expanded";

export interface LayoutInfo {
  width: number;
  height: number;
  sizeClass: SizeClass;
  landscape: boolean;
  /** عرض يكفي لتقسيم الشاشة إلى لوحتين (جهاز لوحي أفقي أو هاتف قابل للطي). */
  isWide: boolean;
  gutter: number;
  maxWidth: number;
  /** عدد أعمدة القوائم والبطاقات. */
  columns: 1 | 2 | 3;
  fontScale: number;
}

export function layoutFor(width: number, height: number, fontScale = 1): LayoutInfo {
  const sizeClass: SizeClass = width < 600 ? "compact" : width < 840 ? "medium" : "expanded";
  return {
    width,
    height,
    sizeClass,
    landscape: width > height,
    isWide: width >= 840,
    gutter: sizeClass === "compact" ? 14 : sizeClass === "medium" ? 20 : 28,
    maxWidth: width >= 1200 ? 1400 : 1120,
    columns: width < 600 ? 1 : width < 1100 ? 2 : 3,
    fontScale,
  };
}
