import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";
import * as Constants from "expo-constants";
import { router } from "expo-router";
import { Button, Card, EmptyState, Header, Notice, Screen } from "@/components/MarsoodUI";
import type { DiagRow } from "@/lib/core/engine";
import { useEngine } from "@/lib/core/hooks";
import { saveTextFile } from "@/lib/export/files";
import { palette } from "@/lib/palette";

export default function DiagnosticsScreen() {
  const { engine } = useEngine();
  const [rows, setRows] = useState<DiagRow[] | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    engine?.diagLog(200).then(setRows).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "تعذر قراءة السجل."));
  }, [engine]);
  useEffect(load, [load]);

  async function exportLog() {
    if (!engine || !rows) return;
    try {
      const version = Constants.default?.expoConfig?.version ?? "?";
      const text = [`مِرصاد المستودع v${version}`, `التاريخ: ${new Date().toISOString()}`, "", ...rows.map((r) => `[${r.at}] ${r.source}: ${r.message}${r.stack ? `\n${r.stack}` : ""}`)].join("\n");
      const name = await saveTextFile(engine, "marsood-diagnostics", text);
      setNote(`حُفظ الملف ${name}. أرسله للمطوّر عند الحاجة.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر الحفظ.");
    }
  }

  return (
    <Screen>
      <Header title="سجل الأعطال" subtitle="للقراءة والتصدير — يبقى على الجهاز" />
      <Button title="رجوع" icon="arrow-right" variant="outline" onPress={() => router.back()} />
      {error ? <Notice tone="danger" title="غير متاح" body={error} /> : null}
      {note ? <Notice tone="success" title="تم" body={note} /> : null}
      {rows && rows.length === 0 ? <EmptyState icon="shield-check-outline" title="لا توجد أعطال مسجّلة" body="لم يُسجَّل أي خطأ غير متوقع." /> : null}
      {rows && rows.length > 0 ? (
        <>
          <Button title="حفظ السجل كملف نصي" icon="file-export-outline" onPress={() => void exportLog()} />
          <Button title="مسح السجل" icon="delete-outline" variant="outline" onPress={() => void engine?.clearDiag().then(() => { setNote("تم مسح السجل."); load(); })} />
        </>
      ) : null}
      {rows?.map((r) => (
        <Card key={r.id}>
          <Text style={styles.head}>{r.source} • {new Date(r.at).toLocaleString("ar-SA")}</Text>
          <Text style={styles.msg} selectable>{r.message}</Text>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { color: palette.muted, fontSize: 14, textAlign: "right" },
  msg: { color: palette.ink, fontSize: 15, textAlign: "right" },
});
