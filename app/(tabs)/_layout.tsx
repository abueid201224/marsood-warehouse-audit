import { useEffect, useState } from "react";
import { View } from "react-native";
import { Tabs } from "expo-router";
import { LoginGate } from "@/components/LoginGate";
import { Sidebar } from "@/components/Sidebar";
import { useEngine } from "@/lib/core/hooks";
import { startPrintWatchdog } from "@/lib/print/runtime";
import { backupQuietly } from "@/lib/backup/files";
import { palette } from "@/lib/palette";

export default function TabLayout() {
  const { engine } = useEngine();
  const [signedIn, setSignedIn] = useState(false);
  const [userName, setUserName] = useState("");
  useEffect(() => {
    if (!engine) return;
    const sync = () => {
      const session = engine.getSession();
      setSignedIn(session !== null);
      setUserName(session?.name ?? "");
    };
    sync();
    return engine.subscribeSession(sync);
  }, [engine]);
  useEffect(() => {
    if (engine && signedIn) backupQuietly(engine, "start");
  }, [engine, signedIn]);
  useEffect(() => (engine && signedIn ? startPrintWatchdog(engine) : undefined), [engine, signedIn]);
  if (!engine) return null;
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: palette.background }}>
      <Sidebar signedIn={signedIn} userName={userName} onLogout={() => void engine.logout()} />
      <View style={{ flex: 1 }}>
        {signedIn ? (
          // شريط التبويبات الافتراضي مخفي: التنقل عبر القائمة الجانبية
          <Tabs initialRouteName="account" screenOptions={{ headerShown: false, tabBarStyle: { display: "none" } }}>
            <Tabs.Screen name="account" options={{ title: "الدخول والحساب" }} />
            <Tabs.Screen name="index" options={{ title: "لوحة العمل" }} />
            <Tabs.Screen name="scan" options={{ title: "التدقيق" }} />
            <Tabs.Screen name="invoices" options={{ title: "الفواتير" }} />
            <Tabs.Screen name="report" options={{ title: "التقارير" }} />
            <Tabs.Screen name="settings" options={{ title: "الإعدادات" }} />
          </Tabs>
        ) : (
          <LoginGate engine={engine} />
        )}
      </View>
    </View>
  );
}
