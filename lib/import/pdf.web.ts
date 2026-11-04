import { detectPdfLineCandidates } from "./pdf-common";
import type { PdfSource, PdfTextResult } from "./pdf.types";
export type { PdfLineCandidate, PdfSource, PdfTextResult } from "./pdf.types";
export { detectPdfLineCandidates } from "./pdf-common";

function groupTextByBaseline(items: { str?: string; transform?: number[] }[]): string[] {
  const rows = new Map<number, { x: number; text: string }[]>();
  for (const item of items) {
    const text = (item.str ?? "").trim();
    if (!text) continue;
    const transform = item.transform ?? [];
    const x = Number(transform[4] ?? 0);
    const y = Number(transform[5] ?? 0);
    const baseline = Math.round(y / 2) * 2;
    const row = rows.get(baseline) ?? [];
    row.push({ x, text });
    rows.set(baseline, row);
  }
  return Array.from(rows.entries())
    .sort(([a], [b]) => b - a)
    .map(([, row]) => row.sort((a, b) => a.x - b.x).map((item) => item.text).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export async function extractPdfText(source: PdfSource): Promise<PdfTextResult> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data: source.bytes,
      disableFontFace: true,
      isEvalSupported: false,
      useWorkerFetch: false,
      useSystemFonts: true,
    });
    const document = await loadingTask.promise;
    if (document.numPages > 300) {
      return { pageCount: document.numPages, lines: [], candidates: [], warning: "يتجاوز PDF حد 300 صفحة لهذه المعاينة المحلية. قسّم المستند وأعد الاستيراد." };
    }
    const lines: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items.filter((item) => "str" in item) as { str?: string; transform?: number[] }[];
      lines.push(...groupTextByBaseline(items));
      if (lines.length > 50_000) {
        return { pageCount: document.numPages, lines: [], candidates: [], warning: "يتجاوز النص حد المعاينة المحلية. قسّم المستند قبل الاستيراد." };
      }
    }
    const candidates = detectPdfLineCandidates(lines);
    if (lines.length === 0) {
      return { pageCount: document.numPages, lines: [], candidates: [], warning: "لم يُستخرج نص من PDF؛ قد يكون ملفاً مصوراً ويحتاج OCR أو إعادة تصدير بنص قابل للبحث." };
    }
    if (candidates.length === 0) {
      return { pageCount: document.numPages, lines, candidates: [], warning: "استُخرج النص لكن لم يتضح نمط أسطر الباركود والكمية. راجع المصدر أو استورد Excel لتجنب تخمين البيانات." };
    }
    return { pageCount: document.numPages, lines, candidates, warning: "هذه معاينة أولية من PDF وليست اعتماداً تلقائياً؛ راجع جميع الأسطر والكميات قبل إنشاء جلسة التدقيق." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "خطأ غير معروف";
    return { pageCount: 0, lines: [], candidates: [], warning: `تعذرت قراءة PDF في معاينة الويب: ${message}. إذا كان المستند مصوراً، يلزم OCR غير متصل أو مصدر Excel.` };
  }
}
