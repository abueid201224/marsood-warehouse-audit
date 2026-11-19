import type { AuditEngine } from "@/lib/core/engine";

/** سجل أعطال محلي: يجمع الأخطاء قبل جاهزية المحرك ثم يفرغها فيه. كله بلا إنترنت. */
const pending: Array<{ source: string; message: string; stack?: string | null }> = [];
let target: AuditEngine | null = null;
let installed = false;

export function reportError(source: string, error: unknown): void {
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error));
  const entry = { source, message: err.message || "خطأ غير معروف", stack: err.stack ?? null };
  if (target) void target.logDiag(entry.source, entry.message, entry.stack);
  else if (pending.length < 50) pending.push(entry);
}

export function attachDiagnostics(engine: AuditEngine): void {
  target = engine;
  while (pending.length > 0) {
    const entry = pending.shift();
    if (entry) void engine.logDiag(entry.source, entry.message, entry.stack);
  }
}

type GlobalWithErrorUtils = {
  ErrorUtils?: { getGlobalHandler?: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler?: (h: (e: unknown, fatal?: boolean) => void) => void };
};

/** يلتقط الأخطاء غير المعالجة (JS) ورفض الوعود، ويمررها للمعالج الأصلي بعد تسجيلها. */
export function installGlobalHandlers(): void {
  if (installed) return;
  installed = true;
  const utils = (globalThis as GlobalWithErrorUtils).ErrorUtils;
  const previous = utils?.getGlobalHandler?.();
  utils?.setGlobalHandler?.((error, fatal) => {
    reportError(fatal ? "fatal" : "js", error);
    previous?.(error, fatal);
  });
  const g = globalThis as { addEventListener?: (type: string, cb: (e: { reason?: unknown }) => void) => void };
  g.addEventListener?.("unhandledrejection", (event) => reportError("promise", event.reason));
}
