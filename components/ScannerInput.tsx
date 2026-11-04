import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { palette } from "@/lib/palette";

export function ScannerInput({
  onScan,
  disabled = false,
  placeholder = "ضع المؤشر هنا ثم امسح الباركود",
}: {
  onScan: (barcode: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<TextInput>(null);
  const valueRef = useRef("");

  useEffect(() => {
    if (disabled) {
      inputRef.current?.blur();
      return;
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(timer);
  }, [disabled]);

  const submit = useCallback(() => {
    const code = valueRef.current.trim();
    if (!code || disabled) return;
    valueRef.current = "";
    setValue("");
    onScan(code);
    setTimeout(() => inputRef.current?.focus(), 70);
  }, [disabled, onScan]);

  return (
    <View style={styles.wrapper}>
      <View style={styles.inputShell}>
        <MaterialCommunityIcons name="barcode-scan" size={24} color={palette.tealDeep} />
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={(text) => { valueRef.current = text; setValue(text); }}
          onSubmitEditing={submit}
          onKeyPress={({ nativeEvent }) => { if (nativeEvent.key === "Tab") submit(); }}
          placeholder={placeholder}
          placeholderTextColor={palette.subtle}
          style={styles.input}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="done"
          blurOnSubmit={false}
          showSoftInputOnFocus={false}
          editable={!disabled}
          accessibilityLabel="حقل مسح الباركود"
          importantForAutofill="no"
          onFocus={() => {}}
        />
        {value.length > 0 ? <Pressable onPress={submit} accessibilityLabel="اعتماد المسح" style={styles.submit}><MaterialCommunityIcons name="keyboard-return" size={19} color={palette.white} /></Pressable> : null}
      </View>
      <Text style={styles.caption}>قارئ لوحة مفاتيح HID • Enter أو Tab لاعتماد القراءة</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 7 },
  inputShell: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 11, borderRadius: 16, borderWidth: 2, borderColor: palette.teal, backgroundColor: palette.white, paddingLeft: 13, paddingRight: 9 },
  input: { flex: 1, color: palette.ink, fontSize: 17, fontWeight: "700", paddingVertical: 14, textAlign: "right", writingDirection: "ltr" },
  submit: { width: 38, height: 38, borderRadius: 12, backgroundColor: palette.teal, alignItems: "center", justifyContent: "center" },
  caption: { color: palette.muted, fontSize: 11, textAlign: "right" },
});
