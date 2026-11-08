import { memo, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Card, SectionTitle, StatusBadge } from "@/components/MarsoodUI";
import { itemState, type ItemRow } from "@/lib/core/engine";
import { palette } from "@/lib/palette";

export type ItemFilter = "natural" | "short" | "over" | "errors";
export interface ErrorCode {
  code: string;
  count: number;
}

const ITEM_BADGE = {
  pending: { state: "neutral", label: "لم يُمسح" },
  partial: { state: "warning", label: "ناقص" },
  done: { state: "good", label: "مكتمل" },
  over: { state: "bad", label: "زائد" },
} as const;

/** ترتيب/تصفية بنود الفاتورة: الطبيعي (كما في Excel)، النقص، الزيادة، أو أكواد الأخطاء. */
export function filterItems(items: ItemRow[], filter: Exclude<ItemFilter, "errors">): ItemRow[] {
  const natural = [...items].sort((a, b) => a.seq - b.seq);
  if (filter === "short") return natural.filter((i) => i.scanned < i.qty).sort((a, b) => b.qty - b.scanned - (a.qty - a.scanned) || a.seq - b.seq);
  if (filter === "over") return natural.filter((i) => i.scanned > i.qty).sort((a, b) => b.scanned - b.qty - (a.scanned - a.qty) || a.seq - b.seq);
  return natural;
}

const Row = memo(function Row({ item, adjustable, onAdjust }: { item: ItemRow; adjustable: boolean; onAdjust: (item: ItemRow, delta: 1 | -1) => void }) {
  const badge = ITEM_BADGE[itemState(item)];
  return (
    <View style={styles.tr}>
      <View style={{ flex: 1.15 }}><StatusBadge state={badge.state} label={badge.label} /></View>
      <View style={[styles.qtyCell, { flex: 1.5 }]}>
        {adjustable ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`إنقاص ${item.item_code}`} hitSlop={6} onPress={() => onAdjust(item, -1)} disabled={item.scanned <= 0} style={[styles.step, item.scanned <= 0 && styles.stepOff]}>
            <MaterialCommunityIcons name="minus" size={20} color={palette.ink} />
          </Pressable>
        ) : null}
        <Text style={styles.scanned}>{item.scanned}</Text>
        {adjustable ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`زيادة ${item.item_code}`} hitSlop={6} onPress={() => onAdjust(item, 1)} style={styles.step}>
            <MaterialCommunityIcons name="plus" size={20} color={palette.ink} />
          </Pressable>
        ) : null}
      </View>
      <Text style={[styles.td, { flex: 0.6 }]}>{item.qty}</Text>
      <Text style={[styles.td, { flex: 0.7 }]} numberOfLines={1}>{item.unit ?? "—"}</Text>
      <Text style={[styles.td, { flex: 1.3, fontWeight: "800" }]} selectable>{item.item_code}</Text>
    </View>
  );
});

export function ItemsTable({ items, errors, readonly, onAdjust }: { items: ItemRow[]; errors: ErrorCode[]; readonly: boolean; onAdjust: (item: ItemRow, delta: 1 | -1) => void }) {
  const [filter, setFilter] = useState<ItemFilter>("natural");
  const counts = useMemo(
    () => ({ natural: items.length, short: items.filter((i) => i.scanned < i.qty).length, over: items.filter((i) => i.scanned > i.qty).length, errors: errors.reduce((sum, e) => sum + e.count, 0) }),
    [items, errors],
  );
  const rows = useMemo(() => (filter === "errors" ? [] : filterItems(items, filter)), [items, filter]);
  const chips: Array<{ key: ItemFilter; label: string }> = [
    { key: "natural", label: "الترتيب الطبيعي" },
    { key: "short", label: "النقص" },
    { key: "over", label: "الزيادة" },
    { key: "errors", label: "الأخطاء" },
  ];
  return (
    <Card>
      <SectionTitle title="أصناف الفاتورة" hint={filter === "natural" ? "بترتيب شيت Excel" : filter === "short" ? "الأكثر نقصاً أولاً" : filter === "over" ? "الأكثر زيادة أولاً" : "أكواد غير موجودة في الفاتورة"} />
      <View style={styles.chips}>
        {chips.map((chip) => (
          <Pressable key={chip.key} accessibilityRole="button" onPress={() => setFilter(chip.key)} style={[styles.chip, filter === chip.key && styles.chipActive, chip.key !== "natural" && counts[chip.key] > 0 && filter !== chip.key && styles.chipAlert]}>
            <Text style={[styles.chipText, filter === chip.key && styles.chipTextActive]}>{chip.label} ({counts[chip.key]})</Text>
          </Pressable>
        ))}
      </View>
      {filter === "errors" ? (
        errors.length === 0 ? <Text style={styles.empty}>لا توجد أخطاء تجهيز على هذه الفاتورة.</Text> : errors.map((e) => (
          <View key={e.code} style={styles.tr}>
            <StatusBadge state="bad" label="خطأ تجهيز" />
            <Text style={[styles.td, { flex: 1, fontWeight: "800" }]} selectable>{e.code}</Text>
            <Text style={styles.td}>× {e.count}</Text>
          </View>
        ))
      ) : (
        <>
          <View style={styles.tableHead}>
            <Text style={[styles.th, { flex: 1.15 }]}>الحالة</Text>
            <Text style={[styles.th, { flex: 1.5 }]}>الممسوح</Text>
            <Text style={[styles.th, { flex: 0.6 }]}>المطلوب</Text>
            <Text style={[styles.th, { flex: 0.7 }]}>الوحدة</Text>
            <Text style={[styles.th, { flex: 1.3 }]}>كود الصنف</Text>
          </View>
          {rows.length === 0 ? <Text style={styles.empty}>{filter === "short" ? "لا توجد أصناف ناقصة." : "لا توجد أصناف زائدة."}</Text> : rows.map((item) => <Row key={item.item_key} item={item} adjustable={!readonly} onAdjust={onAdjust} />)}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: palette.line, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: palette.surface },
  chipActive: { backgroundColor: palette.ink, borderColor: palette.ink },
  chipAlert: { borderColor: palette.amber },
  chipText: { color: palette.inkSoft, fontSize: 12, fontWeight: "800" },
  chipTextActive: { color: palette.white },
  tableHead: { flexDirection: "row", gap: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: palette.line },
  th: { color: palette.muted, fontSize: 12, fontWeight: "800", textAlign: "right" },
  tr: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: palette.line },
  td: { color: palette.text, fontSize: 15, textAlign: "right" },
  qtyCell: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  scanned: { color: palette.ink, fontSize: 17, fontWeight: "900", minWidth: 26, textAlign: "center" },
  step: { width: 36, height: 36, borderRadius: 11, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surfaceMuted, alignItems: "center", justifyContent: "center" },
  stepOff: { opacity: 0.35 },
  empty: { color: palette.muted, fontSize: 13, textAlign: "right" },
});
