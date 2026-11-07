import type { AuditEngine } from "../core/engine";
import { deleteCopiedPdfs, importPdfFiles, listFolderFiles, pickPdfFolder, readFileBytes } from "./folder";
import { getPrinterInfo, printPdf } from "./ipp";
import { buildTestPdf } from "./pdf";
import { processPrintQueue, reindexFolder, type PrintDeps } from "./queue";
import { xhrTransport } from "./transport";

/** الارتباط بمنصة أندرويد: مجلدات SAF + نقل HTTP. */
export const nativeDeps: PrintDeps = {
  listFolder: listFolderFiles,
  readFile: readFileBytes,
  transport: xhrTransport,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** يطلق معالجة الطابعة في الخلفية دون انتظار؛ الأخطاء تُسجَّل في حالة كل مهمة. */
export function kickPrintQueue(engine: AuditEngine): void {
  processPrintQueue(engine, nativeDeps).catch(() => undefined);
}

export async function chooseFolderAndIndex(engine: AuditEngine): Promise<{ uri: string; invoices: number; labels: number } | null> {
  const uri = await pickPdfFolder();
  if (!uri) return null;
  await engine.setSetting("pdf_folder", uri);
  const counts = (await reindexFolder(engine, nativeDeps)) ?? { invoices: 0, labels: 0 };
  return { uri, ...counts };
}

export function reindexNow(engine: AuditEngine) {
  return reindexFolder(engine, nativeDeps);
}

export function inspectPrinter(url: string) {
  return getPrinterInfo(xhrTransport, url);
}

export async function sendTestPage(url: string, label: string) {
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
  await printPdf(xhrTransport, url, buildTestPdf(["Marsood - printer test page", label, stamp]), "Marsood test page");
}

export async function addPdfFiles(engine: AuditEngine): Promise<{ added: number; ignored: number; failed: string[]; invoices: number; labels: number } | null> {
  const result = await importPdfFiles();
  if (!result) return null;
  const counts = await engine.mergePrintIndex(result.entries);
  return { added: result.entries.length, ignored: result.ignored, failed: result.failed, ...counts };
}

export async function clearPdfIndex(engine: AuditEngine): Promise<void> {
  await engine.clearPrintIndex();
  await deleteCopiedPdfs();
}
