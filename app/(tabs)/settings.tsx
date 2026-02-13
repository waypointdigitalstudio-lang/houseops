// app/(tabs)/settings.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { signOut } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";

import { DeviceRegistration } from "@/components/DeviceRegistration";
import { Toast } from "@/components/Toast";
import { BRAND } from "../../constants/branding";
import { useAppTheme } from "../../constants/theme";
import { auth, db } from "../../firebaseConfig";
import { usePushNotifications } from "../../hooks/usePushNotifications";
import { useToast } from "../../hooks/useToast";
import { useUserProfile } from "../../hooks/useUserProfile";
import { useThemePreference } from "../../src/theme/ThemeProvider";
import { exportInventoryToCSV } from "../../utils/exportInventory";

type RegistrationDoc = {
  token: string;
  uid: string;
  siteId: string;
  label?: string;
  platform?: string;
  enabled?: boolean;
  prefs?: { low?: boolean; out?: boolean; restock?: boolean };
};

const STORAGE_LABEL_KEY = "houseops_device_label_v1";
const STORAGE_PREFS_KEY = "houseops_alert_prefs_v1";
const STORAGE_NOTIF_SOUND_KEY = "houseops_notif_sound_v1";
const STORAGE_NOTIF_VIBRATE_KEY = "houseops_notif_vibrate_v1";

type Prefs = { low: boolean; out: boolean; restock: boolean };
const DEFAULT_PREFS: Prefs = { low: true, out: true, restock: true };

const SITES = [
  { id: "ballys_tiverton", label: "Tiverton" },
  { id: "ballys_lincoln", label: "Lincoln" },
];

