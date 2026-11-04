import { normalizeBarcode } from "../domain/audit";
import { parseLocalizedQuantity } from "./spreadsheet";
import type { PdfLineCandidate } from "./pdf.types";

export function detectPdfLineCandidates(lines: string[]): PdfLineCandidate[] {
  const output: PdfLineCandidate[] = [];
  lines.forEach((sourceText, index) => {
    const tokens = sourceText.trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 3) return;
    const barcodeIndex = tokens.findIndex((token, tokenIndex) => {
      const normalized = normalizeBarcode(token);
      return tokenIndex < tokens.length - 1 &&
        /^[A-Z0-9][A-Z0-9._/-]{5,23}$/.test(normalized) &&
        /\d/.test(normalized) &&
        (normalized.replace(/\D/g, "").length >= 3 || /^\d{8,14}$/.test(normalized));
    });
    if (barcodeIndex < 0) return;
    const expectedQty = parseLocalizedQuantity(tokens[tokens.length - 1]);
    if (expectedQty === undefined || expectedQty <= 0) return;
    const barcode = normalizeBarcode(tokens[barcodeIndex]);
    const description = tokens.filter((_, tokenIndex) => tokenIndex !== barcodeIndex && tokenIndex !== tokens.length - 1).join(" ");
    output.push({ barcode, description, expectedQty, sourceRow: index + 1, sourceText: sourceText.trim(), confidence: "needs-review" });
  });
  return output;
}
