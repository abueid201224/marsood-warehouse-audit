import { codeKey } from "../core/codes";
import type { PrintFileEntry, PrintKind } from "../core/engine";

/** اسم الملف من رابط SAF (content://…/document/primary%3ADocuments%2Fsub%2F123_b_Invoice.pdf). */
export function fileNameFromUri(uri: string): string {
  const marker = "/document/";
  const at = uri.lastIndexOf(marker);
  const tail = at >= 0 ? uri.slice(at + marker.length) : uri;
  let decoded = tail;
  try {
    decoded = decodeURIComponent(tail);
  } catch {
    // رابط غير مرمّز بالكامل: نستخدمه كما هو
  }
  const base = decoded.split("/").pop() ?? decoded;
  const colon = base.lastIndexOf(":");
  return colon >= 0 ? base.slice(colon + 1) : base;
}

/** اسم المجلد المعروض للمستخدم من رابط شجرة SAF. */
export function folderLabel(uri: string): string {
  const marker = "/tree/";
  const at = uri.indexOf(marker);
  const tail = (at >= 0 ? uri.slice(at + marker.length) : uri).split("/document/")[0];
  let decoded = tail;
  try {
    decoded = decodeURIComponent(tail);
  } catch {
    // كما هو
  }
  return decoded.replace(/^primary:/, "الذاكرة الداخلية/");
}

const PATTERNS: Array<{ kind: PrintKind; re: RegExp }> = [
  { kind: "invoice", re: /^(.+)_b_invoice\.pdf$/i },
  { kind: "label", re: /^(.+)_c_label\.pdf$/i },
];

/** «123_b_Invoice.pdf» => فاتورة مرجعها 123؛ «123_c_Label.pdf» => بوليصة مرجعها 123. */
export function parsePdfName(name: string): { kind: PrintKind; ref: string } | null {
  for (const { kind, re } of PATTERNS) {
    const match = re.exec(name.trim());
    if (match && match[1].trim()) return { kind, ref: match[1].trim() };
  }
  return null;
}

export function buildIndex(files: Array<{ name: string; uri: string }>): PrintFileEntry[] {
  const entries = new Map<string, PrintFileEntry>();
  for (const file of files) {
    const parsed = parsePdfName(file.name);
    if (!parsed) continue;
    const refKey = codeKey(parsed.ref);
    entries.set(`${refKey}|${parsed.kind}`, { refKey, kind: parsed.kind, name: file.name, uri: file.uri });
  }
  return Array.from(entries.values());
}