export default function SettingsScreen() {
  const theme = useAppTheme();
  const { preference, setPreference, resolvedScheme } = useThemePreference();
  const isDark = resolvedScheme === "dark";

  const { uid, profile, siteId, loading: profileLoading } = useUserProfile();
  const isAdmin = profile?.role === "admin";

  const token = usePushNotifications({ saveToFirestore: true, siteId }) as string | null;

  // Toast hook
  const { toast, fadeAnim, showToast, hideToast } = useToast();

  const [storedLabel, setStoredLabel] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  
  // Notification settings
  const [notifSound, setNotifSound] = useState(true);
  const [notifVibrate, setNotifVibrate] = useState(true);
  
  // Export state
  const [exporting, setExporting] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load notification preferences
  useEffect(() => {
    (async () => {
      const sound = await AsyncStorage.getItem(STORAGE_NOTIF_SOUND_KEY);
      const vibrate = await AsyncStorage.getItem(STORAGE_NOTIF_VIBRATE_KEY);
      
      if (sound !== null) setNotifSound(sound === "true");
      if (vibrate !== null) setNotifVibrate(vibrate === "true");
    })();
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const localLabel = await AsyncStorage.getItem(STORAGE_LABEL_KEY);
        if (!alive) return;
        if (localLabel) {
          setStoredLabel(localLabel);
        }

        const localPrefs = await AsyncStorage.getItem(STORAGE_PREFS_KEY);
        if (!alive) return;
        if (localPrefs) {
          try {
            const parsed = JSON.parse(localPrefs);
            setPrefs({
              low: parsed.low ?? true,
              out: parsed.out ?? true,
              restock: parsed.restock ?? true,
            });
          } catch {}
        }

        if (token) {
          const snap = await getDoc(doc(db, "devicePushTokens", token));
          if (!alive) return;

          if (snap.exists()) {
            const data = snap.data() as RegistrationDoc;

            if ((!localLabel || localLabel.trim().length === 0) && data.label) {
              setStoredLabel(data.label);
              await AsyncStorage.setItem(STORAGE_LABEL_KEY, data.label);
            }

            if (data.prefs) {
              const merged: Prefs = {
                low: data.prefs.low ?? true,
                out: data.prefs.out ?? true,
                restock: data.prefs.restock ?? true,
              };
              setPrefs(merged);
              await AsyncStorage.setItem(STORAGE_PREFS_KEY, JSON.stringify(merged));
            }
          }
        }
      } catch (e) {
        console.log("Settings boot error:", e);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [token]);

  const updatePrefs = async (next: Prefs) => {
    setPrefs(next);
    await AsyncStorage.setItem(STORAGE_PREFS_KEY, JSON.stringify(next));

    if (token && uid && siteId) {
      try {
        await updateDoc(doc(db, "devicePushTokens", token), {
          prefs: next,
          updatedAt: serverTimestamp(),
        });
        showToast("✓ Preferences saved", "success");
      } catch (e) {
        console.log("Prefs save error:", e);
        showToast("Failed to save preferences", "error");
      }
    }
  };

  const handleSwitchSite = async (nextSiteId: string) => {
    if (!uid) {
      showToast("Not signed in", "error");
      return;
    }
    if (!isAdmin) {
      showToast("Only admins can change site", "error");
      return;
    }
    if (nextSiteId === siteId) return;

    setSaving(true);
    try {
      await setDoc(
        doc(db, "users", uid),
        { siteId: nextSiteId, updatedAt: serverTimestamp() },
        { merge: true }
      );
      showToast(`✓ Site changed to ${nextSiteId}`, "success");
    } catch (e) {
      console.log("Switch site failed:", e);
      showToast("Failed to change site", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert("Log out?", "You'll need to sign in again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: async () => {
          try {
            await signOut(auth);
            router.replace("/login");
          } catch (e) {
            console.log("Logout error:", e);
            showToast("Logout failed", "error");
          }
        },
      },
    ]);
  };

  const toggleNotifSound = async (value: boolean) => {
    setNotifSound(value);
    await AsyncStorage.setItem(STORAGE_NOTIF_SOUND_KEY, String(value));
    showToast(value ? "✓ Sound enabled" : "Sound disabled", "success");
  };

  const toggleNotifVibrate = async (value: boolean) => {
    setNotifVibrate(value);
    await AsyncStorage.setItem(STORAGE_NOTIF_VIBRATE_KEY, String(value));
    showToast(value ? "✓ Vibration enabled" : "Vibration disabled", "success");
  };

  const handleExport = async () => {
    if (!siteId) {
      showToast("No site assigned", "error");
      return;
    }

    setExporting(true);
    try {
      await exportInventoryToCSV(siteId);
      showToast("✓ Inventory exported", "success");
    } catch (error) {
      console.error("Export error:", error);
      showToast("Failed to export inventory", "error");
    } finally {
      setExporting(false);
    }
  };

  const Card = ({
    title,
    subtitle,
    children,
  }: {
    title: string;
    subtitle?: string;
    children?: React.ReactNode;
  }) => (
    <View
      style={{
        marginTop: 14,
        backgroundColor: theme.card,
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      <Text style={{ color: theme.text, fontSize: 16, fontWeight: "800" }}>
        {title}
      </Text>
      {!!subtitle && (
        <Text style={{ color: theme.mutedText, fontSize: 12, marginTop: 6 }}>
          {subtitle}
        </Text>
      )}
      {!!children && <View style={{ marginTop: 12 }}>{children}</View>}
    </View>
  );

  const Pill = ({
    label: pillLabel,
    selected,
    onPress,
  }: {
    label: string;
    selected: boolean;
    onPress: () => void;
  }) => (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: selected ? theme.tint : theme.border,
        backgroundColor: selected ? theme.card : "transparent",
        alignItems: "center",
        opacity: saving ? 0.6 : 1,
      }}
      disabled={saving}
    >
      <Text style={{ color: theme.text, fontWeight: selected ? "800" : "700" }}>
        {pillLabel}
      </Text>
    </Pressable>
  );

  const PrefRow = ({
    title,
    subtitle,
    value,
    onChange,
  }: {
    title: string;
    subtitle: string;
    value: boolean;
    onChange: (v: boolean) => void;
  }) => (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: theme.border,
      }}
    >
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={{ color: theme.text, fontSize: 14, fontWeight: "800" }}>
          {title}
        </Text>
        <Text style={{ color: theme.mutedText, fontSize: 12, marginTop: 2 }}>
          {subtitle}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: theme.border, true: theme.tint }}
        thumbColor={isDark ? "#f9fafb" : "#ffffff"}
      />
    </View>
  );

  const InfoRow = ({ label, value }: { label: string; value: string }) => (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
      }}
    >
      <Text style={{ color: theme.mutedText, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: theme.text, fontSize: 13, fontWeight: "700" }}>
        {value}
      </Text>
    </View>
  );

  if (loading || profileLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, padding: 16 }}>
        <StatusBar style={isDark ? "light" : "dark"} />
        <Text style={{ color: theme.text, fontSize: 24, fontWeight: "900" }}>
          Settings
        </Text>
        <Text style={{ color: theme.mutedText, marginTop: 6 }}>Loading…</Text>
      </View>
    );
  }

  const appVersion = Constants.expoConfig?.version || "1.0.0";
  const buildNumber = Constants.expoConfig?.ios?.buildNumber || 
                      Constants.expoConfig?.android?.versionCode || "1";

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.background }}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="always"
      >
        <StatusBar style={isDark ? "light" : "dark"} />

        <Text style={{ color: theme.text, fontSize: 24, fontWeight: "900" }}>
          Settings
        </Text>
        <Text style={{ color: theme.mutedText, marginTop: 6 }}>{BRAND.appName}</Text>

        {/* Appearance */}
        <Card title="Appearance" subtitle="Customize the look and feel">
          <Text style={{ color: theme.text, fontSize: 13, fontWeight: "700", marginBottom: 8 }}>
            Theme
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pill
              label="Light"
              selected={preference === "light"}
              onPress={() => {
                setPreference("light");
                showToast("✓ Light mode enabled", "success");
              }}
            />
            <Pill
              label="Dark"
              selected={preference === "dark"}
              onPress={() => {
                setPreference("dark");
                showToast("✓ Dark mode enabled", "success");
              }}
            />
            <Pill
              label="System"
              selected={preference === "system"}
              onPress={() => {
                setPreference("system");
                showToast("✓ System theme enabled", "success");
              }}
            />
          </View>
        </Card>

        <Card
          title="Site & access"
          subtitle={`Role: ${profile?.role ?? "staff"} • Site: ${siteId ?? "unassigned"}`}
        >
          {!siteId ? (
            <Text style={{ color: "#f87171", fontWeight: "800" }}>
              No site assigned for this user.
            </Text>
          ) : null}

          {isAdmin ? (
            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              {SITES.map((s) => (
                <Pill
                  key={s.id}
                  label={s.label}
                  selected={siteId === s.id}
                  onPress={() => handleSwitchSite(s.id)}
                />
              ))}
            </View>
          ) : (
            <Text style={{ color: theme.mutedText, fontSize: 12 }}>
              You're staff. Site switching is admin-only.
            </Text>
          )}
        </Card>

        <Card
          title="Device registration"
          subtitle={
            storedLabel && token ? "Registered for alerts." : "Register this device for alerts."
          }
        >
          <DeviceRegistration
            theme={theme}
            isDark={isDark}
            uid={uid}
            siteId={siteId}
            token={token}
            storedLabel={storedLabel}
            prefs={prefs}
            onLabelSaved={(label) => {
              setStoredLabel(label);
              showToast("✓ Device registered", "success");
            }}
            onTokenReset={() => {
              setStoredLabel(null);
              showToast("✓ Device token reset", "success");
            }}
          />
        </Card>

        <Card title="Alert preferences" subtitle="Choose which alerts this device should receive">
          <PrefRow
            title="Low stock"
            subtitle="Notify when quantity drops to or below minimum."
            value={prefs.low}
            onChange={(v) => updatePrefs({ ...prefs, low: v })}
          />
          <PrefRow
            title="Out of stock"
            subtitle="Notify when quantity hits 0."
            value={prefs.out}
            onChange={(v) => updatePrefs({ ...prefs, out: v })}
          />
          <PrefRow
            title="Restocked"
            subtitle="Notify when stock returns to OK."
            value={prefs.restock}
            onChange={(v) => updatePrefs({ ...prefs, restock: v })}
          />
        </Card>

        <Card title="Notification settings" subtitle="Control sound and vibration">
          <PrefRow
            title="Sound"
            subtitle="Play sound when receiving alerts"
            value={notifSound}
            onChange={toggleNotifSound}
          />
          <PrefRow
            title="Vibration"
            subtitle="Vibrate when receiving alerts"
            value={notifVibrate}
            onChange={toggleNotifVibrate}
          />
        </Card>

        <Card title="Data management" subtitle="Export and backup your data">
          <Pressable
            onPress={handleExport}
            disabled={exporting || !siteId}
            style={{
              backgroundColor: theme.tint,
              paddingVertical: 12,
              borderRadius: 999,
              alignItems: "center",
              opacity: exporting || !siteId ? 0.6 : 1,
            }}
          >
            <Text style={{ color: "#000", fontWeight: "900" }}>
              {exporting ? "Exporting…" : "Export Inventory to CSV"}
            </Text>
          </Pressable>
          
          <Text style={{ color: theme.mutedText, fontSize: 12, marginTop: 10 }}>
            Downloads a spreadsheet with all inventory items for your site.
          </Text>
        </Card>

        <Card title="App information" subtitle="Version and details">
          <InfoRow label="Version" value={`${appVersion} (${buildNumber})`} />
          <InfoRow label="Environment" value={__DEV__ ? "Development" : "Production"} />
          <InfoRow label="Platform" value={Constants.platform?.ios ? "iOS" : "Android"} />
          <InfoRow label="Site" value={siteId || "Not assigned"} />
          <InfoRow label="User ID" value={uid?.slice(0, 8) || "Not signed in"} />
        </Card>

        <Card title="Account" subtitle="Signed in">
          <Pressable
            onPress={handleLogout}
            style={{
              borderWidth: 1,
              borderColor: "#ef4444",
              paddingVertical: 12,
              borderRadius: 999,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#ef4444", fontWeight: "900" }}>Log out</Text>
          </Pressable>
        </Card>
      </ScrollView>

      {/* Toast notification */}
      <Toast toast={toast} fadeAnim={fadeAnim} onDismiss={hideToast} />
    </>
  );
}