import { useEffect, useState } from "react";
import type { AuditEngine } from "./engine";
import { loadRules, type PackRule } from "./packaging";
import { getEngine } from "./database";

/** يفتح قاعدة البيانات المحلية مرة واحدة ويعيد المحرك أو سبب الفشل. */
export function useEngine(): { engine: AuditEngine | null; error: string } {
  const [engine, setEngine] = useState<AuditEngine | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    getEngine()
      .then((value) => alive && setEngine(value))
      .catch((cause: unknown) => alive && setError(cause instanceof Error ? cause.message : "تعذر فتح قاعدة البيانات المحلية."));
    return () => {
      alive = false;
    };
  }, []);
  return { engine, error };
}

/** قواعد التعبئة المخزّنة (أو الافتراضية) ونطاق التنفيذ؛ تُقرأ مرة عند فتح الشاشة. */
export function usePackRules(engine: AuditEngine | null): PackRule[] {
  const [rules, setRules] = useState<PackRule[]>([]);
  useEffect(() => {
    let alive = true;
    engine?.getSetting("pack_rules").then((json) => alive && setRules(loadRules(json))).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [engine]);
  return rules;
}
