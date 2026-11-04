import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { palette } from "@/lib/palette";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.tealDeep,
        tabBarInactiveTintColor: palette.subtle,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700", marginTop: 1 },
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.line,
          borderTopWidth: 1,
          height: Platform.OS === "web" ? 66 : 70,
          paddingTop: 7,
          paddingBottom: Platform.OS === "web" ? 9 : 10,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "لوحة العمل",
          tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="warehouse" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: "الفواتير",
          tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="clipboard-list-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
