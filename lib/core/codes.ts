/** أقصى طول لكود الصنف؛ أي كود أطول من ذلك لا يُعد كود صنف (يُعامل كرقم طلب/بوليصة). */
export const MAX_ITEM_CODE_LENGTH = 10;

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** توحيد الأرقام العربية/الفارسية وحذف المسافات والرموز غير المرئية وتحويل الحروف لكبيرة. */
export function normalizeCode(input: unknown): string {
  return String(input ?? "")
    .replace(/[٠-٩]/g, (char) => String(ARABIC_DIGITS.indexOf(char)))
    .replace(/[۰-۹]/g, (char) => String(PERSIAN_DIGITS.indexOf(char)))
    .replace(/[\s​-‏‪-‮﻿]/g, "")
    .replace(/[\r\n\t]/g, "")
    .toUpperCase();
}

/**
 * مفتاح المقارنة: الأرقام فقط تُجرَّد من الأصفار البادئة (Excel يحذفها غالباً)،
 * وما سواها يبقى كما هو بعد التطبيع.
 */
export function codeKey(input: unknown): string {
  const code = normalizeCode(input);
  if (/^\d+$/.test(code)) return code.replace(/^0+(?=\d)/, "");
  return code;
}

/** هل الكود بطوله يصلح أن يكون كود صنف؟ (حتى 10 خانات). */
export function fitsItemCode(input: unknown): boolean {
  const code = normalizeCode(input);
  return code.length > 0 && code.length <= MAX_ITEM_CODE_LENGTH;
}

/** يحوّل نص كمية (قد يحمل أرقاماً عربية أو فواصل) إلى رقم؛ undefined عند الفشل. */
export function parseQuantity(input: unknown): number | undefined {
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 ? input : undefined;
  let source = String(input ?? "")
    .replace(/[٠-٩]/g, (char) => String(ARABIC_DIGITS.indexOf(char)))
    .replace(/[۰-۹]/g, (char) => String(PERSIAN_DIGITS.indexOf(char)))
    .replace(/[٬\s]/g, "")
    .replace("٫", ".");
  if (!source) return undefined;
  if (source.includes(",") && source.includes(".")) {
    const decimalAt = Math.max(source.lastIndexOf(","), source.lastIndexOf("."));
    source = `${source.slice(0, decimalAt).replace(/[.,]/g, "")}.${source.slice(decimalAt + 1).replace(/[.,]/g, "")}`;
  } else if (source.includes(",")) {
    const groups = source.split(",");
    source = groups.length === 2 && groups[1].length !== 3 ? `${groups[0]}.${groups[1]}` : groups.join("");
  }
  const quantity = Number(source);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : undefined;
}
