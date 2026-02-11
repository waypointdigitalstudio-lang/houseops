// app/add-item.tsx
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { BRAND } from "../constants/branding";
import { db } from "../firebaseConfig";
import { useUserProfile } from "../hooks/useUserProfile";

export default function AddItemScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ barcode?: string }>();

  const { profile, loading: profileLoading } = useUserProfile();
  const siteId = profile?.siteId ?? null;

  const barcode = useMemo(
    () => String(params.barcode ?? "").trim(),
    [params.barcode]
  );

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [minQuantity, setMinQuantity] = useState("1");
  const [currentQuantity, setCurrentQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const toNum = (v: string) => {
    const n = Number(String(v).replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  const canSave = useMemo(() => {
    return (
      Boolean(name.trim()) &&
      Boolean(barcode) &&
      Boolean(siteId) &&
      !saving &&
      !profileLoading
    );
  }, [name, barcode, siteId, saving, profileLoading]);

  const saveLabel = useMemo(() => {
    if (profileLoading) return "Loading site…";
    if (!siteId) return "No site assigned";
    if (saving) return "Saving…";
    return "Save item";
  }, [profileLoading, siteId, saving]);

  const handleSave = async () => {
    const cleanName = name.trim();
    const cleanLocation = location.trim();
    const cleanNotes = notes.trim();

    if (!siteId) {
      Alert.alert(
        "Site not set",
        "Your account doesn’t have a site assigned yet."
      );
      return;
    }

    if (!cleanName) {
      Alert.alert("Name required", "Enter an item name.");
      return;
    }

    if (!barcode) {
      Alert.alert("Barcode missing", "No barcode was provided.");
      return;
    }

    setSaving(true);
    try {
      const docRef = await addDoc(collection(db, "items"), {
        // ✅ IMPORTANT: this is what scopes inventory
        siteId,

        name: cleanName,
        barcode,
        location: cleanLocation,
        minQuantity: toNum(minQuantity),
        currentQuantity: toNum(currentQuantity),

        // optional input, but we store it anyway
        notes: cleanNotes,

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      Alert.alert("Added!", "Item created in inventory.");
      router.replace(`/item/${docRef.id}`);
    } catch (e) {
      console.error("Add item failed:", e);
      Alert.alert("Save failed", "Could not create the item. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: "Add item",
          headerStyle: { backgroundColor: BRAND.bg },
          headerTitleStyle: { color: BRAND.text, fontWeight: "700" },
          headerTintColor: BRAND.text,
        }}
      />

      <Text style={styles.title}>Add to inventory</Text>

      <Text style={styles.subtitle}>Site</Text>
      <Text style={styles.value}>
        {profileLoading ? "Loading…" : siteId ? siteId : "Unassigned"}
      </Text>

      <Text style={styles.subtitle}>Barcode</Text>
      <Text style={styles.value} selectable>
        {barcode || "No barcode"}
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>Item name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. HDMI Cable"
          placeholderTextColor="#6b7280"
          value={name}
          onChangeText={setName}
        />

        <Text style={styles.label}>Location (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Closet A · Rack 3"
          placeholderTextColor="#6b7280"
          value={location}
          onChangeText={setLocation}
        />

        <Text style={styles.label}>Current quantity</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={currentQuantity}
          onChangeText={setCurrentQuantity}
        />

        <Text style={styles.label}>Minimum quantity</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={minQuantity}
          onChangeText={setMinQuantity}
        />

        <Text style={styles.label}>Notes (optional)</Text>
        <TextInput
          style={[styles.input, styles.notesInput]}
          placeholder="Anything helpful…"
          placeholderTextColor="#6b7280"
          value={notes}
          onChangeText={setNotes}
          multiline
        />

        <Pressable
          style={[styles.button, !canSave && { opacity: 0.5 }]}
          disabled={!canSave}
          onPress={handleSave}
        >
          {saving ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.buttonText}>{saveLabel}</Text>
          )}
        </Pressable>

        <Text style={styles.helper}>
          After saving, you’ll land on the item detail page.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BRAND.bg,
    paddingTop: 16,
    paddingHorizontal: 16,
  },
  title: {
    color: BRAND.text,
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 8,
  },
  subtitle: {
    color: "#9ca3af",
    fontSize: 12,
  },
  value: {
    color: "#e5e7eb",
    fontSize: 12,
    marginBottom: 12,
  },
  card: {
    backgroundColor: "#111827",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  label: {
    color: "#e5e7eb",
    fontSize: 13,
    marginBottom: 4,
    marginTop: 10,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#374151",
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: "#f9fafb",
    fontSize: 14,
    backgroundColor: "#020617",
  },
  notesInput: {
    height: 90,
    textAlignVertical: "top",
  },
  button: {
    marginTop: 16,
    backgroundColor: BRAND.primary,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: "center",
  },
  buttonText: {
    color: "#000",
    fontWeight: "800",
  },
  helper: {
    color: "#9ca3af",
    fontSize: 12,
    marginTop: 10,
  },
});
