import "@/global.css";
import { useEffect } from "react";
import { Stack } from "expo-router";
import { Pressable, Text, TextInput, View } from "react-native";
import { installGlobalHandlers, attachDiagnostics, reportError } from "@/lib/diagnostics";
import { getEngine } from "@/lib/core/database";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { palette } from "@/lib/palette";

// تكبير الخط من إعدادات النظام مسموح حتى 1.3× كي لا تنكسر الواجهة (إمكانية الوصول دون تشويه التخطيط)
type WithDefaults = { defaultProps?: { maxFontSizeMultiplier?: number } };
(Text as unknown as WithDefaults).defaultProps = { ...(Text as unknown as WithDefaults).defaultProps, maxFontSizeMultiplier: 1.3 };
(TextInput as unknown as WithDefaults).defaultProps = { ...(TextInput as unknown as WithDefaults).defaultProps, maxFontSizeMultiplier: 1.3 };

installGlobalHandlers();

/** شاشة خطأ آمنة بدل الانهيار: تُسجَّل في سجل الأعطال المحلي وتتيح إعادة المحاولة. */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  useEffect(() => { reportError("boundary", error); }, [error]);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24, backgroundColor: palette.background }}>
      <Text style={{ color: palette.ink, fontSize: 20, fontWeight: "900", textAlign: "center" }}>حدث خطأ غير متوقع</Text>
      <Text style={{ color: palette.muted, fontSize: 14, textAlign: "center" }}>سُجّل العطل في سجل الأعطال (للمشرف). بياناتك المحفوظة سليمة.</Text>
      <Pressable onPress={retry} accessibilityRole="button" style={{ minHeight: 50, borderRadius: 14, backgroundColor: "#0B3B4A", paddingHorizontal: 24, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 16 }}>إعادة المحاولة</Text>
      </Pressable>
    </View>
  );
}

export const unstable_settings = { anchor: "(tabs)" };

export default function RootLayout() {
  useEffect(() => { getEngine().then(attachDiagnostics).catch((e: unknown) => reportError("db", e)); }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.background }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.background } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="import" />
          <Stack.Screen name="audit" />
          <Stack.Screen name="productivity" />
          <Stack.Screen name="diagnostics" />
          <Stack.Screen name="packaging" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
