// app/item/new.tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useMemo, useState } from "react";
import {
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { BRAND } from "../../constants/branding";
import { db } from "../../firebaseConfig";

export default function NewItemScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ barcode?: string }>();

  const initialBarcode = useMemo(() => String(params.barcode ?? "").trim(), [params.barcode]);

  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState(initialBarcode);
  const [currentQuantity, setCurrentQuantity] = useState("0");
  const [minQuantity, setMinQuantity] = useState("1");
  const [saving, setSaving] = useState(false);

  const canSave = useMemo(() => {
    const n = name.trim();
    const b = barcode.trim();
    if (!n || !b) return false;
    if (Number.isNaN(Number(currentQuantity))) return false;
    if (Number.isNaN(Number(minQuantity))) return false;
    return true;
  }, [name, barcode, currentQuantity, minQuantity]);

  const handleSave = async () => {
    const cleanName = name.trim();
    const cleanBarcode = barcode.trim();

    if (!cleanName) {
      Alert.alert("Name required", "Enter an item name.");
      return;
    }
    if (!cleanBarcode) {
      Alert.alert("Barcode required", "Scan again or type a barcode.");
      return;
    }

    setSaving(true);
    try {
      const docRef = await addDoc(collection(db, "items"), {
        name: cleanName,
        barcode: cleanBarcode,
        currentQuantity: Number(currentQuantity ?? 0),
        minQuantity: Number(minQuantity ?? 0),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      Alert.alert("Saved!", "Item added to inventory.");
      // go to the item page you already have
      router.replace(`/item/${docRef.id}`);
    } catch (e) {
      console.error("Create item failed:", e);
      Alert.alert("Save failed", "Could not create the item.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Text style={styles.title}>Add Item</Text>
      <Text style={styles.subtitle}>Create a new inventory item</Text>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={styles.card}>
          <Text style={styles.label}>Item name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Dell 24in Monitor"
            placeholderTextColor="#6b7280"
          />

          <Text style={styles.label}>Barcode</Text>
          <TextInput
            style={styles.input}
            value={barcode}
            onChangeText={setBarcode}
            placeholder="Scan or type barcode"
            placeholderTextColor="#6b7280"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Current quantity</Text>
          <TextInput
            style={styles.input}
            value={currentQuantity}
            onChangeText={setCurrentQuantity}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor="#6b7280"
          />

          <Text style={styles.label}>Minimum quantity</Text>
          <TextInput
            style={styles.input}
            value={minQuantity}
            onChangeText={setMinQuantity}
            keyboardType="numeric"
            placeholder="1"
            placeholderTextColor="#6b7280"
          />

          <Pressable
            style={[styles.button, (!canSave || saving) && styles.buttonDisabled]}
            onPress={handleSave}
            disabled={!canSave || saving}
          >
            <Text style={styles.buttonText}>{saving ? "Saving..." : "Save item"}</Text>
          </Pressable>

          <Pressable style={styles.link} onPress={() => router.back()}>
            <Text style={styles.linkText}>Cancel</Text>
          </Pressable>
        </View>
      </ScrollView>
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
  title: { color: BRAND.text, fontSize: 24, fontWeight: "800" },
  subtitle: { color: "#9ca3af", fontSize: 14, marginBottom: 12 },
  card: {
    backgroundColor: "#111827",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  label: { color: "#e5e7eb", fontSize: 13, marginBottom: 6, marginTop: 10 },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#374151",
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: "#f9fafb",
    fontSize: 14,
    backgroundColor: "#020617",
  },
  button: {
    backgroundColor: BRAND.primary,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
    marginTop: 14,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#000", fontWeight: "800" },
  link: { marginTop: 12, alignItems: "center" },
  linkText: { color: "#9ca3af", fontWeight: "700" },
});
