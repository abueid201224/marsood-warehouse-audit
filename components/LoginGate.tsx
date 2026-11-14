import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Notice, Screen } from "@/components/MarsoodUI";
import type { AuditEngine } from "@/lib/core/engine";
import { palette } from "@/lib/palette";

function Action({ title, onPress, disabled, testID }: { title: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} disabled={disabled} style={[styles.action, disabled && { opacity: 0.5 }]}>
      <Text style={styles.actionText}>{title}</Text>
    </Pressable>
  );
}

/** شاشة الإعداد الأول (حساب المشرف) وتسجيل دخول المشغّلين برمز PIN. */
export function LoginGate({ engine }: { engine: AuditEngine }) {
  const [setup, setSetup] = useState<boolean | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([engine.needsSetup(), engine.loginNames()]).then(([needs, list]) => {
      if (!alive) return;
      setSetup(needs);
      setNames(list);
    });
    return () => { alive = false; };
  }, [engine]);

  async function submit() {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      if (setup) {
        if (pin !== pin2) throw new Error("رمزا PIN غير متطابقين.");
        await engine.createOperator(name, pin, "supervisor");
      } else {
        const result = await engine.login(name, pin);
        if (!result.ok) {
          setError(result.reason);
          setPin("");
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تنفيذ العملية.");
    } finally {
      setBusy(false);
    }
  }

  if (setup === null) return <Screen><Text style={styles.sub}>جارٍ التحميل…</Text></Screen>;

  return (
    <Screen>
      <View style={styles.card}>
        <MaterialCommunityIcons name={setup ? "shield-account-outline" : "account-lock-outline"} size={44} color={palette.tealDeep} />
        <Text style={styles.title}>{setup ? "إعداد حساب المشرف" : "تسجيل دخول المشغّل"}</Text>
        <Text style={styles.sub}>
          {setup ? "أنشئ حساب المشرف الأول (اسم ورمز PIN من 4 إلى 8 أرقام). منه تضيف بقية المشغّلين، ويُسجَّل باسم كل مشغّل ما ينفّذه." : "اختر اسمك وأدخل رمز PIN."}
        </Text>
        {!setup && names.length > 0 ? (
          <View style={styles.chips}>
            {names.map((n) => (
              <Pressable key={n} onPress={() => setName(n)} style={[styles.chip, name === n && styles.chipOn]} accessibilityRole="button">
                <Text style={[styles.chipText, name === n && { color: "#FFFFFF" }]}>{n}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <TextInput testID="login-name" value={name} onChangeText={setName} placeholder="الاسم" placeholderTextColor={palette.subtle} style={styles.input} textAlign="right" autoCapitalize="none" />
        <TextInput testID="login-pin" value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, ""))} placeholder="رمز PIN" placeholderTextColor={palette.subtle} style={styles.input} textAlign="right" keyboardType="number-pad" secureTextEntry maxLength={8} onSubmitEditing={() => void submit()} />
        {setup ? <TextInput testID="login-pin2" value={pin2} onChangeText={(v) => setPin2(v.replace(/\D/g, ""))} placeholder="تأكيد رمز PIN" placeholderTextColor={palette.subtle} style={styles.input} textAlign="right" keyboardType="number-pad" secureTextEntry maxLength={8} onSubmitEditing={() => void submit()} /> : null}
        {error ? <Notice tone="danger" title="تعذر الدخول" body={error} /> : null}
        <Action testID="login-submit" title={busy ? "…" : setup ? "إنشاء الحساب والدخول" : "دخول"} onPress={() => void submit()} disabled={busy || name.trim().length < 2 || pin.length < 4} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { alignSelf: "center", width: "100%", maxWidth: 460, gap: 14, alignItems: "stretch", padding: 22, marginTop: 24, borderRadius: 20, borderWidth: 1, borderColor: "#CBD5E1", backgroundColor: "#FFFFFF" },
  title: { color: palette.ink, fontSize: 22, fontWeight: "900", textAlign: "center" },
  sub: { color: palette.muted, fontSize: 14, lineHeight: 22, textAlign: "center" },
  input: { borderWidth: 1, borderColor: palette.line, backgroundColor: "#FFFFFF", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: palette.ink, fontSize: 17 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  chip: { borderWidth: 1, borderColor: palette.tealDeep, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#FFFFFF" },
  chipOn: { backgroundColor: palette.tealDeep },
  chipText: { color: palette.tealDeep, fontWeight: "800", fontSize: 14 },
  action: { minHeight: 52, borderRadius: 14, backgroundColor: "#0B3B4A", alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  actionText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
});
