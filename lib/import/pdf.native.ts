import { extractText, getPageCount, isAvailable } from "expo-pdf-text-extract";
import { detectPdfLineCandidates } from "./pdf-common";
import type { PdfSource, PdfTextResult } from "./pdf.types";
export type { PdfLineCandidate, PdfSource, PdfTextResult } from "./pdf.types";
export { detectPdfLineCandidates } from "./pdf-common";

export async function extractPdfText(source: PdfSource): Promise<PdfTextResult> {
  if (!isAvailable()) {
    return { pageCount: 0, lines: [], candidates: [], warning: "استخراج PDF الأصلي غير متاح في Expo Go؛ اختبر هذه الميزة عبر APK مبني يتضمن PDFBox." };
  }
  try {
    const pageCount = await getPageCount(source.uri);
    if (pageCount > 300) {
      return { pageCount, lines: [], candidates: [], warning: "يتجاوز PDF حد 300 صفحة. قسّم المستند وأعد الاستيراد." };
    }
    const text = await extractText(source.uri);
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length > 50_000) {
      return { pageCount, lines: [], candidates: [], warning: "يتجاوز النص حد المعاينة المحلية. قسّم المستند قبل الاستيراد." };
    }
    const candidates = detectPdfLineCandidates(lines);
    if (lines.length === 0) {
      return { pageCount, lines: [], candidates: [], warning: "لم يُستخرج نص من PDF؛ قد يكون ملفاً مصوراً ويحتاج OCR غير متصل أو إعادة تصدير بنص قابل للبحث." };
    }
    if (candidates.length === 0) {
      return { pageCount, lines, candidates: [], warning: "استُخرج النص لكن لم يتضح نمط أسطر الباركود والكمية. راجع المصدر أو استورد Excel لتجنب تخمين البيانات." };
    }
    return { pageCount, lines, candidates, warning: "هذه معاينة أولية من PDF وليست اعتماداً تلقائياً؛ راجع جميع الأسطر والكميات قبل إنشاء جلسة التدقيق." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "خطأ غير معروف";
    return { pageCount: 0, lines: [], candidates: [], warning: `تعذرت قراءة PDF محلياً: ${message}. قد يكون الملف محمياً بكلمة مرور أو تالفاً أو مصوراً.` };
  }
}
