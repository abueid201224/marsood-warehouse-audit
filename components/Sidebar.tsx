import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { isActive } from "@/lib/nav";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Icon = keyof typeof MaterialCommunityIcons.glyphMap;
export interface NavItem {
  href: string;
  label: string;
  icon: Icon;
  /** يعمل حتى قبل تسجيل الدخول */
  public?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/account", label: "الدخول والحساب", icon: "account-circle-outline", public: true },
  { href: "/", label: "لوحة العمل", icon: "warehouse" },
  { href: "/scan", label: "التدقيق", icon: "barcode-scan" },
  { href: "/invoices", label: "الفواتير", icon: "clipboard-list-outline" },
  { href: "/report", label: "التقارير", icon: "file-document-outline" },
  { href: "/count", label: "الاستلام والجرد", icon: "package-variant-closed" },
  { href: "/settings", label: "الإعدادات", icon: "cog-outline" },
];

const BG = "#0B3B4A";
const ACTIVE_BG = "#FFFFFF";
const ACTIVE_FG = "#0B3B4A";
const INACTIVE_FG = "#E6F1F3";

/** قائمة تبويبات رأسية جانبية: موسّعة بالتسميات على الشاشات العريضة، وشريط أيقونات بتسمية صغيرة على الضيقة. */
export function Sidebar({ signedIn, userName, onLogout }: { signedIn: boolean; userName?: string; onLogout: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const expanded = width >= 840;
  return (
    <View style={[styles.bar, { width: expanded ? 232 : 88, paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 12) }]} accessibilityRole="tablist">
      <View style={styles.brand}>
        <MaterialCommunityIcons name="radar" size={expanded ? 30 : 28} color="#FFFFFF" />
        {expanded ? <Text style={styles.brandText}>مِرصاد المستودع</Text> : null}
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const locked = !signedIn && !item.public;
          return (
            <Pressable
              key={item.href}
              accessibilityRole="tab"
              accessibilityState={{ selected: active, disabled: locked }}
              accessibilityLabel={item.label}
              disabled={locked}
              onPress={() => router.navigate(item.href as never)}
              style={[styles.item, expanded ? styles.itemWide : styles.itemRail, active && styles.itemActive, locked && { opacity: 0.4 }]}
            >
              <MaterialCommunityIcons name={item.icon} size={expanded ? 24 : 26} color={active ? ACTIVE_FG : INACTIVE_FG} />
              <Text numberOfLines={2} style={[expanded ? styles.labelWide : styles.labelRail, { color: active ? ACTIVE_FG : INACTIVE_FG }]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {signedIn ? (
        <Pressable accessibilityRole="button" accessibilityLabel="تسجيل الخروج" onPress={onLogout} style={[styles.item, expanded ? styles.itemWide : styles.itemRail, styles.logout]}>
          <MaterialCommunityIcons name="logout" size={24} color="#FFFFFF" />
          <Text numberOfLines={2} style={[expanded ? styles.labelWide : styles.labelRail, { color: "#FFFFFF" }]}>{expanded && userName ? `خروج (${userName})` : "خروج"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: BG, paddingHorizontal: 10, gap: 10 },
  brand: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#2A5C6B", marginBottom: 6 },
  brandText: { color: "#FFFFFF", fontSize: 18, fontWeight: "900" },
  item: { borderRadius: 14, minHeight: 56, borderWidth: 1, borderColor: "transparent" },
  itemWide: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14 },
  itemRail: { alignItems: "center", justifyContent: "center", gap: 3, paddingVertical: 8, paddingHorizontal: 2 },
  itemActive: { backgroundColor: ACTIVE_BG },
  logout: { backgroundColor: "#B42318" },
  labelWide: { flex: 1, fontSize: 16, fontWeight: "800", textAlign: "right" },
  labelRail: { fontSize: 13, fontWeight: "800", textAlign: "center" },
});
