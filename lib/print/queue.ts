import type { AuditEngine, PrintKind } from "../core/engine";
import { PRINT_SUFFIX } from "../core/engine";
import { printPdf, type IppTransport } from "./ipp";
import { buildIndex } from "./names";

/** تبعيات الإدخال/الإخراج، تُحقن لتسهيل الاختبار دون جهاز. */
export interface PrintDeps {
  listFolder(folderUri: string): Promise<Array<{ name: string; uri: string }>>;
  readFile(uri: string): Promise<Uint8Array>;
  transport: IppTransport;
  sleep(ms: number): Promise<void>;
}

const PRINTER_LABEL: Record<PrintKind, string> = { invoice: "الفواتير", label: "البوليصات" };

export function isPdf(bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, 1024)));
  return head.includes("%PDF-");
}

/** يعيد فهرسة مجلد PDF (الملفات بصيغة «المرجع_b_Invoice.pdf» و«المرجع_c_Label.pdf»). */
export async function reindexFolder(engine: AuditEngine, deps: PrintDeps): Promise<{ invoices: number; labels: number } | null> {
  const cfg = await engine.getPrintConfig();
  if (!cfg.folder) return null;
  const files = await deps.listFolder(cfg.folder);
  return engine.replacePrintIndex(buildIndex(files));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function drain(engine: AuditEngine, deps: PrintDeps): Promise<void> {
  let reindexed = false;
  for (;;) {
    const job = await engine.nextPrintJob();
    if (!job) return;
    const cfg = await engine.getPrintConfig();
    const printer = job.kind === "invoice" ? cfg.invoicePrinter : cfg.labelPrinter;
    if (!printer) {
      await engine.finishPrintJob(job.orderKey, job.kind, "failed", `لم تُضبط طابعة ${PRINTER_LABEL[job.kind]} في الإعدادات.`, null);
      continue;
    }
    let file = await engine.findPrintFile(job.refs, job.kind);
    if (!file && cfg.folder && !reindexed) {
      // قد تكون الملفات أُضيفت بعد آخر فهرسة: نعيد الفهرسة مرة واحدة لكل دفعة
      reindexed = true;
      try {
        await reindexFolder(engine, deps);
      } catch (error) {
        await engine.finishPrintJob(job.orderKey, job.kind, "failed", `تعذرت قراءة مجلد PDF: ${message(error)}`, null);
        continue;
      }
      file = await engine.findPrintFile(job.refs, job.kind);
    }
    if (!file) {
      await engine.finishPrintJob(job.orderKey, job.kind, "missing", `لم يُعثر على ${job.refs[0]}${PRINT_SUFFIX[job.kind]} في المجلد.`, null);
      continue;
    }
    try {
      const bytes = await deps.readFile(file.uri);
      if (!isPdf(bytes)) throw new Error("الملف ليس PDF صالحاً أو فارغ.");
      let failure: unknown = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await printPdf(deps.transport, printer, bytes, file.name);
          failure = null;
          break;
        } catch (error) {
          failure = error;
          if (attempt === 0) await deps.sleep(1500);
        }
      }
      if (failure) throw failure;
      await engine.finishPrintJob(job.orderKey, job.kind, "done", null, file.name);
    } catch (error) {
      await engine.finishPrintJob(job.orderKey, job.kind, "failed", message(error), file.name);
    }
  }
}

let running: Promise<void> | null = null;
let again = false;

/**
 * يعالج طابور الطباعة تتابعياً في الخلفية: مهمة الفاتورة ثم مهمة البوليصة، كلٌّ مهمة مستقلة بحالتها.
 * استدعاؤه أثناء التشغيل لا يبدأ طابوراً ثانياً بل يطلب جولة إضافية.
 */
export function processPrintQueue(engine: AuditEngine, deps: PrintDeps): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await drain(engine, deps);
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}
