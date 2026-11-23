/**
 * قرارات التنبيه الصوتي والاهتزاز — منطق نقي مفصول عن الصوت والواجهة ليسهل اختباره.
 * كتم الصوت أو الاهتزاز لا يمس منطق المسح أبداً: الدالة تقرّر فقط «ماذا يُعزف» ولا تغيّر النتيجة.
 */
import type { ScanResult } from "./core/engine";
import type { AlertKind } from "./tones";

export type HapticKind = "tick" | "double" | "warn" | "error" | "finale";

export interface FeedbackPlan {
  tone: AlertKind | null;
  haptic: HapticKind | null;
}

export interface FeedbackPrefs {
  sound: boolean;
  vibration: boolean;
}

export const SILENT: FeedbackPlan = { tone: null, haptic: null };

/** تنبيه نتيجة مسحة. sessionComplete: اكتملت كل فواتير الجلسة بعد هذه المسحة. */
export function planForScan(result: ScanResult, opts: { sessionComplete?: boolean } = {}): FeedbackPlan {
  switch (result.type) {
    case "empty":
      return SILENT;
    case "item":
      if (result.kind === "wrong") return { tone: "wrong", haptic: "error" };
      if (result.kind === "over") return { tone: "over", haptic: "warn" };
      // مطابقة: اكتمال الصنف (100%) يختلف عن المسحة العادية
      return result.scanned !== undefined && result.qty !== undefined && result.scanned === result.qty
        ? { tone: "itemDone", haptic: "double" }
        : { tone: "ok", haptic: "tick" };
    case "order-opened": {
      if (opts.sessionComplete && result.left?.outcome === "closed") return { tone: "sessionDone", haptic: "finale" };
      if (result.left?.outcome === "closed") return { tone: "invoiceClosed", haptic: "double" };
      return { tone: null, haptic: "tick" };
    }
    case "same-order":
      return { tone: null, haptic: "tick" };
    case "blocked":
    case "confirm-switch":
      return { tone: "blocked", haptic: "error" };
    case "already-closed":
      return { tone: "closed", haptic: "warn" };
    case "order-not-found":
    case "not-today":
    case "no-invoice":
    case "locked":
      return { tone: "wrong", haptic: "error" };
  }
}

/** تنبيه إنهاء فاتورة بالزر. */
export function planForFinish(outcome: "closed" | "posted" | "released" | undefined, opts: { sessionComplete?: boolean } = {}): FeedbackPlan {
  if (outcome === "closed") return opts.sessionComplete ? { tone: "sessionDone", haptic: "finale" } : { tone: "invoiceClosed", haptic: "double" };
  if (outcome === "posted") return { tone: "closed", haptic: "warn" };
  return SILENT;
}

/** يطبّق تفضيلات المستخدم: كتم الصوت يلغي النغمة فقط، وإيقاف الاهتزاز يلغي الاهتزاز فقط. */
export function applyPrefs(plan: FeedbackPlan, prefs: FeedbackPrefs): FeedbackPlan {
  return { tone: prefs.sound ? plan.tone : null, haptic: prefs.vibration ? plan.haptic : null };
}
