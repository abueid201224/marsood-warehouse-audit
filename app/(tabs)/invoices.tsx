import { memo, useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, EmptyState, Header, Notice, ProgressBar, StatusBadge } from "@/components/MarsoodUI";
import type { InvoiceStatus, InvoiceView } from "@/lib/core/engine";
import { STATUS_LABELS } from "@/lib/core/format";
import { useEngine } from "@/lib/core/hooks";
import { palette } from "@/lib/palette";
import { useLayout } from "@/lib/layout";

type Filter = "all" | "pending" | InvoiceStatus;
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "pending", label: "غير المنتهية" },
  { key: "all", label: "الكل" },
  { key: "new", label: "لم تبدأ" },
  { key: "open", label: "قيد المراجعة" },
  { key: "posted", label: "مرحّلة" },
  { key: "closed", label: "منتهية" },
];
const BADGE = { new: "neutral", open: "neutral", posted: "warning", closed: "good" } as const;

const InvoiceCard = memo(function InvoiceCard({ row, onOpen }: { row: InvoiceView; onOpen: (row: InvoiceView) => void }) {
  return (
    <Pressable onPress={() => onOpen(row)} accessibilityRole="button" style={{ flex: 1 }}>
      <Card>
        <View style={styles.head}>
          <StatusBadge state={BADGE[row.status]} label={STATUS_LABELS[row.status]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.orderNo}>طلب {row.order_no}</Text>
            <Text style={styles.sub}>الفاتورة: {row.invoices ?? "—"} • {row.item_count} صنف • {row.total_qty} وحدة</Text>
          </View>
          <Text style={styles.percent}>{row.progress}%</Text>
        </View>
        <ProgressBar percent={row.progress} color={row.status === "closed" ? palette.teal : palette.amber} />
        {row.wrong_scans > 0 || row.over_scans > 0 || (row.status === "posted" && row.short_items > 0) ? (
          <Text style={styles.flags}>
            {row.short_items > 0 && row.status === "posted" ? `نواقص: ${row.short_items} صنف  ` : ""}
            {row.wrong_scans > 0 ? `أخطاء تجهيز: ${row.wrong_scans}  ` : ""}
            {row.over_scans > 0 ? `تجهيز زائد: ${row.over_scans}` : ""}
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );
});

export default function InvoicesScreen() {
  const router = useRouter();
  const { engine, error } = useEngine();
  const { columns, gutter, maxWidth } = useLayout();
  const [filter, setFilter] = useState<Filter>("pending");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<InvoiceView[]>([]);
  const [message, setMessage] = useState("");
  const requestId = useRef(0);

  // تأخير البحث 250 م.ث كي لا يُستعلم عن كل حرف
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(() => {
    if (!engine) return;
    const id = ++requestId.current;
    engine
      .listInvoices({ status: filter, search: query })
      .then((next) => {
        if (id === requestId.current) setRows(next); // تجاهل الاستجابات المتأخرة
      })
      .catch((cause: unknown) => setMessage(cause instanceof Error ? cause.message : "تعذر قراءة الفواتير."));
  }, [engine, filter, query]);
  useFocusEffect(load);

  const open = useCallback(
    async (row: InvoiceView) => {
      if (!engine) return;
      try {
        const result = await engine.openInvoice(row.order_key);
        if (result.type === "blocked") {
          setMessage(`أكمل الفاتورة ${result.orderNo} أولاً (ينقصها ${result.shortItems} صنف) أو رحّلها من شاشة المسح قبل فتح فاتورة أخرى.`);
          return;
        }
        if (result.type === "not-today") {
          setMessage(`الطلب ${result.orderNo} مسجل بتاريخ ${result.day} وليس في جدول اليوم، فلا يُقبل مسحه. استورد ملف اليوم أولاً.`);
          return;
        }
        setMessage("");
        router.navigate("/scan");
      } catch (cause) {
        setMessage(cause instanceof Error ? cause.message : "تعذر فتح الفاتورة.");
      }
    },
    [engine, router],
  );

  const header = (
    <View style={styles.headerBlock}>
      <Header title="الفواتير" subtitle="الفواتير المستخلصة من الجدول مع نسبة تقدم كل فاتورة" />
      {error || message ? <Notice title="يلزم الانتباه" body={error || message} tone="danger" /> : null}
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="بحث برقم الطلب أو الفاتورة"
        placeholderTextColor={palette.subtle}
        style={styles.search}
        textAlign="right"
        autoCorrect={false}
      />
      <View style={styles.chips}>
        {FILTERS.map((item) => (
          <Pressable key={item.key} onPress={() => setFilter(item.key)} style={[styles.chip, filter === item.key && styles.chipActive]}>
            <Text style={[styles.chipText, filter === item.key && styles.chipTextActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <FlatList
        key={`cols-${columns}`}
        data={rows}
        numColumns={columns}
        keyExtractor={(row) => row.order_key}
        renderItem={({ item }) => <InvoiceCard row={item} onOpen={open} />}
        ListHeaderComponent={header}
        ListEmptyComponent={<Card><EmptyState icon="clipboard-search-outline" title="لا توجد فواتير مطابقة" body="غيّر التصفية أو استورد ملفاً جديداً من لوحة العمل." /></Card>}
        columnWrapperStyle={columns > 1 ? { gap: 12 } : undefined}
        contentContainerStyle={[styles.list, { paddingHorizontal: gutter, maxWidth }]}
        ItemSeparatorComponent={Separator}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews
      />
    </SafeAreaView>
  );
}

function Separator() {
  return <View style={{ height: 12 }} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  list: { paddingTop: 16, paddingBottom: 32, width: "100%", alignSelf: "center" },
  headerBlock: { gap: 14, marginBottom: 14 },
  search: { borderWidth: 1, borderColor: palette.line, backgroundColor: palette.white, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, color: palette.ink, fontSize: 15 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: palette.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: palette.surface },
  chipActive: { backgroundColor: palette.ink, borderColor: palette.ink },
  chipText: { color: palette.inkSoft, fontSize: 12, fontWeight: "800" },
  chipTextActive: { color: palette.white },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  orderNo: { color: palette.ink, fontSize: 17, fontWeight: "900", textAlign: "right" },
  sub: { color: palette.muted, fontSize: 12, textAlign: "right", marginTop: 3 },
  percent: { color: palette.tealDeep, fontSize: 22, fontWeight: "900" },
  flags: { color: palette.red, fontSize: 12, fontWeight: "700", textAlign: "right" },
});
