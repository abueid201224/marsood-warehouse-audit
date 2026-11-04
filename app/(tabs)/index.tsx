import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, Card, Header, Metric, Notice, Screen, SectionTitle, StatusBadge } from "@/components/MarsoodUI";
import { auditRepository } from "@/lib/storage/repository";
import { getSessionSummary, type AuditSession } from "@/lib/domain/audit";
import { palette } from "@/lib/palette";

function sessionLabel(session: AuditSession): { label: string; tone: "good" | "warning" | "bad" | "neutral" } {
  if (session.state === "complete") return { label: "أُغلقت بعد المطابقة", tone: "good" };
  const summary = getSessionSummary(session);
  if (summary.openExceptions > 0) return { label: "تحتاج مراجعة", tone: "warning" };
  if (summary.shortLines > 0 || summary.overLines > 0) return { label: "فرق في الكمية", tone: "bad" };
  if (summary.matchedLines === summary.lineCount && summary.lineCount > 0) return { label: "جاهزة للإقفال", tone: "neutral" };
  return { label: "بانتظار التدقيق", tone: "neutral" };
}

function formatDate(date: string) {
  try { return new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date)); }
  catch { return date; }
}

export default function DashboardScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<AuditSession[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try { setLoadError(""); setSessions(await auditRepository.listSessions()); }
    catch (error) { setLoadError(error instanceof Error ? error.message : "تعذر قراءة بيانات الجهاز."); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const openCount = sessions.filter((session) => session.state !== "complete").length;
  const reviewCount = sessions.filter((session) => session.state === "review" || getSessionSummary(session).openExceptions > 0).length;
  const completedCount = sessions.filter((session) => session.state === "complete").length;

  return (
    <Screen>
      <Header title="مِرصاد" subtitle="إدارة تدقيق الاستلام والفواتير" leading={<View style={styles.brandMark}><MaterialCommunityIcons name="barcode-scan" size={25} color={palette.white} /></View>} right={<StatusBadge state="good" label="محفوظ على الجهاز" />} />
      <View style={styles.hero}>
        <View style={styles.heroText}>
          <Text style={styles.heroEyebrow}>مركز عمليات المستودع</Text>
          <Text style={styles.heroTitle}>راجع كل وحدة،{"\n"}قبل إقفال الفاتورة.</Text>
          <Text style={styles.heroBody}>امسح الباركود، قارن الكمية، واترك الفروقات واضحة للمراجعة البشرية.</Text>
          <Button title="استيراد فاتورة" icon="file-upload-outline" onPress={() => router.push("/import")} />
        </View>
        <View style={styles.heroSymbol}>
          <MaterialCommunityIcons name="barcode-scan" size={48} color="#CDEAE1" />
          <View style={styles.scanLine} />
          <Text style={styles.heroOffline}>بدون شبكة</Text>
        </View>
      </View>

      {loadError ? <Notice title="تعذر تحميل الجلسات" body={loadError} tone="danger" /> : null}
      <View style={styles.metricRow}>
        <Metric label="جلسات مفتوحة" value={String(openCount)} icon="clipboard-text-clock-outline" accent={palette.blue} />
        <Metric label="استثناءات" value={String(reviewCount)} icon="alert-circle-outline" accent={palette.amber} />
        <Metric label="مقفلة" value={String(completedCount)} icon="check-decagram-outline" accent={palette.teal} />
      </View>
      <Notice title="جاهز لقارئ الباركود الخطي" body="وصّل القارئ بالتابلت كلوحة مفاتيح HID. تُحفظ كل جلسة محلياً، ولا تُرسل الملفات أو بياناتها إلى خادم." tone="info" icon="usb-port" />
      <SectionTitle title="آخر جلسات التدقيق" hint={loading ? "جارٍ قراءة السجل المحلي…" : `${sessions.length} فاتورة محفوظة على هذا الجهاز`} action={<Pressable onPress={() => router.push("/(tabs)/sessions")}><Text style={styles.link}>عرض الكل</Text></Pressable>} />
      {sessions.length === 0 && !loading ? (
        <Card><View style={styles.emptyRow}><MaterialCommunityIcons name="file-document-outline" size={25} color={palette.teal} /><View style={{ flex: 1 }}><Text style={styles.emptyTitle}>لا توجد فاتورة بعد</Text><Text style={styles.emptyBody}>استورد ملف Excel أو PDF نصي لبدء قائمة التدقيق.</Text></View></View></Card>
      ) : sessions.slice(0, 3).map((session) => {
        const summary = getSessionSummary(session);
        const badge = sessionLabel(session);
        return (
          <Pressable key={session.id} onPress={() => router.push(`/audit/${session.id}`)} style={({ pressed }) => [styles.sessionCard, pressed && { opacity: 0.84 }]}>
            <View style={styles.sessionTop}><StatusBadge state={badge.tone} label={badge.label} /><Text style={styles.invoiceId}>{session.invoiceNumber}</Text></View>
            <View style={styles.sessionBottom}><Text style={styles.sessionMeta}>{summary.matchedLines}/{summary.lineCount} بنود مطابقة</Text><Text style={styles.sessionMeta}>{formatDate(session.updatedAt)}</Text></View>
          </Pressable>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  brandMark: { width: 48, height: 48, borderRadius: 16, backgroundColor: palette.ink, alignItems: "center", justifyContent: "center" },
  hero: { flexDirection: "row", alignItems: "center", gap: 16, backgroundColor: palette.ink, borderRadius: 24, padding: 22, overflow: "hidden" },
  heroText: { flex: 1, gap: 12, alignItems: "flex-end" },
  heroEyebrow: { color: "#93BEB7", fontSize: 12, fontWeight: "800", alignSelf: "stretch", textAlign: "right" },
  heroTitle: { color: palette.white, fontSize: 27, lineHeight: 38, fontWeight: "900", textAlign: "right", alignSelf: "stretch" },
  heroBody: { color: "#D1DAE4", fontSize: 13, lineHeight: 21, textAlign: "right", maxWidth: 500, alignSelf: "stretch" },
  heroSymbol: { width: 116, height: 116, borderRadius: 32, backgroundColor: "#1A3555", alignItems: "center", justifyContent: "center", position: "relative" },
  scanLine: { position: "absolute", top: 54, right: 17, left: 17, height: 2, backgroundColor: "#56C5A4" },
  heroOffline: { color: "#B8D9D2", position: "absolute", bottom: 15, fontSize: 10, fontWeight: "800" },
  metricRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  link: { color: palette.tealDeep, fontWeight: "800", fontSize: 13 },
  emptyRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  emptyTitle: { color: palette.ink, fontSize: 14, fontWeight: "800", textAlign: "right" },
  emptyBody: { color: palette.muted, fontSize: 12, lineHeight: 19, textAlign: "right", marginTop: 3 },
  sessionCard: { backgroundColor: palette.surface, borderColor: palette.line, borderWidth: 1, borderRadius: 17, padding: 16, gap: 12 },
  sessionTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  invoiceId: { color: palette.ink, fontSize: 16, fontWeight: "900", textAlign: "right", flex: 1 },
  sessionBottom: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  sessionMeta: { color: palette.muted, fontSize: 12, textAlign: "right" },
});
