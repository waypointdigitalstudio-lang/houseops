// app/radiopart/[id].tsx
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Toast } from "../../components/Toast";
import { useAppTheme } from "../../constants/theme";
import { db } from "../../firebaseConfig";
import { useToast } from "../../hooks/useToast";

interface RadioPart {
  id: string;
  name: string;
  compatibleModel?: string;
  quantity: number;
  minQuantity: number;
  location?: string;
  barcode?: string;
  notes?: string;
  siteId: string;
}

export default function RadioPartDetail() {
  const theme = useAppTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { toast, fadeAnim, showToast, hideToast } = useToast();

  const [part, setPart] = useState<RadioPart | null>(null);
  const [loading, setLoading] = useState(true);

  const [editCompatible, setEditCompatible] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editBarcode, setEditBarcode] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editMinQty, setEditMinQty] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);
  const [adjusting, setAdjusting] = useState(false);

  useEffect(() => {
    if (!id) return;
    const ref = doc(db, "radioParts", String(id));
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const d = snap.data() as any;
          const loaded: RadioPart = {
            id: snap.id,
            name: d.name || "Unknown",
            compatibleModel: d.compatibleModel || "",
            quantity: d.quantity ?? 0,
            minQuantity: d.minQuantity ?? 0,
            location: d.location || "",
            barcode: d.barcode || "",
            notes: d.notes || "",
            siteId: d.siteId || "",
          };
          setPart(loaded);
          setEditCompatible(loaded.compatibleModel || "");
          setEditLocation(loaded.location || "");
          setEditBarcode(loaded.barcode || "");
          setEditNotes(loaded.notes || "");
          setEditMinQty(String(loaded.minQuantity));
        } else {
          setPart(null);
        }
        setLoading(false);
      },
      (err) => {
        if (__DEV__) console.error("Error loading radio part:", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [id]);

  const handleAdjust = async (delta: number) => {
    if (!part || adjusting) return;
    const newQty = Math.max(0, part.quantity + delta);
    setAdjusting(true);
    try {
      await updateDoc(doc(db, "radioParts", part.id), {
        quantity: newQty,
        updatedAt: serverTimestamp(),
      });
      const prevStatus = part.quantity <= 0 ? "OUT" : part.quantity <= part.minQuantity ? "LOW" : "OK";
      const nextStatus = newQty <= 0 ? "OUT" : newQty <= part.minQuantity ? "LOW" : "OK";
      await addDoc(collection(db, "alertsLog"), {
        siteId: part.siteId,
        itemName: part.name,
        itemId: part.id,
        qty: newQty,
        min: part.minQuantity,
        prevState: prevStatus,
        nextState: nextStatus,
        status: nextStatus,
        action: delta < 0 ? "deducted" : "added",
        itemType: "radioPart",
        createdAt: serverTimestamp(),
      });
      showToast(delta < 0 ? `✓ Removed ${Math.abs(delta)}` : `✓ Added ${delta}`, "success");
    } catch {
      showToast("Failed to update quantity", "error");
    } finally {
      setAdjusting(false);
    }
  };

  const handleSave = async () => {
    if (!part) return;
    setSavingMeta(true);
    try {
      await updateDoc(doc(db, "radioParts", part.id), {
        compatibleModel: editCompatible.trim(),
        location: editLocation.trim(),
        barcode: editBarcode.trim(),
        notes: editNotes.trim(),
        minQuantity: parseInt(editMinQty) || 0,
        updatedAt: serverTimestamp(),
      });
      showToast("✓ Changes saved", "success");
    } catch {
      showToast("Failed to save changes", "error");
    } finally {
      setSavingMeta(false);
    }
  };

  const handleDelete = () => {
    if (!part) return;
    Alert.alert("Delete Part", `Remove ${part.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteDoc(doc(db, "radioParts", part.id));
            showToast("✓ Part deleted", "success");
            setTimeout(() => router.replace("/(tabs)"), 1000);
          } catch {
            showToast("Failed to delete part", "error");
          }
        },
      },
    ]);
  };

  const isLow = part && part.quantity <= part.minQuantity;

  return (
    <>
      <Stack.Screen
        options={{
          title: part?.name ?? "Radio Part",
          headerStyle: { backgroundColor: theme.background },
          headerTitleStyle: { color: theme.text, fontWeight: "700", fontSize: 18 },
          headerTintColor: theme.text,
        }}
      />

      <ScrollView contentContainerStyle={[styles.container, { backgroundColor: theme.background }]}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : !part ? (
          <View style={styles.center}>
            <Text style={{ color: "#f87171", fontWeight: "800" }}>Part not found.</Text>
          </View>
        ) : (
          <>
            {/* Header card */}
            <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Text style={[styles.name, { color: theme.text }]}>{part.name}</Text>
              <Text style={[styles.idText, { color: theme.mutedText }]}>ID: {part.id}</Text>
              {isLow ? (
                <View style={styles.bannerLow}>
                  <Text style={styles.bannerLowText}>Stock at or below minimum. Needs attention.</Text>
                </View>
              ) : (
                <View style={styles.bannerOk}>
                  <Text style={styles.bannerOkText}>Stock is within range.</Text>
                </View>
              )}
            </View>

            {/* Stock card */}
            <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Stock</Text>
              <View style={styles.row}>
                <Text style={[styles.label, { color: theme.mutedText }]}>Current quantity</Text>
                <Text style={[styles.valueBig, { color: theme.text }]}>{part.quantity}</Text>
              </View>
              <View style={styles.row}>
                <Text style={[styles.label, { color: theme.mutedText }]}>Minimum quantity</Text>
                <Text style={[styles.value, { color: theme.text }]}>{part.minQuantity}</Text>
              </View>
              <View style={styles.buttonRow}>
                {[-1, -5, -10, -25].map((n) => (
                  <Pressable
                    key={n}
                    style={[styles.stockButton, styles.stockButtonMinus, adjusting && { opacity: 0.5 }]}
                    onPress={() => handleAdjust(n)}
                    disabled={adjusting}
                  >
                    <Text style={[styles.stockButtonText, { color: theme.text }]}>{n}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={[styles.buttonRow, { marginTop: 8 }]}>
                {[1, 5, 10, 25].map((n) => (
                  <Pressable
                    key={n}
                    style={[styles.stockButton, styles.stockButtonPlus, adjusting && { opacity: 0.5 }]}
                    onPress={() => handleAdjust(n)}
                    disabled={adjusting}
                  >
                    <Text style={[styles.stockButtonText, { color: theme.text }]}>+{n}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Details card */}
            <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Details</Text>

              <Text style={[styles.fieldLabel, { color: theme.text }]}>Compatible Model</Text>
              <TextInput
                style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
                placeholder="e.g. Motorola RDU2020"
                placeholderTextColor={theme.mutedText}
                value={editCompatible}
                onChangeText={setEditCompatible}
              />

              <Text style={[styles.fieldLabel, { color: theme.text }]}>Location</Text>
              <TextInput
                style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
                placeholder="e.g. Storage Room B"
                placeholderTextColor={theme.mutedText}
                value={editLocation}
                onChangeText={setEditLocation}
              />

              <Text style={[styles.fieldLabel, { color: theme.text }]}>Barcode / SKU</Text>
              <TextInput
                style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
                placeholder="e.g. 123456789012"
                placeholderTextColor={theme.mutedText}
                value={editBarcode}
                onChangeText={setEditBarcode}
              />

              <Text style={[styles.fieldLabel, { color: theme.text }]}>Min Quantity</Text>
              <TextInput
                style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={theme.mutedText}
                value={editMinQty}
                onChangeText={setEditMinQty}
              />

              <Text style={[styles.fieldLabel, { color: theme.text }]}>Notes</Text>
              <TextInput
                style={[styles.input, { height: 90, textAlignVertical: "top", borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
                placeholder="Additional notes..."
                placeholderTextColor={theme.mutedText}
                value={editNotes}
                onChangeText={setEditNotes}
                multiline
              />

              <Pressable
                style={[styles.saveButton, { backgroundColor: theme.primary }, savingMeta && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={savingMeta}
              >
                {savingMeta ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <ActivityIndicator size="small" color="#000" />
                    <Text style={styles.saveButtonText}>Saving…</Text>
                  </View>
                ) : (
                  <Text style={styles.saveButtonText}>Save changes</Text>
                )}
              </Pressable>

              <Pressable style={[styles.deleteButton, { borderColor: "#ef4444" }]} onPress={handleDelete}>
                <Text style={styles.deleteButtonText}>Delete part</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>

      <Toast toast={toast} fadeAnim={fadeAnim} onDismiss={hideToast} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, flexGrow: 1 },
  center: { marginTop: 40, alignItems: "center" },
  card: { borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1 },
  name: { fontSize: 20, fontWeight: "900", marginBottom: 4 },
  idText: { fontSize: 11, marginBottom: 8 },
  bannerLow: { backgroundColor: "rgba(239, 68, 68, 0.18)", borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10, alignSelf: "flex-start" },
  bannerLowText: { color: "#fecaca", fontSize: 12, fontWeight: "700" },
  bannerOk: { backgroundColor: "rgba(16, 185, 129, 0.18)", borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10, alignSelf: "flex-start" },
  bannerOkText: { color: "#bbf7d0", fontSize: 12, fontWeight: "700" },
  sectionTitle: { fontSize: 16, fontWeight: "800", marginBottom: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  label: { fontSize: 14 },
  value: { fontSize: 15, fontWeight: "700" },
  valueBig: { fontSize: 20, fontWeight: "900" },
  buttonRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 12 },
  stockButton: { flex: 1, marginHorizontal: 4, paddingVertical: 8, borderRadius: 999, alignItems: "center", borderWidth: 1 },
  stockButtonMinus: { borderColor: "#f97373", backgroundColor: "rgba(239, 68, 68, 0.12)" },
  stockButtonPlus: { borderColor: "#34d399", backgroundColor: "rgba(16, 185, 129, 0.12)" },
  stockButtonText: { fontWeight: "800", fontSize: 14 },
  fieldLabel: { fontSize: 13, marginTop: 10, marginBottom: 4, fontWeight: "700" },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  saveButton: { marginTop: 14, paddingVertical: 10, borderRadius: 999, alignItems: "center" },
  saveButtonText: { color: "#fff", fontWeight: "900" },
  deleteButton: { marginTop: 10, paddingVertical: 10, borderRadius: 999, alignItems: "center", borderWidth: 1, backgroundColor: "transparent" },
  deleteButtonText: { color: "#ef4444", fontWeight: "900" },
});
