import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Button, Card, EmptyState, Header, Notice, Screen } from "@/components/MarsoodUI";
import type { AuditRow } from "@/lib/core/engine";
import { useEngine } from "@/lib/core/hooks";
import { palette } from "@/lib/palette";

const LABELS: Record<string, string> = {
  setup: "إعداد المشرف", login: "دخول", logout: "خروج", login_failed: "دخول فاشل", operator_add: "إضافة مشغّل", operator_disable: "تعطيل مشغّل", operator_enable: "تفعيل مشغّل", pin_reset: "إعادة رمز",
  import: "استيراد", open: "فتح فاتورة", reopen: "إعادة فتح", close: "إنهاء فاتورة", post: "ترحيل فاتورة", release: "ترك فاتورة", adjust: "تعديل كمية", undo: "إلغاء مسحة",
  setting: "تغيير إعداد", backup: "نسخ احتياطي", backup_failed: "فشل النسخ", restore: "استعادة", reset: "مسح البيانات",
};

export default function AuditScreen() {
  const { engine } = useEngine();
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!engine) return;
    engine.auditLog(300).then(setRows).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "تعذر قراءة السجل."));
  }, [engine]);
  return (
    <Screen>
      <Header title="سجل التدقيق" subtitle="آخر 300 إجراء — للقراءة فقط" />
      <Button title="رجوع" icon="arrow-right" variant="outline" onPress={() => router.back()} />
      {error ? <Notice tone="danger" title="غير متاح" body={error} /> : null}
      {rows && rows.length === 0 ? <EmptyState icon="clipboard-text-clock-outline" title="لا توجد أحداث" body="ستظهر هنا الإجراءات." /> : null}
      {rows?.map((row) => (
        <Card key={row.id}>
          <View style={styles.line}>
            <Text style={[styles.event, row.event.includes("failed") && { color: palette.red }]}>{LABELS[row.event] ?? row.event}</Text>
            <Text style={styles.time}>{new Date(row.at).toLocaleString("ar-SA")}</Text>
          </View>
          <Text style={styles.meta}>{row.operator ?? "—"}{row.ref ? ` • ${row.ref}` : ""}{row.detail ? ` • ${row.detail}` : ""}</Text>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  event: { color: palette.ink, fontWeight: "900", fontSize: 15 },
  time: { color: palette.muted, fontSize: 12 },
  meta: { color: palette.inkSoft, fontSize: 13, textAlign: "right" },
});
