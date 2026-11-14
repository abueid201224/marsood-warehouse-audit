import { useEffect, useState } from "react";
import { Tabs } from "expo-router";
import { LoginGate } from "@/components/LoginGate";
import { useEngine } from "@/lib/core/hooks";
import { startPrintWatchdog } from "@/lib/print/runtime";
import { backupQuietly } from "@/lib/backup/files";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLayout } from "@/lib/layout";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { palette } from "@/lib/palette";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { isWide } = useLayout();
  // الارتفاع يُحسب من حافة النظام السفلية (شريط الإيماءات/الأزرار) فلا تتداخل الأزرار مع التبويبات
  const bottom = Math.max(insets.bottom, 8);
  const { engine } = useEngine();
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    if (!engine) return;
    const sync = () => setSignedIn(engine.getSession() !== null);
    sync();
    return engine.subscribeSession(sync);
  }, [engine]);
  useEffect(() => {
    if (engine && signedIn) backupQuietly(engine, "start");
  }, [engine, signedIn]);
  useEffect(() => (engine && signedIn ? startPrintWatchdog(engine) : undefined), [engine, signedIn]);
  if (!engine) return null;
  if (!signedIn) return <LoginGate engine={engine} />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.tealDeep,
        tabBarInactiveTintColor: palette.subtle,
        tabBarLabelPosition: isWide ? "beside-icon" : "below-icon",
        tabBarLabelStyle: { fontSize: isWide ? 14 : 11, fontWeight: "700", marginTop: 1 },
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.line,
          borderTopWidth: 1,
          height: (isWide ? 60 : 56) + bottom,
          paddingTop: 7,
          paddingBottom: bottom,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "لوحة العمل", tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="warehouse" color={color} size={size} /> }} />
      <Tabs.Screen name="scan" options={{ title: "المسح", tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="barcode-scan" color={color} size={size} /> }} />
      <Tabs.Screen name="invoices" options={{ title: "الفواتير", tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="clipboard-list-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="report" options={{ title: "التقرير", tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="file-document-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="settings" options={{ title: "الإعدادات", tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="cog-outline" color={color} size={size} /> }} />
    </Tabs>
  );
}
