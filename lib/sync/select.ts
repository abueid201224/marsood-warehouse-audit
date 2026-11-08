/** منطق اختيار ملف المزامنة اليومية — بلا اعتماد على React Native ليسهل اختباره. */

export interface SyncFile {
  name: string;
  uri: string;
  size?: number | null;
  modified?: number | null; // بالثواني أو الميلي ثانية؛ يُقارن نسبياً فقط
}

const SHEET_EXT = ["xlsx", "xls", "csv"];

export function decodeName(raw: string): string {
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/** اسم الملف من رابط SAF (…/document/primary%3ADocuments%2Fsync%2Finv.xlsx). */
export function nameFromUri(uri: string): string {
  const decoded = decodeName(uri);
  return decoded.split(/[/:]/).filter(Boolean).pop() ?? decoded;
}

export function isSpreadsheetName(name: string): boolean {
  if (name.startsWith("~$") || name.startsWith(".")) return false; // ملفات Excel المؤقتة والمخفية
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return name.includes(".") && SHEET_EXT.includes(ext);
}

export function syncSignature(file: SyncFile): string {
  return `${file.name}|${file.size ?? 0}|${file.modified ?? 0}`;
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

/** ملفات الجداول فقط، الأحدث أولاً (بتاريخ التعديل إن توفر، وإلا بالاسم الرقمي تنازلياً). */
export function sortSyncFiles(files: SyncFile[]): SyncFile[] {
  return files
    .filter((file) => isSpreadsheetName(file.name))
    .sort((a, b) => {
      const diff = (b.modified ?? 0) - (a.modified ?? 0);
      return diff !== 0 ? diff : naturalCompare(b.name, a.name);
    });
}

/** أحدث ملف لم يُستورد بعد؛ وإلا null. */
export function pickNewestUnprocessed(sorted: SyncFile[], processed: Set<string>): SyncFile | null {
  return sorted.find((file) => !processed.has(syncSignature(file))) ?? null;
}

export function parseProcessed(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function addProcessed(list: string[], signature: string, limit = 200): string[] {
  return [...list.filter((item) => item !== signature), signature].slice(-limit);
}
