import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Button, Card, EmptyState, Header, Notice, Screen, SectionTitle } from "@/components/MarsoodUI";
import { ScannerInput } from "@/components/ScannerInput";
import type { CountLine, CountMode, CountTotal } from "@/lib/core/engine";
import { codeKey } from "@/lib/core/codes";
import { useEngine } from "@/lib/core/hooks";
import { asUnit, breakdown, compose, describeComposite, findRule, fromPieces, loadRules, parseScope, type PackRule, type PackScope } from "@/lib/core/packaging";
import { saveTextFile } from "@/lib/export/files";
import { palette } from "@/lib/palette";

/** شاشة الاستلام والجرد: الكمية تُدخل «كرتون + علبة + حبة» ويحوّلها محرك التعبئة إلى حبات ووحدة رئيسية. (الفواتير والمرتجع لا تستخدمه.) */
const intOf = (text: string) => (/^\d{1,7}$/.test(text.trim()) ? Number(text.trim()) : text.trim() === "" ? 0 : NaN);

export default function CountScreen() {
  const { engine } = useEngine();
  const [mode, setMode] = useState<CountMode>("receive");
  const [rules, setRules] = useState<PackRule[]>([]);
  const [scope, setScope] = useState<PackScope | null>(null);
  const [code, setCode] = useState("");
  const [cartons, setCartons] = useState("");
  const [boxes, setBoxes] = useState("");
  const [loose, setLoose] = useState("");
  const [lines, setLines] = useState<CountLine[]>([]);
  const [totals, setTotals] = useState<CountTotal[]>([]);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!engine) return;
    Promise.all([engine.getSetting("pack_rules"), engine.getSetting("pack_scope")]).then(([r, s]) => {
      setRules(loadRules(r));
      setScope(parseScope(s));
    }).catch(() => undefined);
  }, [engine]);

  const reload = useCallback(() => {
    if (!engine) return;
    engine.listCountLines(mode, 30).then(setLines).catch(() => undefined);
    engine.countTotals(mode).then(setTotals).catch(() => undefined);
  }, [engine, mode]);
  useEffect(reload, [reload]);

  const rule = useMemo(() => (code ? findRule(code, rules, scope) : null), [code, rules, scope]);
  const c = intOf(cartons);
  const b = intOf(boxes);
  const l = intOf(loose);
  const valid = [c, b, l].every(Number.isFinite);
  const pieces = useMemo(() => {
    if (!valid) return 0;
    if (rule) {
      try {
        return compose({ cartons: c, boxes: b, pieces: l }, rule);
      } catch {
        return 0;
      }
    }
    return l; // لا قاعدة: الحبات فقط
  }, [valid, rule, c, b, l]);
  const mainUnit = rule?.mainUnit ?? "EH";
  const mainQty = pieces > 0 ? fromPieces(pieces, mainUnit, rule) : 0;

  function onScan(scanned: string) {
    setError("");
    setNote("");
    setCode(codeKey(scanned));
    setCartons("");
    setBoxes("");
    setLoose("");
  }

  async function add() {
    if (!engine) return;
    setError("");
    setNote("");
    if (!code) return setError("امسح كود الصنف أولاً.");
    if (!valid || pieces <= 0) return setError("أدخل كمية صحيحة.");
    if (!rule && (c > 0 || b > 0)) return setError("لا توجد قاعدة تعبئة لهذا الباركود؛ أدخل الحبات فقط أو أضف مدى من «محرك التعبئة».");
    try {
      await engine.addCountLine({ mode, itemCode: code, cartons: rule ? c : 0, boxes: rule ? b : 0, loose: l, pieces, mainUnit, mainQty, ruleName: rule?.name ?? null });
      setNote(`سُجّل ${code}: ${pieces} حبة.`);
      setCode("");
      setCartons("");
      setBoxes("");
      setLoose("");
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر التسجيل.");
    }
  }

  async function exportCsv() {
    if (!engine) return;
    try {
      const head = "الصنف,إجمالي الحبات,التفصيل,الوحدة الرئيسية,الكمية بالوحدة الرئيسية";
      const body = totals.map((t) => {
        const r = findRule(t.item_code, rules, scope);
        const unit = r?.mainUnit ?? asUnit(t.main_unit);
        return [t.item_code, t.pieces, r ? describeComposite(breakdown(t.pieces, r)) : `${t.pieces} حبة`, unit, fromPieces(t.pieces, unit, r)].join(",");
      });
      const name = await saveTextFile(engine, mode === "receive" ? "marsood-receiving" : "marsood-stocktake", `﻿${[head, ...body].join("\n")}`);
      setNote(`حُفظ الملف ${name}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر الحفظ.");
    }
  }

  function remove(line: CountLine) {
    Alert.alert("حذف السطر", `حذف ${line.item_code} (${line.pieces} حبة)؟`, [
      { text: "إلغاء", style: "cancel" },
      { text: "حذف", style: "destructive", onPress: () => { engine?.deleteCountLine(line.id).then(reload).catch((e: unknown) => setError(e instanceof Error ? e.message : "تعذر الحذف.")); } },
    ]);
  }

  return (
    <Screen>
      <Header title="الاستلام والجرد" subtitle="الكميات بالكرتون والعلبة والحبة وفق قواعد التعبئة" />
      <Button title="رجوع" icon="arrow-right" variant="outline" onPress={() => router.back()} />
      <View style={styles.chips}>
        {(["receive", "count"] as const).map((m) => (
          <Pressable key={m} accessibilityRole="button" onPress={() => setMode(m)} style={[styles.chip, mode === m && styles.chipOn]}>
            <Text style={[styles.chipText, mode === m && styles.chipTextOn]}>{m === "receive" ? "استلام" : "جرد"}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Notice tone="danger" title="تنبيه" body={error} /> : null}
      {note ? <Notice tone="success" title="تم" body={note} /> : null}

      <Card>
        <SectionTitle title="كود الصنف" hint={code ? (rule ? `${rule.name} — كرتون ${rule.cartonPieces} حبة / ${rule.boxesPerCarton} علبة` : "لا توجد قاعدة تعبئة لهذا الباركود") : "امسح الباركود"} />
        <ScannerInput onScan={onScan} placeholder="امسح كود الصنف" />
        {code ? <Text style={styles.code} selectable>{code}</Text> : null}
        <View style={styles.row}>
          <View style={styles.field}><Text style={styles.label}>كرتون</Text><TextInput value={cartons} onChangeText={setCartons} keyboardType="number-pad" editable={!!rule} style={[styles.input, !rule && styles.off]} /></View>
          <View style={styles.field}><Text style={styles.label}>علبة</Text><TextInput value={boxes} onChangeText={setBoxes} keyboardType="number-pad" editable={!!rule} style={[styles.input, !rule && styles.off]} /></View>
          <View style={styles.field}><Text style={styles.label}>حبة</Text><TextInput value={loose} onChangeText={setLoose} keyboardType="number-pad" style={styles.input} /></View>
        </View>
        {pieces > 0 ? <Text style={styles.result}>= {pieces} حبة = {mainQty} {mainUnit}</Text> : null}
        <Button title="تسجيل" icon="check" variant="success" onPress={add} disabled={!engine || !code || pieces <= 0} />
      </Card>

      <Card>
        <SectionTitle title="إجمالي الأصناف" hint={`${totals.length} صنف`} />
        {totals.length === 0 ? <EmptyState icon="package-variant" title="لا توجد عمليات" body="امسح صنفاً وسجّل كميته." /> : totals.map((t) => {
          const r = findRule(t.item_code, rules, scope);
          const unit = r?.mainUnit ?? asUnit(t.main_unit);
          return (
            <View key={t.item_code} style={styles.tr}>
              <Text style={[styles.td, { flex: 1.2, fontWeight: "800" }]} selectable>{t.item_code}</Text>
              <Text style={[styles.td, { flex: 2 }]}>{r ? describeComposite(breakdown(t.pieces, r)) : `${t.pieces} حبة`}</Text>
              <Text style={[styles.td, { flex: 1 }]}>{fromPieces(t.pieces, unit, r)} {unit}</Text>
            </View>
          );
        })}
        <Button title="تصدير CSV" icon="file-delimited-outline" variant="outline" onPress={exportCsv} disabled={totals.length === 0} />
      </Card>

      <Card>
        <SectionTitle title="آخر العمليات" />
        {lines.map((line) => (
          <View key={line.id} style={styles.tr}>
            <Text style={[styles.td, { flex: 1.2 }]} selectable>{line.item_code}</Text>
            <Text style={[styles.td, { flex: 2 }]}>{[line.cartons && `${line.cartons} كرتون`, line.boxes && `${line.boxes} علبة`, line.loose && `${line.loose} حبة`].filter(Boolean).join(" + ")}</Text>
            <Pressable accessibilityRole="button" onPress={() => remove(line)}><Text style={styles.del}>حذف</Text></Pressable>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", gap: 8 },
  chip: { borderWidth: 1, borderColor: palette.line, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9, backgroundColor: palette.surface },
  chipOn: { backgroundColor: palette.ink, borderColor: palette.ink },
  chipText: { color: palette.inkSoft, fontWeight: "800", fontSize: 15 },
  chipTextOn: { color: palette.white },
  row: { flexDirection: "row", gap: 10 },
  field: { flex: 1 },
  label: { color: palette.muted, fontSize: 14, fontWeight: "800", textAlign: "right", marginBottom: 4 },
  input: { borderWidth: 1, borderColor: palette.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 18, color: palette.text, textAlign: "center", backgroundColor: palette.surface },
  off: { opacity: 0.4 },
  code: { color: palette.ink, fontSize: 20, fontWeight: "900", textAlign: "right" },
  result: { color: palette.teal, fontSize: 16, fontWeight: "800", textAlign: "right" },
  tr: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: palette.line },
  td: { color: palette.text, fontSize: 15, textAlign: "right" },
  del: { color: palette.red, fontWeight: "800", fontSize: 15 },
});
