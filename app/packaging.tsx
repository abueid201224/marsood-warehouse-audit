import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Button, Card, Header, Notice, Screen, SectionTitle } from "@/components/MarsoodUI";
import { useEngine } from "@/lib/core/hooks";
import {
  UNITS, applyMainUnit, defaultRules, findOverlaps, loadRules, parseScope, resolveLine, rulesInScope, validateRule, type PackRule, type Unit,
} from "@/lib/core/packaging";
import { palette } from "@/lib/palette";

const num = (text: string) => (/^\d{1,15}$/.test(text.trim()) ? Number(text.trim()) : NaN);

function Chips({ value, onChange }: { value: Unit; onChange: (unit: Unit) => void }) {
  return (
    <View style={styles.chips}>
      {UNITS.map((unit) => (
        <Pressable key={unit} accessibilityRole="button" onPress={() => onChange(unit)} style={[styles.chip, value === unit && styles.chipOn]}>
          <Text style={[styles.chipText, value === unit && styles.chipTextOn]}>{unit}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Field({ label, value, onChange, numeric = true }: { label: string; value: string; onChange: (text: string) => void; numeric?: boolean }) {
  return (
    <View style={{ flex: 1, minWidth: 120 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType={numeric ? "number-pad" : "default"} style={styles.input} placeholderTextColor={palette.muted} />
    </View>
  );
}

export default function PackagingScreen() {
  const { engine } = useEngine();
  const [rules, setRules] = useState<PackRule[]>([]);
  const [ready, setReady] = useState(false);
  const [scopeFrom, setScopeFrom] = useState("");
  const [scopeTo, setScopeTo] = useState("");
  const [mainUnit, setMainUnit] = useState<Unit>("DZ");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [calcCode, setCalcCode] = useState("");
  const [calcQty, setCalcQty] = useState("");
  const [calcUnit, setCalcUnit] = useState<Unit>("HDZ");

  useEffect(() => {
    if (!engine) return;
    Promise.all([engine.getSetting("pack_rules"), engine.getSetting("pack_scope")]).then(([r, s]) => {
      setRules(loadRules(r));
      const scope = parseScope(s);
      if (scope) {
        setScopeFrom(String(scope.from));
        setScopeTo(String(scope.to));
      }
      setReady(true);
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "تعذر القراءة."));
  }, [engine]);

  const scope = useMemo(() => {
    const from = num(scopeFrom);
    const to = num(scopeTo);
    return Number.isFinite(from) && Number.isFinite(to) && from <= to ? { from, to } : null;
  }, [scopeFrom, scopeTo]);
  const overlaps = useMemo(() => findOverlaps(rules), [rules]);
  const inScope = useMemo(() => (scope ? rulesInScope(rules, scope).length : rules.length), [rules, scope]);
  const calc = useMemo(() => {
    try {
      return calcCode && calcQty ? resolveLine(calcCode, calcQty, calcUnit, rules, scope) : null;
    } catch {
      return null;
    }
  }, [calcCode, calcQty, calcUnit, rules, scope]);

  const patch = (id: string, change: Partial<PackRule>) => setRules((list) => list.map((r) => (r.id === id ? { ...r, ...change } : r)));
  const invalid = rules.filter((r) => validateRule(r).length > 0);

  async function save() {
    if (!engine) return;
    setNote("");
    setError("");
    if (invalid.length) return setError("أصلح القواعد غير الصالحة قبل الحفظ.");
    try {
      await engine.setSetting("pack_rules", JSON.stringify(rules));
      await engine.setSetting("pack_scope", scope ? JSON.stringify(scope) : null);
      setNote("حُفظت قواعد التعبئة.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر الحفظ.");
    }
  }

  return (
    <Screen>
      <Header title="محرك التعبئة" subtitle="مدى الباركود ← الوحدة الرئيسية ← العبوات والعلاقات" />
      <Button title="رجوع" icon="arrow-right" variant="outline" onPress={() => router.back()} />
      {error ? <Notice tone="danger" title="تنبيه" body={error} /> : null}
      {note ? <Notice tone="success" title="تم" body={note} /> : null}

      <Card>
        <SectionTitle title="١) نطاق التنفيذ" hint={scope ? `${inScope} قاعدة ضمن النطاق` : "اتركه فارغاً لتطبيق كل القواعد"} />
        <View style={styles.row}>
          <Field label="من باركود" value={scopeFrom} onChange={setScopeFrom} />
          <Field label="إلى باركود" value={scopeTo} onChange={setScopeTo} />
        </View>
      </Card>

      <Card>
        <SectionTitle title="٢) الوحدة الرئيسية" hint="تُطبَّق على قواعد النطاق المحدد (أو الكل)" />
        <Chips value={mainUnit} onChange={setMainUnit} />
        <Button title="تطبيق على النطاق" icon="check" variant="outline" onPress={() => setRules((list) => applyMainUnit(list, scope ?? { from: 1, to: Number.MAX_SAFE_INTEGER }, mainUnit))} />
        <Text style={styles.hint}>DZ = 2 HDZ = 12 EH/PCS — HDZ = 6 حبات.</Text>
      </Card>

      <Card>
        <SectionTitle title="٣) العبوات والعلاقات" hint="كرتون: 12–72 حبة، 1–12 علبة" />
        {!ready ? <Text style={styles.hint}>جارٍ التحميل…</Text> : null}
        {rules.map((r) => {
          const errs = validateRule(r);
          return (
            <View key={r.id} style={[styles.rule, errs.length > 0 && { borderColor: palette.red }, !r.enabled && { opacity: 0.55 }]}>
              <Field label="المجموعة" value={r.name} onChange={(t) => patch(r.id, { name: t })} numeric={false} />
              <View style={styles.row}>
                <Field label="من باركود" value={String(r.from || "")} onChange={(t) => patch(r.id, { from: num(t) || 0 })} />
                <Field label="إلى باركود" value={String(r.to || "")} onChange={(t) => patch(r.id, { to: num(t) || 0 })} />
              </View>
              <View style={styles.row}>
                <Field label="حبات الكرتون" value={String(r.cartonPieces || "")} onChange={(t) => patch(r.id, { cartonPieces: num(t) || 0 })} />
                <Field label="علب الكرتون" value={String(r.boxesPerCarton || "")} onChange={(t) => patch(r.id, { boxesPerCarton: num(t) || 0 })} />
              </View>
              <Text style={styles.label}>وحدة صرف الطلبات</Text>
              <Chips value={r.issueUnit} onChange={(u) => patch(r.id, { issueUnit: u })} />
              <Text style={styles.label}>الوحدة الرئيسية</Text>
              <Chips value={r.mainUnit} onChange={(u) => patch(r.id, { mainUnit: u })} />
              {errs.map((e) => <Text key={e} style={styles.err}>{e}</Text>)}
              <View style={styles.row}>
                <Button compact title={r.enabled ? "تعطيل" : "تفعيل"} variant="outline" onPress={() => patch(r.id, { enabled: !r.enabled })} />
                <Button compact title="نسخ" variant="outline" onPress={() => setRules((l) => [...l, { ...r, id: `r${Date.now()}`, name: `${r.name} (نسخة)` }])} />
                <Button compact title="حذف" variant="danger" onPress={() => setRules((l) => l.filter((x) => x.id !== r.id))} />
              </View>
            </View>
          );
        })}
        {overlaps.length > 0 ? <Notice tone="warning" title="تداخل في المدى" body={`${overlaps.length} تداخل؛ تُطبَّق القاعدة الأضيق مدىً.`} /> : null}
        <Button title="إضافة قاعدة" icon="plus" variant="outline" onPress={() => setRules((l) => [...l, { id: `r${Date.now()}`, name: "مجموعة جديدة", from: 1, to: 1, cartonPieces: 12, boxesPerCarton: 2, issueUnit: "EH", mainUnit: "EH", enabled: true }])} />
        <Button title="استرجاع الجدول المعتمد" icon="restore" variant="outline" onPress={() => setRules(defaultRules())} />
      </Card>

      <Card>
        <SectionTitle title="حاسبة التحقق" hint="جرّب كمية على باركود" />
        <View style={styles.row}>
          <Field label="باركود الصنف" value={calcCode} onChange={setCalcCode} />
          <Field label="الكمية" value={calcQty} onChange={setCalcQty} numeric={false} />
        </View>
        <Chips value={calcUnit} onChange={setCalcUnit} />
        {calc ? (
          <Text style={styles.result}>{calc.rule.name}: {calc.label} = {calc.pieces} حبة = {calc.inMain} {calc.rule.mainUnit}{calc.exact ? "" : " (مُقرَّب)"}</Text>
        ) : calcCode && calcQty ? <Text style={styles.err}>لا توجد قاعدة مطابقة ضمن النطاق.</Text> : null}
      </Card>

      <Button title="حفظ القواعد" icon="content-save-outline" variant="success" onPress={save} disabled={!engine} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "flex-end" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: palette.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: palette.surface },
  chipOn: { backgroundColor: palette.ink, borderColor: palette.ink },
  chipText: { color: palette.inkSoft, fontWeight: "800", fontSize: 13 },
  chipTextOn: { color: palette.white },
  label: { color: palette.muted, fontSize: 12, fontWeight: "800", textAlign: "right", marginBottom: 4, marginTop: 6 },
  input: { borderWidth: 1, borderColor: palette.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, color: palette.text, textAlign: "right", backgroundColor: palette.surface },
  rule: { borderWidth: 1, borderColor: palette.line, borderRadius: 14, padding: 12, gap: 6 },
  hint: { color: palette.muted, fontSize: 12, textAlign: "right" },
  err: { color: palette.red, fontSize: 12, fontWeight: "700", textAlign: "right" },
  result: { color: palette.teal, fontSize: 14, fontWeight: "800", textAlign: "right" },
});
