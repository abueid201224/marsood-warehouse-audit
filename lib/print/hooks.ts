import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import type { AuditEngine, PrintSummary } from "../core/engine";

/**
 * حالة الطباعة الحالية. تُستطلع فقط والشاشة ظاهرة والتطبيق في المقدمة:
 * كل 2.5 ث أثناء وجود مهام، وكل 15 ث عند الخمول (توفيراً للبطارية والمعالج).
 */
export function usePrintSummary(engine: AuditEngine | null): { summary: PrintSummary | null; reload: () => void } {
  const [summary, setSummary] = useState<PrintSummary | null>(null);
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const busyRef = useRef(false);

  const reload = useCallback(() => {
    if (!engine) return;
    engine
      .printSummary()
      .then((next) =>
        setSummary((prev) =>
          prev && prev.pending === next.pending && prev.printing === next.printing && prev.done === next.done && prev.failed === next.failed && prev.missing === next.missing ? prev : next,
        ),
      )
      .catch(() => undefined);
  }, [engine]);

  useEffect(() => {
    if (!engine || !focused) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (AppState.currentState === "active" && !busyRef.current) {
        busyRef.current = true;
        try {
          const next = await engine.printSummary();
          setSummary((prev) =>
            prev && prev.pending === next.pending && prev.printing === next.printing && prev.done === next.done && prev.failed === next.failed && prev.missing === next.missing ? prev : next,
          );
          timer = setTimeout(tick, next.pending + next.printing > 0 ? 2500 : 15000);
        } catch {
          timer = setTimeout(tick, 15000);
        } finally {
          busyRef.current = false;
        }
      } else {
        timer = setTimeout(tick, 5000);
      }
    };
    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [engine, focused]);

  return { summary, reload };
}
