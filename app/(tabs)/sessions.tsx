import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Button, Card, EmptyState, Header, Notice, Screen, StatusBadge } from "@/components/MarsoodUI";
import { auditRepository } from "@/lib/storage/repository";
import { getSessionSummary, type AuditSession } from "@/lib/domain/audit";
import { palette } from "@/lib/palette";

type Filter = "all" | "review" | "pending" | "complete";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "review", label: "استثناءات" },
  { key: "pending", label: "مفتوحة" },
  { key: "complete", label: "مقفلة" },
];

function sessionStatus(session: AuditSession) {
  const summary = getSessionSummary(session);
  if (session.state === "complete") return { label: "مقفلة", tone: "good" as const };
  if (summary.openExceptions > 0) return { label: `${summary.openExceptions} استثناء`, tone: "warning" as const };
  if (summary.overLines > 0) return { label: "كمية زائدة", tone: "bad" as const };
  if (summary.shortLines > 0) return { label: "كمية ناقصة", tone: "bad" as const };
  if (summary.matchedLines === summary.lineCount && summary.lineCount > 0) return { label: "جاهزة للإقفال", tone: "neutral" as const };
  return { label: "بانتظار التدقيق", tone: "neutral" as const };
}

function dateText(value: string) {
  try { return new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium" }).format(new Date(value)); }
  catch { return value; }
}

export default function SessionsScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<AuditSession[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try { setError(""); setSessions(await auditRepository.listSessions()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر قراءة الجلسات."); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const visible = useMemo(() => sessions.filter((session) => {
    const status = sessionStatus(session);
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || session.invoiceNumber.toLowerCase().includes(query) || session.sourceFileName.toLowerCase().includes(query);
    const matchesFilter = filter === "all" ||
      (filter === "review" && getSessionSummary(session).openExceptions > 0) ||
      (filter === "pending" && session.state !== "complete") ||
      (filter === "complete" && session.state === "complete");
    return matchesSearch && matchesFilter && !!status;
  }), [sessions, filter, search]);

  return (
    <Screen>
      <Header title="الفواتير" subtitle="قائمة محلية قابلة للبحث والتصفية" right={<MaterialCommunityIcons name="filter-variant" size={24} color={palette.teal} />} />
      {error ? <Notice title="تعذر تحميل السجل" body={error} tone="danger" /> : null}
      <View style={styles.searchBox}>
        <MaterialCommunityIcons name="magnify" size={21} color={palette.subtle} />
        <TextInput value={search} onChangeText={setSearch} placeholder="ابحث برقم الفاتورة أو اسم الملف" placeholderTextColor={palette.subtle} style={styles.searchInput} textAlign="right" returnKeyType="search" />
      </View>
      <View style={styles.filters}>
        {FILTERS.map((item) => (
          <Pressable key={item.key} onPress={() => setFilter(item.key)} style={[styles.filterChip, filter === item.key && styles.filterActive]}>
            <Text style={[styles.filterText, filter === item.key && styles.filterTextActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.resultsTitle}>
        <Text style={styles.resultsCount}>{loading ? "جارٍ التحميل…" : `${visible.length} نتيجة`}</Text>
        <Text style={styles.resultsHeading}>سجل التدقيق</Text>
      </View>
      {!loading && visible.length === 0 ? (
        <Card>
          <EmptyState
            icon="clipboard-search-outline"
            title={sessions.length === 0 ? "لا توجد فواتير مستوردة" : "لا توجد نتائج مطابقة"}
            body={sessions.length === 0 ? "ابدأ باستيراد ملف Excel أو PDF قابل لاستخراج النص." : "جرّب تعديل البحث أو اختيار مرشح آخر."}
            action={sessions.length === 0 ? <Button title="استيراد فاتورة" icon="file-upload-outline" onPress={() => router.push("/import")} compact /> : undefined}
          />
        </Card>
      ) : null}
      {visible.map((session) => {
        const summary = getSessionSummary(session);
        const badge = sessionStatus(session);
        const progress = summary.lineCount === 0 ? 0 : Math.round((summary.matchedLines / summary.lineCount) * 100);
        return (
          <Pressable key={session.id} onPress={() => router.push(`/audit/${session.id}`)} style={({ pressed }) => [styles.sessionCard, pressed && { opacity: 0.84 }]}>
            <View style={styles.sessionHeader}>
              <StatusBadge state={badge.tone} label={badge.label} />
              <View style={styles.sessionNumber}>
                <Text style={styles.invoiceNumber}>{session.invoiceNumber}</Text>
                <Text style={styles.fileName} numberOfLines={1}>{session.sourceFileName}</Text>
              </View>
              <MaterialCommunityIcons name="chevron-left" size={22} color={palette.subtle} />
            </View>
            <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
            <View style={styles.sessionMeta}>
              <Text style={styles.metaText}>{summary.matchedLines} من {summary.lineCount} بند مطابق</Text>
              <Text style={styles.metaText}>{dateText(session.updatedAt)}</Text>
            </View>
          </Pressable>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchBox: { minHeight: 50, backgroundColor: palette.surface, borderRadius: 14, borderWidth: 1, borderColor: palette.line, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 9 },
  searchInput: { flex: 1, color: palette.text, fontSize: 14, paddingVertical: 11 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterChip: { borderRadius: 99, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: palette.surface, borderColor: palette.line, borderWidth: 1 },
  filterActive: { backgroundColor: palette.ink, borderColor: palette.ink },
  filterText: { color: palette.inkSoft, fontWeight: "700", fontSize: 12 },
  filterTextActive: { color: palette.white },
  resultsTitle: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 },
  resultsHeading: { color: palette.ink, fontSize: 17, fontWeight: "900" },
  resultsCount: { color: palette.muted, fontSize: 12 },
  sessionCard: { backgroundColor: palette.surface, borderColor: palette.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 13 },
  sessionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  sessionNumber: { flex: 1, alignItems: "flex-end", gap: 3 },
  invoiceNumber: { color: palette.ink, fontSize: 15, fontWeight: "900", textAlign: "right" },
  fileName: { maxWidth: "100%", color: palette.muted, fontSize: 11, textAlign: "right" },
  progressTrack: { height: 6, backgroundColor: palette.background, borderRadius: 999, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: palette.teal, borderRadius: 999 },
  sessionMeta: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  metaText: { color: palette.muted, fontSize: 11 },
});
