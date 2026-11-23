import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, Card, Header, Notice, Screen, SectionTitle } from "@/components/MarsoodUI";
import type { Session, SessionStatus } from "@/lib/core/engine";
import { useEngine } from "@/lib/core/hooks";
import { palette } from "@/lib/palette";

const ROLE: Record<string, string> = { supervisor: "مشرف", operator: "مشغّل" };
const STATUS: Record<SessionStatus["status"], string> = { idle: "لم تبدأ", active: "نشطة", ended: "منتهية" };

/** تبويب الحساب: بعد الدخول يعرض هوية المشغّل وحالة الجلسة ومداخل سريعة. (قبل الدخول تظهر شاشة الدخول/التسجيل مكانه.) */
export default function AccountScreen() {
  const router = useRouter();
  const { engine } = useEngine();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionStatus | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!engine) return;
      setSession(engine.getSession());
      engine.sessionStatus().then(setStatus).catch(() => undefined);
    }, [engine]),
  );

  return (
    <Screen>
      <Header title="الدخول والحساب" subtitle="هوية المشغّل وحالة جلسة التدقيق" />
      <Card>
        <SectionTitle title={session?.name ?? "—"} hint={session ? `الدور: ${ROLE[session.role] ?? session.role}` : undefined} />
        <View style={styles.row}>
          <Text style={styles.label}>حالة الجلسة</Text>
          <Text style={[styles.value, status?.status === "active" && { color: palette.tealDeep }]}>{status ? STATUS[status.status] : "…"}</Text>
        </View>
        {status?.id ? (
          <View style={styles.row}>
            <Text style={styles.label}>معرّف الجلسة</Text>
            <Text style={styles.value} selectable>{status.id}</Text>
          </View>
        ) : null}
        <Button title="الانتقال إلى التدقيق" icon="barcode-scan" onPress={() => router.navigate("/scan" as never)} />
        <Button title="تسجيل الخروج" icon="logout" variant="danger" onPress={() => void engine?.logout()} />
      </Card>
      {session?.role === "supervisor" ? <Notice title="إضافة مشغّلين" body="يضيف المشرف المشغّلين ويحدد أدوارهم ورموز PIN من تبويب الإعدادات." tone="info" /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  label: { color: palette.muted, fontSize: 15, fontWeight: "700" },
  value: { color: palette.ink, fontSize: 17, fontWeight: "900" },
});
