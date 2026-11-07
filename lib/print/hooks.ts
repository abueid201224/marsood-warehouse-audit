import { useCallback, useEffect, useState } from "react";
import type { PrintSummary } from "../core/engine";
import type { AuditEngine } from "../core/engine";

/** حالة الطباعة الحالية، تُحدَّث دورياً أثناء وجود مهام جارية. */
export function usePrintSummary(engine: AuditEngine | null): { summary: PrintSummary | null; reload: () => void } {
  const [summary, setSummary] = useState<PrintSummary | null>(null);
  const reload = useCallback(() => {
    if (!engine) return;
    engine.printSummary().then(setSummary).catch(() => undefined);
  }, [engine]);
  useEffect(() => {
    reload();
    const timer = setInterval(reload, 2500);
    return () => clearInterval(timer);
  }, [reload]);
  return { summary, reload };
}
