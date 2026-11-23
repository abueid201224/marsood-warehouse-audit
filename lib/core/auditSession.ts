/**
 * AuditSessionEngine: منطق التدقيق النقي (بلا قاعدة بيانات ولا واجهة) لسهولة اختباره بمعزل.
 * - تصنيف المسحة (مطابقة/زائدة).
 * - حساب الفروقات لكل صنف على حدة: عجز صنف لا يُعوَّض بزيادة صنف آخر أبداً.
 * - وضع الأمان الاختياري عند التبديل التلقائي بين الفواتير (مسح مزدوج خلال ثانيتين).
 */

export const SAFE_SWITCH_WINDOW_MS = 2000;

export type ItemScanKind = "ok" | "over";

export interface ItemProgress {
  item_key: string;
  qty: number;
  scanned: number;
}

export interface VarianceSummary {
  lines: number;
  matchedLines: number;
  shortLines: number;
  overLines: number;
  /** مجموع العجز (كل صنف ناقص على حدة) */
  shortUnits: number;
  /** مجموع الزيادة (كل صنف زائد على حدة) */
  overUnits: number;
  requiredUnits: number;
  /** الكمية المطابقة فقط (الزيادة لا تُحتسب ولا تعوّض العجز) */
  acceptedUnits: number;
  /** نسبة الإنجاز 0..100 */
  percent: number;
}

/** المسحة رقم scanned+1 على صنف كميته qty. */
export function classifyItemScan(scanned: number, qty: number): ItemScanKind {
  return scanned + 1 > qty ? "over" : "ok";
}

/** نسبة اكتمال صنف مقيّدة بين 0 و100. */
export function itemPercent(scanned: number, qty: number): number {
  if (!(qty > 0)) return scanned > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((scanned / qty) * 100)));
}

/** الفروقات صنفاً بصنف دون تعويض متبادل. */
export function computeVariances(items: readonly ItemProgress[]): VarianceSummary {
  let matchedLines = 0;
  let shortLines = 0;
  let overLines = 0;
  let shortUnits = 0;
  let overUnits = 0;
  let requiredUnits = 0;
  let acceptedUnits = 0;
  for (const item of items) {
    requiredUnits += item.qty;
    acceptedUnits += Math.min(item.scanned, item.qty);
    if (item.scanned < item.qty) {
      shortLines += 1;
      shortUnits += item.qty - item.scanned;
    } else if (item.scanned > item.qty) {
      overLines += 1;
      overUnits += item.scanned - item.qty;
    } else {
      matchedLines += 1;
    }
  }
  return {
    lines: items.length,
    matchedLines,
    shortLines,
    overLines,
    shortUnits,
    overUnits,
    requiredUnits,
    acceptedUnits,
    percent: requiredUnits > 0 ? Math.round((acceptedUnits / requiredUnits) * 100) : 0,
  };
}

export type SwitchDecision = "proceed" | "confirm";

export class AuditSessionEngine {
  private pending: { code: string; at: number } | null = null;

  constructor(private readonly windowMs = SAFE_SWITCH_WINDOW_MS) {}

  /**
   * قرار التبديل إلى فاتورة جديدة أثناء وجود فاتورة مفتوحة.
   * الوضع القياسي (disabled): يستمر فوراً. وضع الأمان: المسحة الأولى تطلب التأكيد،
   * والمسحة الثانية لنفس الكود خلال النافذة تُنفّذ.
   */
  evaluateSwitch(safeMode: boolean, code: string, nowMs: number): SwitchDecision {
    if (!safeMode) {
      this.pending = null;
      return "proceed";
    }
    const p = this.pending;
    if (p && p.code === code && nowMs - p.at >= 0 && nowMs - p.at <= this.windowMs) {
      this.pending = null;
      return "proceed";
    }
    this.pending = { code, at: nowMs };
    return "confirm";
  }

  clearPending(): void {
    this.pending = null;
  }
}
