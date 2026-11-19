import * as FS from "expo-file-system/legacy";
import * as Print from "expo-print";
import type { AuditEngine } from "@/lib/core/engine";
import { buildReportHtml, reportToCsv } from "@/lib/core/report";
import { BACKUP_FOLDER_KEY } from "@/lib/backup/files";
import { SYNC_FOLDER_KEY } from "@/lib/sync/folder";
import { buildReportWorkbook, invoicesToCsv } from "./workbook";

export const EXPORT_FOLDER_KEY = "export:folder";
export type ExportKind = "xlsx" | "csv" | "invoices-csv" | "pdf";

const META: Record<ExportKind, { ext: string; mime: string; label: string }> = {
  xlsx: { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "Excel" },
  csv: { ext: "csv", mime: "text/csv", label: "CSV" },
  "invoices-csv": { ext: "csv", mime: "text/csv", label: "CSV" },
  pdf: { ext: "pdf", mime: "application/pdf", label: "PDF" },
};

function stamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}`;
}

export async function pickExportFolder(engine: AuditEngine): Promise<string | null> {
  const result = await FS.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!result.granted) return null;
  await engine.setSetting(EXPORT_FOLDER_KEY, result.directoryUri);
  return result.directoryUri;
}

/** مجلد الحفظ: مجلد التصدير، ثم النسخ الاحتياطي، ثم المزامنة؛ وإلا يُطلب اختيار مجلد (SAF). */
export async function resolveExportFolder(engine: AuditEngine, allowPrompt = true): Promise<string | null> {
  for (const key of [EXPORT_FOLDER_KEY, BACKUP_FOLDER_KEY, SYNC_FOLDER_KEY]) {
    const uri = await engine.getSetting(key);
    if (uri) return uri;
  }
  return allowPrompt ? pickExportFolder(engine) : null;
}

async function writeFile(folder: string, base: string, kind: ExportKind, payload: { text?: string; base64?: string }): Promise<string> {
  const meta = META[kind];
  const uri = await FS.StorageAccessFramework.createFileAsync(folder, base, meta.mime);
  if (payload.base64 !== undefined) await FS.writeAsStringAsync(uri, payload.base64, { encoding: FS.EncodingType.Base64 });
  else await FS.writeAsStringAsync(uri, payload.text ?? "");
  return uri;
}

/** يُنشئ ملف التقرير (Excel / CSV / PDF) ويحفظه في مجلد عبر Storage Access Framework — كله بلا إنترنت. */
export async function exportReport(engine: AuditEngine, kind: ExportKind): Promise<{ name: string; folderLabel: string }> {
  const folder = await resolveExportFolder(engine);
  if (!folder) throw new Error("لم يُختر مجلد للحفظ.");
  const [report, invoices] = await Promise.all([engine.errorReport(), engine.listInvoices({ status: "all", limit: 100000 })]);
  const base = `marsood-${kind === "invoices-csv" ? "invoices" : "report"}-${stamp()}`;
  let payload: { text?: string; base64?: string };
  if (kind === "xlsx") {
    const XLSX = await import("xlsx");
    const bytes = buildReportWorkbook(XLSX, report, invoices);
    const { bytesToBase64 } = await import("@/lib/core/base64");
    payload = { base64: bytesToBase64(bytes) };
  } else if (kind === "pdf") {
    const file = await Print.printToFileAsync({ html: buildReportHtml(report) });
    payload = { base64: await FS.readAsStringAsync(file.uri, { encoding: FS.EncodingType.Base64 }) };
  } else if (kind === "csv") {
    payload = { text: reportToCsv(report) };
  } else {
    payload = { text: invoicesToCsv(invoices) };
  }
  await writeFile(folder, base, kind, payload);
  await engine.recordEvent("export", `${base}.${META[kind].ext}`, META[kind].label);
  return { name: `${base}.${META[kind].ext}`, folderLabel: "المجلد المختار" };
}

export function exportLabel(kind: ExportKind): string {
  return META[kind].label;
}

/** يحفظ نص CSV لأسطر استيراد مستبعدة (للتصحيح خارج التطبيق). */
export async function exportImportErrors(engine: AuditEngine, errors: Array<{ sourceRow: number; message: string }>, source: string): Promise<string> {
  const folder = await resolveExportFolder(engine);
  if (!folder) throw new Error("لم يُختر مجلد للحفظ.");
  const cell = (v: unknown) => {
    const t = String(v ?? "");
    return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const text = `﻿${[["الملف", "رقم الصف", "السبب"], ...errors.map((e) => [source, e.sourceRow, e.message])].map((r) => r.map(cell).join(",")).join("\r\n")}`;
  const base = `marsood-import-errors-${stamp()}`;
  await writeFile(folder, base, "csv", { text });
  await engine.recordEvent("export", `${base}.csv`, "أخطاء الاستيراد");
  return `${base}.csv`;
}
