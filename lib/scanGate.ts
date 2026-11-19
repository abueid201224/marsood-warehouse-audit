/**
 * بوّابة منع التكرار اللحظي للمسح بالكاميرا (بلا اعتماد على React Native).
 * الكاميرا تكتشف الباركود نفسه عشرات المرات في الثانية، فيُقبل الكود مرة واحدة ما دام ظاهراً أمام العدسة،
 * ولا يُقبل ثانية إلا بعد غيابه `rearmMs` (سحب الصنف ثم إعادته = مسحة جديدة).
 */
export interface ScanGate {
  /** هل تُقبل هذه القراءة؟ (nowMs بالميلي ثانية). */
  accept(code: string, nowMs: number): boolean;
  reset(): void;
}

export function sanitizeScan(raw: string): string {
  return raw.replace(/[\s​-‏‪-‮﻿]/g, "");
}

export function createScanGate(rearmMs = 800, minGapMs = 350): ScanGate {
  let lastCode = "";
  let lastSeen = Number.NEGATIVE_INFINITY;
  let lastAccept = Number.NEGATIVE_INFINITY;
  return {
    accept(raw, nowMs) {
      const code = sanitizeScan(raw);
      if (!code) return false;
      const sameStillInView = code === lastCode && nowMs - lastSeen < rearmMs;
      lastSeen = nowMs;
      if (sameStillInView) return false;
      if (nowMs - lastAccept < minGapMs) {
        // قراءة لكود مختلف بسرعة غير معقولة: تُتجاهل لكن لا تغيّر «الكود الظاهر»
        lastSeen = nowMs;
        return false;
      }
      lastCode = code;
      lastAccept = nowMs;
      return true;
    },
    reset() {
      lastCode = "";
      lastSeen = Number.NEGATIVE_INFINITY;
      lastAccept = Number.NEGATIVE_INFINITY;
    },
  };
}
