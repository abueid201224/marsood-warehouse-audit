import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, Notice } from "@/components/MarsoodUI";
import type { AuditEngine, PrintLogRow } from "@/lib/core/engine";
import { PRINT_MAX_ATTEMPTS } from "@/lib/core/engine";
import { kickPrintQueue } from "@/lib/print/runtime";
import { palette } from "@/lib/palette";

/** تنبيه ظاهر بمهام الطباعة التي لم تكتمل (فشل أو ملف PDF مفقود) مع إعادة محاولة فورية. */
export function PrintAlert({ engine }: { engine: AuditEngine | null }) {
  const [problems, setProblems] = useState<PrintLogRow[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    engine?.printProblems().then(setProblems).catch(() => undefined);
  }, [engine]);

  useEffect(() => {
    load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [load]);

  if (!engine || problems.length === 0) return null;

  const missing = problems.filter((p) => p.status === "missing").length;
  const failed = problems.length - missing;
  const retry = async () => {
    setBusy(true);
    try {
      await engine.retryPrints();
      kickPrintQueue(engine);
      setTimeout(load, 2500);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <Notice
        tone="warning"
        title={`طباعة لم تكتمل: ${problems.length}`}
        body={`${failed ? `${failed} فشلت (طابعة/شبكة)` : ""}${failed && missing ? " • " : ""}${missing ? `${missing} ملف PDF غير موجود في المجلد` : ""}. تُعاد المحاولة تلقائياً حتى ${PRINT_MAX_ATTEMPTS} مرات.`}
      />
      {problems.slice(0, 3).map((p) => (
        <Text key={`${p.orderNo}-${p.kind}`} style={styles.line} numberOfLines={2}>
          {p.orderNo} • {p.kind === "invoice" ? "فاتورة" : "بوليصة"} • {p.detail || "—"}
        </Text>
      ))}
      <Button title={busy ? "جارٍ الإرسال…" : "إعادة المحاولة الآن"} icon="printer-alert" variant="outline" onPress={() => void retry()} disabled={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  line: { color: palette.inkSoft, fontSize: 12, textAlign: "right" },
});
