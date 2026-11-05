import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { palette } from "@/lib/palette";

/** مهلة الصمت بعد آخر حرف لاعتماد القراءة إذا لم يرسل القارئ Enter/Tab (القارئ يُنهي الكود في أجزاء من الثانية). */
const IDLE_SUBMIT_MS = 350;
/** أقل طول لاعتماد القراءة بالصمت، حتى لا تُعتمد أحرف عابرة. */
const IDLE_MIN_LENGTH = 3;
const TERMINATORS = /[\r\n\t]/;

/**
 * مدخل قارئ الباركود الخطي (يعمل كلوحة مفاتيح HID):
 * - يعتمد القراءة عند Enter أو Tab (حرف منهي داخل النص، أو ضغطة مفتاح، أو إرسال الحقل).
 * - إذا انتقل التركيز بسبب Tab يعتمد ما كُتب ثم يستعيد التركيز.
 * - يعتمد القراءة بعد توقف قصير عن الكتابة إن لم يُرسل القارئ حرفاً منهياً.
 * - يحافظ على التركيز دائماً ويخفي لوحة المفاتيح الافتراضية (يمكن إظهارها للإدخال اليدوي).
 */
export function ScannerInput({
  onScan,
  disabled = false,
  placeholder = "امسح البوليصة أو كود الصنف",
}: {
  onScan: (code: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [soft, setSoft] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const valueRef = useRef("");
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const softRef = useRef(false);
  const disabledRef = useRef(disabled);
  const onScanRef = useRef(onScan);

  useEffect(() => {
    disabledRef.current = disabled;
    onScanRef.current = onScan;
    softRef.current = soft;
  });

  const clearIdle = () => {
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = null;
  };

  const focusSoon = useCallback((delay = 40) => {
    setTimeout(() => {
      if (!disabledRef.current) inputRef.current?.focus();
    }, delay);
  }, []);

  const flush = useCallback(() => {
    clearIdle();
    const code = valueRef.current.replace(/[\r\n\t]/g, "").trim();
    valueRef.current = "";
    setValue("");
    if (code && !disabledRef.current) onScanRef.current(code);
    focusSoon();
  }, [focusSoon]);

  const scheduleIdle = useCallback(() => {
    clearIdle();
    if (softRef.current) return; // الإدخال اليدوي: لا اعتماد تلقائي
    if (valueRef.current.trim().length < IDLE_MIN_LENGTH) return;
    idleRef.current = setTimeout(flush, IDLE_SUBMIT_MS);
  }, [flush]);

  // إبقاء التركيز على الحقل حتى لو سرقته أزرار أو نافذة
  useEffect(() => {
    if (disabled) return;
    const first = setTimeout(() => inputRef.current?.focus(), 200);
    const keeper = setInterval(() => {
      if (!disabledRef.current && inputRef.current && !inputRef.current.isFocused()) inputRef.current.focus();
    }, 1200);
    return () => {
      clearTimeout(first);
      clearInterval(keeper);
      clearIdle();
    };
  }, [disabled]);

  const onChangeText = (text: string) => {
    if (TERMINATORS.test(text)) {
      // القارئ أرسل Enter/Tab كحرف داخل النص
      const [head] = text.split(TERMINATORS).filter(Boolean);
      valueRef.current = head ?? "";
      setValue(valueRef.current);
      flush();
      return;
    }
    valueRef.current = text;
    setValue(text);
    scheduleIdle();
  };

  const toggleSoft = () => {
    const next = !soft;
    softRef.current = next;
    setSoft(next);
    clearIdle();
    inputRef.current?.blur();
    focusSoon(120);
  };

  return (
    <View style={styles.wrapper}>
      <View style={[styles.inputShell, disabled && { opacity: 0.5 }]}>
        <MaterialCommunityIcons name="barcode-scan" size={26} color={palette.tealDeep} />
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={flush}
          onKeyPress={({ nativeEvent }) => {
            if (nativeEvent.key === "Tab" || nativeEvent.key === "Enter") flush();
          }}
          onBlur={() => {
            if (valueRef.current.trim()) flush();
            else focusSoon(60);
          }}
          placeholder={placeholder}
          placeholderTextColor={palette.subtle}
          style={styles.input}
          autoFocus
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          returnKeyType="done"
          submitBehavior="submit"
          showSoftInputOnFocus={soft}
          editable={!disabled}
          accessibilityLabel="حقل مسح الباركود"
          importantForAutofill="no"
        />
        {value.length > 0 ? (
          <Pressable onPress={flush} accessibilityLabel="اعتماد القراءة" style={styles.submit}>
            <MaterialCommunityIcons name="keyboard-return" size={20} color={palette.white} />
          </Pressable>
        ) : null}
        <Pressable onPress={toggleSoft} accessibilityLabel={soft ? "إخفاء لوحة المفاتيح" : "إدخال يدوي"} style={styles.keyboardToggle}>
          <MaterialCommunityIcons name={soft ? "keyboard-off-outline" : "keyboard-outline"} size={22} color={palette.muted} />
        </Pressable>
      </View>
      <Text style={styles.caption}>{soft ? "إدخال يدوي: اكتب الكود ثم اضغط Enter" : "قارئ HID: يُعتمد الكود تلقائياً عند Enter أو Tab أو بعد توقف القراءة"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 7 },
  inputShell: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 11, borderRadius: 16, borderWidth: 2, borderColor: palette.teal, backgroundColor: palette.white, paddingHorizontal: 13 },
  input: { flex: 1, color: palette.ink, fontSize: 20, fontWeight: "800", paddingVertical: 14, textAlign: "right", writingDirection: "ltr" },
  submit: { width: 40, height: 40, borderRadius: 12, backgroundColor: palette.teal, alignItems: "center", justifyContent: "center" },
  keyboardToggle: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  caption: { color: palette.muted, fontSize: 11, textAlign: "right" },
});
