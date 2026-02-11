// components/DeviceRegistration.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { deleteDoc, doc, serverTimestamp, setDoc } from "firebase/firestore";
import React, { memo, useState } from "react";
import { Alert, Pressable, Text, TextInput } from "react-native";
import { db } from "../firebaseConfig";

const STORAGE_LABEL_KEY = "houseops_device_label_v1";
const STORAGE_PREFS_KEY = "houseops_alert_prefs_v1";

type Prefs = { low: boolean; out: boolean; restock: boolean };
const DEFAULT_PREFS: Prefs = { low: true, out: true, restock: true };

type Props = {
  theme: any;
  isDark: boolean;
  uid: string | null;
  siteId: string | null;
  token: string | null;
  storedLabel: string | null;
  prefs: Prefs;
  onLabelSaved: (label: string) => void;
  onTokenReset: () => void;
};

// ✅ Memoized component - won't re-render unless props actually change
export const DeviceRegistration = memo(function DeviceRegistration({
  theme,
  isDark,
  uid,
  siteId,
  token,
  storedLabel,
  prefs,
  onLabelSaved,
  onTokenReset,
}: Props) {
  const [label, setLabel] = useState(storedLabel || "");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const isRegistered = Boolean(storedLabel && token);

  const handleRegisterOrUpdate = async () => {
    const cleanLabel = label.trim();

    if (!cleanLabel) {
      Alert.alert("Name required", "Please enter a label for this device.");
      return;
    }
    if (!uid) {
      Alert.alert("Not signed in", "Please sign in again.");
      return;
    }
    if (!siteId) {
      Alert.alert("No site assigned", "This user does not have a siteId yet.");
      return;
    }
    if (!token) {
      Alert.alert("Token not ready", "Give it a second, then try again.");
      return;
    }

    setSaving(true);
    try {
      await setDoc(
        doc(db, "devicePushTokens", token),
        {
          token,
          uid,
          siteId,
          label: cleanLabel,
          enabled: true,
          prefs,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );

      await AsyncStorage.setItem(STORAGE_LABEL_KEY, cleanLabel);
      await AsyncStorage.setItem(STORAGE_PREFS_KEY, JSON.stringify(prefs));

      onLabelSaved(cleanLabel);
      Alert.alert("Saved!", "This device is registered for alerts.");
    } catch (e) {
      console.log("Register/update error:", e);
      Alert.alert("Save failed", "Could not save this device.");
    } finally {
      setSaving(false);
    }
  };

  const handleResetToken = async () => {
    Alert.alert(
      "Reset Device Token?",
      "This will unregister this device and clear push notifications. Use this when changing phones or debugging. The app will automatically get a new token on next launch.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            setResetting(true);
            try {
              if (token) {
                await deleteDoc(doc(db, "devicePushTokens", token));
              }

              await AsyncStorage.removeItem(STORAGE_LABEL_KEY);
              await AsyncStorage.removeItem(STORAGE_PREFS_KEY);

              setLabel("");
              onTokenReset();

              Alert.alert(
                "Reset complete",
                "Device token cleared. Restart the app to get a new token."
              );
            } catch (e) {
              console.log("Reset token error:", e);
              Alert.alert("Reset failed", "Could not reset device token.");
            } finally {
              setResetting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <>
      <Text style={{ color: theme.mutedText, fontSize: 12 }}>Device label</Text>

      <TextInput
        style={{
          marginTop: 8,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: theme.border,
          paddingHorizontal: 10,
          paddingVertical: 10,
          color: theme.text,
          fontSize: 14,
          backgroundColor: isDark ? "#0b1220" : "#ffffff",
        }}
        placeholder="e.g. Brittany, Front Desk"
        placeholderTextColor={
          isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)"
        }
        value={label}
        onChangeText={setLabel}
        autoCapitalize="words"
        returnKeyType="done"
        blurOnSubmit={false}
      />

      <Pressable
        style={{
          marginTop: 12,
          backgroundColor: theme.tint,
          paddingVertical: 10,
          borderRadius: 999,
          alignItems: "center",
          opacity: saving || !token || !siteId ? 0.6 : 1,
        }}
        onPress={handleRegisterOrUpdate}
        disabled={saving || !token || !siteId}
      >
        <Text style={{ color: isDark ? "#000" : "#fff", fontWeight: "900" }}>
          {!token ? "Getting push token…" : saving ? "Saving…" : "Save device"}
        </Text>
      </Pressable>

      {isRegistered && (
        <Pressable
          style={{
            marginTop: 10,
            borderWidth: 1,
            borderColor: "#f59e0b",
            paddingVertical: 10,
            borderRadius: 999,
            alignItems: "center",
            opacity: resetting ? 0.6 : 1,
          }}
          onPress={handleResetToken}
          disabled={resetting}
        >
          <Text style={{ color: "#f59e0b", fontWeight: "900" }}>
            {resetting ? "Resetting…" : "Reset Device Token"}
          </Text>
        </Pressable>
      )}

      <Text style={{ color: theme.mutedText, fontSize: 11, marginTop: 8 }}>
        Use "Reset Device Token" when changing phones or debugging push
        notifications.
      </Text>
    </>
  );
});