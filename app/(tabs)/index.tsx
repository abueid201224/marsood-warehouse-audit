import { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, Card, EmptyState, Header, Metric, Notice, ProgressBar, Screen, SectionTitle } from "@/components/MarsoodUI";
import { ProgressChart } from "@/components/ProgressChart";
import type { Stats } from "@/lib/core/engine";
import { useEngine } from "@/lib/core/hooks";
import { palette } from "@/lib/palette";

export default function DashboardScreen() {
  const router = useRouter();
  const { engine, error } = useEngine();
  const [stats, setStats] = useState<Stats | null>(null);
  const [failure, setFailure] = useState("");

  const load = useCallback(() => {
    if (!engine) return;
    engine.getStats().then((value) => { setStats(value); setFailure(""); }).catch((cause: unknown) => setFailure(cause instanceof Error ? cause.message : "تعذر قراءة الإحصاءات."));
  }, [engine]);
  useFocusEffect(load);

  function confirmReset() {
    Alert.alert("بدء دفعة جديدة", "سيُمسح كل ما استُورد وكل المسحات والتقارير من هذا الجهاز. هل تريد المتابعة؟", [
      { text: "إلغاء", style: "cancel" },
      { text: "مسح كل البيانات", style: "destructive", onPress: () => { engine?.resetAll().then(load).catch(() => undefined); } },
    ]);
  }

  const percent = stats && stats.total > 0 ? Math.round((stats.closed / stats.total) * 100) : 0;

  return (
    <Screen>
      <Header title="مِرصاد المستودع" subtitle="مراجعة فواتير التجهيز بالباركود دون اتصال" />
      {error || failure ? <Notice title="تعذر فتح قاعدة البيانات" body={error || failure} tone="danger" /> : null}

      {stats && stats.total === 0 ? (
        <Card>
          <EmptyState icon="file-excel-outline" title="لا توجد فواتير بعد" body="استورد ملف Excel بالأعمدة: رقم الطلب، رقم الفاتورة، كود الصنف، الوحدة، الكمية. تُستخلص الفواتير تلقائياً من الجدول." action={<Button title="استيراد ملف Excel" icon="file-upload-outline" onPress={() => router.push("/import")} />} />
        </Card>
      ) : null}

      {stats && stats.total > 0 ? (
        <>
          <View style={styles.metrics}>
            <Metric label="إجمالي الفواتير" value={String(stats.total)} icon="clipboard-list-outline" />
            <Metric label="المنتهية" value={String(stats.closed)} icon="check-circle-outline" accent={palette.tealDeep} />
            <Metric label="المتبقية" value={String(stats.remaining)} icon="timer-sand" accent={palette.blue} />
            <Metric label="مرحّلة بنواقص" value={String(stats.posted)} icon="arrow-right-bold-box-outline" accent={palette.amber} />
          </View>

          <Card>
            <SectionTitle title="تقدم المراجعة" hint={`${stats.closed} من ${stats.total} فاتورة منتهية`} action={<Text style={styles.percent}>{percent}%</Text>} />
            <ProgressBar percent={percent} />
            <ProgressChart closedAt={stats.timeline} total={stats.total} />
          </Card>

          <Card>
            <SectionTitle title="أخطاء المسح" hint="تُجمع كلها في التقرير القابل للطباعة" />
            <View style={styles.metrics}>
              <Metric label="أخطاء تجهيز" value={String(stats.wrongScans)} icon="close-octagon-outline" accent={stats.wrongScans ? palette.red : palette.tealDeep} />
              <Metric label="تجهيز زائد" value={String(stats.overScans)} icon="plus-circle-outline" accent={stats.overScans ? palette.amber : palette.tealDeep} />
              <Metric label="مسحات غير مرتبطة" value={String(stats.unknownScans)} icon="help-circle-outline" accent={stats.unknownScans ? palette.amber : palette.tealDeep} />
            </View>
            <Button title="عرض التقرير وطباعته" icon="printer-outline" variant="secondary" onPress={() => router.navigate("/report")} />
          </Card>
        </>
      ) : null}

      <Card>
        <SectionTitle title="إجراءات" />
        <View style={styles.actions}>
          <View style={styles.action}><Button title="بدء المسح" icon="barcode-scan" onPress={() => router.navigate("/scan")} disabled={!stats || stats.total === 0} /></View>
          <View style={styles.action}><Button title="استيراد ملف Excel" icon="file-upload-outline" variant="outline" onPress={() => router.push("/import")} /></View>
          <View style={styles.action}><Button title="بدء دفعة جديدة (مسح البيانات)" icon="delete-sweep-outline" variant="danger" onPress={confirmReset} disabled={!stats || stats.total === 0} /></View>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  percent: { color: palette.tealDeep, fontSize: 26, fontWeight: "900" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  action: { flexGrow: 1, minWidth: 220 },
});
