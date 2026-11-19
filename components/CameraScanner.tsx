import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Haptics from "expo-haptics";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { createScanGate } from "@/lib/scanGate";
import { palette } from "@/lib/palette";

const TYPES = ["code128", "code39", "code93", "ean13", "ean8", "upc_a", "upc_e", "itf14", "codabar", "qr"] as const;

/** مسح بالكاميرا (يعمل بلا إنترنت): كل كود ظاهر يُقبل مرة واحدة، ويُعاد تسليحه بعد غيابه. */
export function CameraScanner({ onScan, active }: { onScan: (code: string) => void; active: boolean }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const gate = useRef(createScanGate()).current;
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => { gate.reset(); }, [active, gate]);

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <View style={styles.box}>
        <MaterialCommunityIcons name="camera-off-outline" size={30} color={palette.muted} />
        <Text style={styles.text}>{permission.canAskAgain ? "يلزم إذن الكاميرا للمسح بها. الصور لا تُحفظ ولا تغادر الجهاز." : "إذن الكاميرا مرفوض. فعّله من إعدادات النظام ثم ارجع."}</Text>
        <Pressable
          onPress={() => (permission.canAskAgain ? void requestPermission() : void Linking.openSettings())}
          style={styles.button}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{permission.canAskAgain ? "السماح بالكاميرا" : "فتح الإعدادات"}</Text>
        </Pressable>
      </View>
    );
  }

  const handle = (result: BarcodeScanningResult) => {
    if (!active || !gate.accept(result.data, Date.now())) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    onScanRef.current(result.data);
  };

  return (
    <View style={styles.camera}>
      {active ? (
        <CameraView style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} barcodeScannerSettings={{ barcodeTypes: [...TYPES] }} onBarcodeScanned={handle} />
      ) : null}
      <View pointerEvents="none" style={styles.frame} />
      <Pressable onPress={() => setTorch((v) => !v)} style={styles.torch} accessibilityRole="button" accessibilityLabel="المصباح">
        <MaterialCommunityIcons name={torch ? "flashlight" : "flashlight-off"} size={22} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", gap: 10, padding: 18, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: "#FFFFFF" },
  text: { color: palette.muted, fontSize: 14, lineHeight: 21, textAlign: "center" },
  button: { minHeight: 46, borderRadius: 12, backgroundColor: "#0B3B4A", paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#FFFFFF", fontWeight: "800", fontSize: 15 },
  camera: { height: 220, borderRadius: 16, overflow: "hidden", backgroundColor: "#000000", alignItems: "center", justifyContent: "center" },
  frame: { width: "78%", height: 110, borderWidth: 3, borderColor: "#34D399", borderRadius: 12 },
  torch: { position: "absolute", top: 10, end: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
});
