// app/(tabs)/_layout.tsx
// FIXED VERSION - Badge now uses useLowStockCount(siteId) instead of useUnreadAlerts
// to dynamically reflect the actual number of low-stock items from Firestore,
// computed from real quantity values (currentQuantity <= minQuantity).
// When all items are back in stock, the badge disappears.
//
// ALL original features preserved:
// - 6 tabs: index (Inventory), explore (Scan), alerts (Alerts), disposal (Disposal), settings (Settings), admin (Admin)
// - Custom badge rendering with View/Text components
// - Push notifications hook
// - BRAND constants for header titles
// - Admin tab conditional rendering based on role
// - Full header styling and theme integration

import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { Text, View } from "react-native";

import { BRAND } from "../../constants/branding";
import { useAppTheme } from "../../constants/theme";
import { usePushNotifications } from "../../hooks/usePushNotifications";
import { useUserProfile } from "../../hooks/useUserProfile";
// FIX: Replaced useUnreadAlerts with useLowStockCount for accurate badge count
import { useLowStockCount } from "../../hooks/useLowStockCount";

export default function TabLayout() {
  const theme = useAppTheme();

  // user + role + site
  const { profile, siteId } = useUserProfile();
  const role = profile?.role ?? "staff";

  // push token (saved with siteId)
  const token = usePushNotifications({ saveToFirestore: true, siteId: siteId ?? undefined }) as string | null;

  // FIX: Low stock count replaces unreadCount — dynamically computed from Firestore
  const lowStockCount = useLowStockCount(siteId);


  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTitleStyle: {
          color: theme.text,
          fontWeight: "700",
          fontSize: 20,
        },
        headerTitleAlign: "center",
        tabBarStyle: {
          backgroundColor: theme.background,
          borderTopColor: theme.border,
        },
        tabBarActiveTintColor: theme.tint,
        tabBarInactiveTintColor: theme.icon,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Inventory",
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="clipboard-outline" color={color} size={size} />
          ),
        }}
      />

      <Tabs.Screen
        name="explore"
        options={{
          title: "Scan",
          headerTitle: "Scan & Update",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="barcode-outline" color={color} size={size} />
          ),
        }}
      />

      <Tabs.Screen
        name="alerts"
        options={{
          title: "Alerts",
          headerTitle: "Stock Alerts",
          tabBarIcon: ({ color, size }) => (
            <View style={{ width: size, height: size }}>
              <Ionicons name="notifications-outline" color={color} size={size} />
              {lowStockCount > 0 && (
                <View
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -6,
                    backgroundColor: "#ef4444",
                    borderRadius: 10,
                    minWidth: 18,
                    height: 18,
                    justifyContent: "center",
                    alignItems: "center",
                    paddingHorizontal: 4,
                  }}
                >
                  <Text
                    style={{
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: "900",
                    }}
                  >
                    {lowStockCount > 99 ? "99+" : lowStockCount}
                  </Text>
                </View>
              )}
            </View>
          ),
        }}
      />

      <Tabs.Screen
        name="disposal"
        options={{
          title: "Disposal",
          headerTitle: "Asset Disposal",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trash-outline" color={color} size={size} />
          ),
        }}
      />

      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          headerTitle: `${BRAND.appName} Settings`,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" color={color} size={size} />
          ),
        }}
      />

      {/* ✅ Admin tab ONLY rendered for admins */}
      <Tabs.Screen
        name="admin"
        options={{
          title: "Admin",
          headerTitle: "Admin",
          href: role === "admin" ? "/admin" : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons
              name="shield-checkmark-outline"
              color={color}
              size={size}
            />
          ),
        }}
      />
    </Tabs>
  );
}
