export interface PdfSource {
  uri: string;
  bytes: Uint8Array;
}

export interface PdfLineCandidate {
  barcode: string;
  description: string;
  expectedQty: number;
  sourceRow: number;
  sourceText: string;
  confidence: "needs-review";
}

export interface PdfTextResult {
  pageCount: number;
  lines: string[];
  candidates: PdfLineCandidate[];
  warning?: string;
}
