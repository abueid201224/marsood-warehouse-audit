import type { PropsWithChildren, ReactNode } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { palette } from "@/lib/palette";

export function Screen({ children, scroll = true }: PropsWithChildren<{ scroll?: boolean }>) {
  return (
    <SafeAreaView style={styles.safe}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.page, { flex: 1 }]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Header({
  title,
  subtitle,
  leading,
  right,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerTitle}>
        {leading}
        <View style={{ flex: 1 }}>
          <Text style={styles.headerHeading}>{title}</Text>
          {subtitle ? <Text style={styles.headerSub}>{subtitle}</Text> : null}
        </View>
      </View>
      {right}
    </View>
  );
}

export function SectionTitle({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionHeading}>{title}</Text>
        {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function Card({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  title,
  onPress,
  icon,
  variant = "primary",
  disabled = false,
  compact = false,
}: {
  title: string;
  onPress: () => void;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  variant?: "primary" | "secondary" | "outline" | "danger";
  disabled?: boolean;
  compact?: boolean;
}) {
  const color = variant === "primary" ? palette.white : variant === "danger" ? palette.red : palette.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        variant === "primary" && styles.buttonPrimary,
        variant === "secondary" && styles.buttonSecondary,
        variant === "outline" && styles.buttonOutline,
        variant === "danger" && styles.buttonDanger,
        disabled && styles.buttonDisabled,
        pressed && !disabled && { opacity: 0.82, transform: [{ scale: 0.99 }] },
      ]}
    >
      {icon ? <MaterialCommunityIcons name={icon} size={compact ? 18 : 20} color={color} /> : null}
      <Text style={[styles.buttonText, { color }, compact && { fontSize: 13 }]}>{title}</Text>
    </Pressable>
  );
}

export function StatusBadge({ state, label }: { state: "good" | "warning" | "bad" | "neutral"; label: string }) {
  const config = {
    good: { bg: palette.tealPale, color: palette.tealDeep, icon: "check-circle-outline" as const },
    warning: { bg: palette.amberPale, color: palette.amber, icon: "alert-circle-outline" as const },
    bad: { bg: palette.redPale, color: palette.red, icon: "close-circle-outline" as const },
    neutral: { bg: palette.bluePale, color: palette.blue, icon: "clock-outline" as const },
  }[state];
  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <MaterialCommunityIcons name={config.icon} size={15} color={config.color} />
      <Text style={[styles.badgeText, { color: config.color }]}>{label}</Text>
    </View>
  );
}

export function Notice({
  title,
  body,
  tone = "info",
  icon,
}: {
  title: string;
  body: string;
  tone?: "info" | "warning" | "danger" | "success";
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
}) {
  const config = {
    info: { bg: palette.bluePale, color: palette.blue, icon: "information-outline" as const },
    warning: { bg: palette.amberPale, color: palette.amber, icon: "alert-outline" as const },
    danger: { bg: palette.redPale, color: palette.red, icon: "alert-octagon-outline" as const },
    success: { bg: palette.tealPale, color: palette.tealDeep, icon: "check-circle-outline" as const },
  }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: config.bg }]}>
      <MaterialCommunityIcons name={icon ?? config.icon} size={21} color={config.color} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.noticeTitle, { color: config.color }]}>{title}</Text>
        <Text style={styles.noticeBody}>{body}</Text>
      </View>
    </View>
  );
}

export function Metric({ label, value, accent = palette.ink, icon }: { label: string; value: string; accent?: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }) {
  return (
    <View style={styles.metric}>
      <View style={styles.metricTop}>
        <MaterialCommunityIcons name={icon} size={18} color={accent} />
        <Text style={styles.metricLabel}>{label}</Text>
      </View>
      <Text style={[styles.metricValue, { color: accent }]}>{value}</Text>
    </View>
  );
}

export function ProgressBar({ percent, color = palette.teal }: { percent: number; color?: string }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <View style={styles.barTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: value }}>
      <View style={[styles.barFill, { width: `${value}%`, backgroundColor: color }]} />
    </View>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; title: string; body: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><MaterialCommunityIcons name={icon} size={30} color={palette.teal} /></View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  page: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 32, gap: 18, width: "100%", maxWidth: 1120, alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, paddingBottom: 2 },
  headerTitle: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  headerHeading: { color: palette.ink, fontSize: 25, fontWeight: "800", textAlign: "right" },
  headerSub: { color: palette.muted, fontSize: 13, lineHeight: 20, textAlign: "right", marginTop: 3 },
  sectionTitle: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 3 },
  sectionHeading: { color: palette.ink, fontSize: 17, fontWeight: "800", textAlign: "right" },
  sectionHint: { color: palette.muted, fontSize: 12, textAlign: "right", marginTop: 3 },
  card: { backgroundColor: palette.surface, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: palette.line, gap: 14 },
  button: { minHeight: 48, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  buttonCompact: { minHeight: 38, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12 },
  buttonPrimary: { backgroundColor: palette.ink },
  buttonSecondary: { backgroundColor: palette.tealPale },
  buttonOutline: { backgroundColor: palette.surface, borderColor: palette.line, borderWidth: 1 },
  buttonDanger: { backgroundColor: palette.redPale, borderColor: "#E8C6C2", borderWidth: 1 },
  buttonDisabled: { opacity: 0.48 },
  buttonText: { fontWeight: "800", fontSize: 15, textAlign: "center" },
  badge: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  badgeText: { fontSize: 11, fontWeight: "800" },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 15, paddingHorizontal: 14, paddingVertical: 12 },
  noticeTitle: { fontWeight: "800", fontSize: 13, textAlign: "right" },
  noticeBody: { color: palette.inkSoft, fontSize: 12, lineHeight: 19, marginTop: 3, textAlign: "right" },
  metric: { flex: 1, minWidth: 126, backgroundColor: palette.surfaceMuted, borderRadius: 15, padding: 14, borderWidth: 1, borderColor: palette.line },
  metricTop: { flexDirection: "row", alignItems: "center", gap: 7 },
  metricLabel: { flex: 1, color: palette.muted, textAlign: "right", fontSize: 12, fontWeight: "700" },
  metricValue: { fontSize: 24, fontWeight: "900", marginTop: 10, textAlign: "right" },
  barTrack: { height: 10, borderRadius: 6, backgroundColor: palette.line, overflow: "hidden" },
  barFill: { height: 10, borderRadius: 6 },
  empty: { alignItems: "center", justifyContent: "center", paddingHorizontal: 18, paddingVertical: 26, gap: 9 },
  emptyIcon: { width: 58, height: 58, borderRadius: 19, backgroundColor: palette.tealPale, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { color: palette.ink, fontSize: 16, fontWeight: "800", textAlign: "center" },
  emptyBody: { color: palette.muted, fontSize: 13, lineHeight: 21, textAlign: "center", maxWidth: 470 },
});
