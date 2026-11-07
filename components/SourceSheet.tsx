import { Modal, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Button } from "@/components/MarsoodUI";
import { palette } from "@/lib/palette";

/** نافذة تشرح مصادر الاستيراد وتطلب الإذن قبل فتح منتقي ملفات النظام. */
export function SourceSheet({ visible, kind, onConfirm, onCancel }: { visible: boolean; kind: "excel" | "pdf"; onConfirm: () => void; onCancel: () => void }) {
  const what = kind === "excel" ? "ملف Excel للفواتير اليومية" : "ملفات PDF للفواتير والبوالص";
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.shade}>
        <View style={styles.sheet}>
          <View style={styles.icon}><MaterialCommunityIcons name="cloud-download-outline" size={30} color={palette.tealDeep} /></View>
          <Text style={styles.title}>اختيار {what}</Text>
          <Text style={styles.body}>سيفتح التطبيق منتقي الملفات الخاص بالنظام، وقد يطلب منك النظام السماح بالوصول إلى التخزين. لا يصل «مرصاد» إلا إلى ما تختاره أنت.</Text>
          <View style={styles.sources}>
            <Text style={styles.source}>• ذاكرة الجهاز (التنزيلات، المستندات)</Text>
            <Text style={styles.source}>• Google Drive</Text>
            <Text style={styles.source}>• OneDrive</Text>
          </View>
          <Text style={styles.hint}>للتنقل بين المصادر افتح القائمة الجانبية في المنتقي واختر المصدر. تظهر Drive وOneDrive إذا كان تطبيقاهما مثبّتين ومسجَّلاً الدخول فيهما. ملفات Google Sheets الأصلية: احفظها أولاً بصيغة Excel (XLSX).{kind === "pdf" ? " يمكنك تحديد عدة ملفات PDF دفعة واحدة؛ تُنسخ إلى التطبيق وتُفهرس بأسمائها." : ""}</Text>
          <Button title="متابعة واختيار الملف" icon="folder-open-outline" onPress={onConfirm} />
          <Button title="إلغاء" variant="outline" onPress={onCancel} compact />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shade: { flex: 1, backgroundColor: "rgba(17,35,62,0.5)", justifyContent: "center", alignItems: "center", padding: 24 },
  sheet: { width: "100%", maxWidth: 520, backgroundColor: palette.surface, borderRadius: 22, padding: 20, gap: 12 },
  icon: { width: 56, height: 56, borderRadius: 19, backgroundColor: palette.tealPale, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  title: { color: palette.ink, fontSize: 18, fontWeight: "900", textAlign: "center" },
  body: { color: palette.inkSoft, fontSize: 13, lineHeight: 21, textAlign: "right" },
  sources: { gap: 4, backgroundColor: palette.surfaceMuted, borderRadius: 12, padding: 12 },
  source: { color: palette.ink, fontSize: 13, fontWeight: "700", textAlign: "right" },
  hint: { color: palette.muted, fontSize: 12, lineHeight: 19, textAlign: "right" },
});
