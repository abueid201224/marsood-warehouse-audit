import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { Button, Card, Notice, SectionTitle } from "@/components/MarsoodUI";
import type { AuditEngine, OperatorRow, Session } from "@/lib/core/engine";
import { BACKUP_FOLDER_KEY, BACKUP_LAST_KEY, BACKUP_LAST_WHERE_KEY, pickBackupFolder, readBackupFile, runBackup } from "@/lib/backup/files";
import { palette } from "@/lib/palette";

type Note = { tone: "info" | "success" | "danger" | "warning"; title: string; body: string } | null;

/** الحساب الحالي + (للمشرف) إدارة المشغّلين والنسخ الاحتياطي وسجل التدقيق. */
export function AdminPanel({ engine, session }: { engine: AuditEngine; session: Session }) {
  const supervisor = session.role === "supervisor";
  const [operators, setOperators] = useState<OperatorRow[]>([]);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [asSupervisor, setAsSupervisor] = useState(false);
  const [lastBackup, setLastBackup] = useState("");
  const [folder, setFolder] = useState("");
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supervisor) return;
    setOperators(await engine.listOperators());
    const [at, where, f] = await Promise.all([engine.getSetting(BACKUP_LAST_KEY), engine.getSetting(BACKUP_LAST_WHERE_KEY), engine.getSetting(BACKUP_FOLDER_KEY)]);
    setLastBackup(at ? `${new Date(at).toLocaleString("ar-SA")} — ${where ?? ""}` : "لم يُنسخ بعد");
    setFolder(f ?? "");
  }, [engine, supervisor]);
  useEffect(() => { void load().catch(() => undefined); }, [load]);

  async function run(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } catch (cause) {
      setNote({ tone: "danger", title: "تعذر التنفيذ", body: cause instanceof Error ? cause.message : "خطأ غير متوقع." });
    } finally {
      setBusy(false);
    }
  }

  const addOperator = () => run(async () => {
    await engine.createOperator(name, pin, asSupervisor ? "supervisor" : "operator");
    setName(""); setPin(""); setAsSupervisor(false);
    setNote({ tone: "success", title: "أُضيف المشغّل", body: "يمكنه الدخول برمز PIN الذي حددته له." });
    await load();
  });

  const resetPin = (op: OperatorRow) => {
    const next = String(Math.floor(1000 + Math.random() * 9000));
    Alert.alert("إعادة تعيين الرمز", `سيُصبح رمز ${op.name} الجديد: ${next}\nسلّمه له وأخبره بتغييره.`, [
      { text: "إلغاء", style: "cancel" },
      { text: "تعيين", onPress: () => void run(async () => { await engine.resetPin(op.id, next); setNote({ tone: "success", title: "تم تعيين الرمز", body: `رمز ${op.name} الجديد: ${next}` }); }) },
    ]);
  };

  const backupNow = () => run(async () => {
    const result = await runBackup(engine, "manual");
    setNote({ tone: "success", title: "تم النسخ الاحتياطي", body: `${result?.name} (${result?.rows} صف) — ${result?.where}` });
    await load();
  });

  const chooseFolder = () => run(async () => {
    const uri = await pickBackupFolder();
    if (!uri) return;
    await engine.setSetting(BACKUP_FOLDER_KEY, uri);
    await load();
    setNote({ tone: "success", title: "حُدد مجلد النسخ", body: "ستُحفظ النسخ اليومية فيه (آخر 7 أيام)." });
  });

  const restore = () => run(async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: ["application/json", "text/plain", "*/*"], copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets[0]) return;
    const snapshot = await readBackupFile(picked.assets[0].uri);
    Alert.alert("استعادة نسخة احتياطية", `ستُستبدل بيانات التدقيق الحالية بنسخة ${snapshot.createdAt?.slice(0, 16).replace("T", " ") ?? ""}. لا يمكن التراجع (سجل التدقيق والحسابات تبقى). متابعة؟`, [
      { text: "إلغاء", style: "cancel" },
      { text: "استعادة", style: "destructive", onPress: () => void run(async () => { const r = await engine.restoreSnapshot(snapshot); setNote({ tone: "success", title: "تمت الاستعادة", body: `${r.rows} صف.` }); }) },
    ]);
  });

  return (
    <>
      {note ? <Notice tone={note.tone} title={note.title} body={note.body} /> : null}
      <Card>
        <SectionTitle title="الحساب" hint={`${session.name} — ${supervisor ? "مشرف" : "مشغّل"}`} />
        <Button title="تسجيل الخروج" icon="logout" variant="outline" onPress={() => void run(() => engine.logout())} disabled={busy} />
      </Card>

      {supervisor ? (
        <>
          <Card>
            <SectionTitle title="المشغّلون" hint="يُسجَّل اسم المشغّل في كل مسحة وإجراء" />
            {operators.map((op) => (
              <View key={op.id} style={styles.row}>
                <Text style={[styles.opName, !op.active && { color: palette.subtle }]}>{op.name} · {op.role === "supervisor" ? "مشرف" : "مشغّل"}{op.active ? "" : " (معطّل)"}</Text>
                <Pressable onPress={() => resetPin(op)} style={styles.link} accessibilityRole="button"><Text style={styles.linkText}>رمز جديد</Text></Pressable>
                {op.id !== session.id ? (
                  <Pressable onPress={() => void run(async () => { await engine.setOperatorActive(op.id, !op.active); await load(); })} style={styles.link} accessibilityRole="button">
                    <Text style={[styles.linkText, { color: op.active ? palette.red : palette.tealDeep }]}>{op.active ? "تعطيل" : "تفعيل"}</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
            <TextInput value={name} onChangeText={setName} placeholder="اسم مشغّل جديد" placeholderTextColor={palette.subtle} style={styles.input} textAlign="right" />
            <TextInput value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, ""))} placeholder="رمز PIN (4–8 أرقام)" placeholderTextColor={palette.subtle} style={styles.input} textAlign="right" keyboardType="number-pad" secureTextEntry maxLength={8} />
            <Pressable onPress={() => setAsSupervisor((v) => !v)} style={styles.check} accessibilityRole="checkbox"><Text style={styles.opName}>{asSupervisor ? "☑" : "☐"} صلاحية مشرف</Text></Pressable>
            <Button title="إضافة مشغّل" icon="account-plus-outline" onPress={addOperator} disabled={busy || name.trim().length < 2 || pin.length < 4} />
          </Card>

          <Card>
            <SectionTitle title="النسخ الاحتياطي" hint="نسخة يومية تلقائية عند الدخول وبعد إنهاء الفواتير، تُحفظ آخر 7 أيام" />
            <Text style={styles.sub}>آخر نسخة: {lastBackup}</Text>
            <Text style={styles.sub}>{folder ? "المجلد: محدد" : "لم يُحدد مجلد: يُستخدم مجلد المزامنة أو تخزين التطبيق الخاص (يُحذف عند إلغاء التثبيت)."}</Text>
            <Button title="نسخ احتياطي الآن" icon="content-save-outline" onPress={backupNow} disabled={busy} />
            <Button title="اختيار مجلد النسخ (OneDrive/Drive/الجهاز)" icon="folder-open-outline" variant="outline" onPress={chooseFolder} disabled={busy} />
            <Button title="استعادة من ملف نسخة" icon="backup-restore" variant="outline" onPress={restore} disabled={busy} />
          </Card>

          <Card>
            <SectionTitle title="إنتاجية المشغّلين" hint="الوحدات والفواتير والأخطاء ومعدل الساعة لكل مشغّل" />
            <Button title="عرض الإنتاجية" icon="chart-bar" variant="outline" onPress={() => router.push("/productivity")} />
          </Card>

          <Card>
            <SectionTitle title="سجل التدقيق" hint="كل الإجراءات باسم المشغّل — للإضافة فقط ولا يمكن تعديله" />
            <Button title="عرض السجل" icon="clipboard-text-clock-outline" variant="outline" onPress={() => router.push("/audit")} />
          </Card>
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: palette.line, paddingVertical: 8 },
  opName: { flex: 1, color: palette.ink, fontSize: 15, fontWeight: "700", textAlign: "right" },
  link: { paddingHorizontal: 8, paddingVertical: 6 },
  linkText: { color: palette.blue, fontWeight: "800", fontSize: 13 },
  input: { borderWidth: 1, borderColor: palette.line, backgroundColor: "#FFFFFF", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: palette.ink, fontSize: 15 },
  check: { paddingVertical: 6 },
  sub: { color: palette.muted, fontSize: 13, lineHeight: 20, textAlign: "right" },
});
