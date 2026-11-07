import "@/global.css";
import { Stack } from "expo-router";
import { Text, TextInput } from "react-native";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { palette } from "@/lib/palette";

// تكبير الخط من إعدادات النظام مسموح حتى 1.3× كي لا تنكسر الواجهة (إمكانية الوصول دون تشويه التخطيط)
type WithDefaults = { defaultProps?: { maxFontSizeMultiplier?: number } };
(Text as unknown as WithDefaults).defaultProps = { ...(Text as unknown as WithDefaults).defaultProps, maxFontSizeMultiplier: 1.3 };
(TextInput as unknown as WithDefaults).defaultProps = { ...(TextInput as unknown as WithDefaults).defaultProps, maxFontSizeMultiplier: 1.3 };

export const unstable_settings = { anchor: "(tabs)" };

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.background }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.background } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="import" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
