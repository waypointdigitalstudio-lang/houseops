// app/toners/[id].tsx
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

const TONER_COLORS = ["Black", "Cyan", "Magenta", "Yellow", "Other"];

interface Toner {
  id: string;
  model: string;
  color: string;
  quantity: number;
  minQuantity: number;
  printer?: string;
  barcode?: string;
  notes?: string;
  siteId: string;
}

export default function TonerDetail() {
  const theme = useAppTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { toast, fadeAnim, showToast, hideToast } = useToast();

  const [toner, setToner] = useState<Toner | null>(null);
  const [loading, setLoading] = useState(true);

  const [editColor, setEditColor] = useState("Black");
  const [editPrinter, setEditPrinter] = useState("");
  const [editBarcode, setEditBarcode] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editMinQty, setEditMinQty] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);
  const [savingMovement, setSavingMovement] = useState(false);
  const [customAmount, setCustomAmount] = useState("");
  const [pendingDelta, setPendingDelta] = useState<number | null>(null);
  const [movementBy, setMovementBy] = useState("");
  const [movementNote, setMovementNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const ref = doc(db, "toners", String(id));
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const d = snap.data() as any;
          const loaded: Toner = {
            id: snap.id,
            model: d.model || "Unknown",
            color: d.color || "Black",
            quantity: d.quantity ?? 0,
            minQuantity: d.minQuantity ?? 0,
            printer: d.printer || "",
            barcode: d.barcode || "",
            notes: d.notes || "",
            siteId: d.siteId || "",
          };
          setToner(loaded);
          setEditColor(loaded.color);
          setEditPrinter(loaded.printer || "");
          setEditBarcode(loaded.barcode || "");
          setEditNotes(loaded.notes || "");
          setEditMinQty(String(loaded.minQuantity));
        } else {
          setToner(null);
        }
        setLoading(false);
      },
      (err) => {
        if (__DEV__) console.error("Error loading toner:", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [id]);

  const openMovementDialog = (delta: number) => {
    setPendingDelta(delta);
    setMovementBy("");
    setMovementNote("");
    setError(null);
  };

  const closeMovementDialog = () => {
    if (savingMovement) return;
    setPendingDelta(null);
    setMovementBy("");
    setMovementNote("");
    setError(null);
  };

  const applyQuantityChange = async () => {
    if (!toner || pendingDelta === null) return;
    const by = movementBy.trim();
    if (!by) {
      setError("Please enter who is taking / adding the item.");
      return;
    }
    const note = movementNote.trim();
    const delta = pendingDelta;
    const newQty = Math.max(0, toner.quantity + delta);
    const prevStatus = toner.quantity <= 0 ? "OUT" : toner.quantity <= toner.minQuantity ? "LOW" : "OK";
    const nextStatus = newQty <= 0 ? "OUT" : newQty <= toner.minQuantity ? "LOW" : "OK";
    setSavingMovement(true);
    setError(null);
    try {
      await updateDoc(doc(db, "toners", toner.id), {
        quantity: newQty,
        updatedAt: serverTimestamp(),
      });
      await addDoc(collection(db, "alertsLog"), {
        siteId: toner.siteId,
        itemName: toner.model,
        itemId: toner.id,
        qty: newQty,
        min: toner.minQuantity,
        prevState: prevStatus,
        nextState: nextStatus,
        status: nextStatus,
        action: delta < 0 ? "deducted" : "added",
        itemType: "toner",
        by,
        note: note || null,
        source: "movement",
        createdAt: serverTimestamp(),
      });
      showToast(delta < 0 ? `✓ Removed ${Math.abs(delta)}` : `✓ Added ${delta}`, "success");
      setPendingDelta(null);
      setMovementBy("");
      setMovementNote("");
    } catch {
      showToast("Failed to update quantity", "error");
    } finally {
      setSavingMovement(false);
    }
  };

  const handleSave = async () => {
    if (!toner) return;
    setSavingMeta(true);
    try {
      await updateDoc(doc(db, "toners", toner.id), {
        color: editColor,
        printer: editPrinter.trim(),
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
    if (!toner) return;
    Alert.alert("Delete Toner", `Remove ${toner.model}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteDoc(doc(db, "toners", toner.id));
            showToast("✓ Toner deleted", "success");
            setTimeout(() => router.replace("/(tabs)"), 1000);
          } catch {
            showToast("Failed to delete toner", "error");
          }
        },
      },
    ]);
  };

  const isLow = toner && toner.quantity <= toner.minQuantity;

  return (
    <>
      <Stack.Screen
        options={{
          title: toner?.model ?? "Toner",
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
        ) : !toner ? (
          <View style={styles.center}>
            <Text style={{ color: "#f87171", fontWeight: "800" }}>Toner not found.</Text>
          </View>
        ) : (
          <>
            {/* Header card */}
            <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Text style={[styles.name, { color: theme.text }]}>{toner.model}</Text>
              <Text style={[styles.idText, { color: theme.mutedText }]}>ID: {toner.id}</Text>
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
                <Text style={[styles.valueBig, { color: theme.text }]}>{toner.quantity}</Text>
              </View>
              <View style={styles.row}>
                <Text style={[styles.label, { color: theme.mutedText }]}>Minimum quantity</Text>
                <Text style={[styles.value, { color: theme.text }]}>{toner.minQuantity}</Text>
              </View>
              <View style={styles.buttonRow}>
                {[-1, -5, -10, -25].map((n) => (
                  <Pressable
                    key={n}
                    style={[styles.stockButton, styles.stockButtonMinus, savingMovement && { opacity: 0.5 }]}
                    onPress={() => openMovementDialog(n)}
                    disabled={savingMovement}
                  >
                    <Text style={[styles.stockButtonText, { color: theme.text }]}>{n}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={[styles.buttonRow, { marginTop: 8 }]}>
                {[1, 5, 10, 25].map((n) => (
                  <Pressable
                    key={n}
                    style={[styles.stockButton, styles.stockButtonPlus, savingMovement && { opacity: 0.5 }]}
                    onPress={() => openMovementDialog(n)}
                    disabled={savingMovement}
                  >
                    <Text style={[styles.stockButtonText, { color: theme.text }]}>+{n}</Text>
                  </Pressable>
                ))}
              </View>

              {/* Custom amount row */}
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10, gap: 8 }}>
                <TextInput
                  style={{
                    flex: 1,
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    color: theme.text,
                    backgroundColor: theme.background,
                    fontSize: 15,
                    textAlign: "center",
                  }}
                  placeholder="Custom amount"
                  placeholderTextColor={theme.mutedText}
                  keyboardType="number-pad"
                  value={customAmount}
                  onChangeText={(v) => setCustomAmount(v.replace(/[^0-9]/g, ""))}
                  editable={!savingMovement}
                />
                <Pressable
                  style={[styles.stockButton, styles.stockButtonMinus, { flex: 0, paddingHorizontal: 16 }, savingMovement && { opacity: 0.5 }]}
                  onPress={() => {
                    const n = parseInt(customAmount);
                    if (n > 0) { openMovementDialog(-n); setCustomAmount(""); }
                  }}
                  disabled={savingMovement}
                >
                  <Text style={[styles.stockButtonText, { color: theme.text }]}>Take</Text>
                </Pressable>
                <Pressable
                  style={[styles.stockButton, styles.stockButtonPlus, { flex: 0, paddingHorizontal: 16 }, savingMovement && { opacity: 0.5 }]}
                  onPress={() => {
                    const n = parseInt(customAmount);
                    if (n > 0) { openMovementDialog(n); setCustomAmount(""); }
                  }}
                  disabled={savingMovement}
                >
                  <Text style={[styles.stockButtonText, { color: theme.text }]}>Add</Text>
                </Pressable>
              </View>
            </View>

            {/* Details card */}
            <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Details</Text>

              <Text style={[styles.fieldLabel, { color: theme.text }]}>Color</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
                {TONER_COLORS.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => setEditColor(c)}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: editColor === c ? theme.text : theme.border,
                      backgroundColor: editColor === c ? theme.text : "transparent",
                    }}
                  >
                    <Text style={{ color: editColor === c ? theme.background : theme.mutedText, fontWeight: "700", fontSize: 12 }}>
                      {c}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[styles.fieldLabel, { color: theme.text }]}>Compatible Printer</Text>
              <TextInput
                style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
                placeholder="e.g. HP LaserJet M404"
                placeholderTextColor={theme.mutedText}
                value={editPrinter}
                onChangeText={setEditPrinter}
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
                <Text style={styles.deleteButtonText}>Delete toner</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>

      {/* Movement dialog overlay */}
      {toner && pendingDelta !== null && (
        <View style={styles.overlayBackdrop}>
          <View style={[styles.overlayCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.overlayTitle, { color: theme.text }]}>
              {pendingDelta < 0 ? "Remove from stock" : "Add to stock"}
            </Text>
            <Text style={[styles.overlaySub, { color: theme.mutedText }]}>
              Current: {toner.quantity} • Change: {pendingDelta > 0 ? `+${pendingDelta}` : pendingDelta}
            </Text>

            <Text style={[styles.fieldLabel, { color: theme.text }]}>Who is taking / adding it?</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
              placeholder="Name or initials"
              placeholderTextColor={theme.mutedText}
              value={movementBy}
              onChangeText={setMovementBy}
            />

            <Text style={[styles.fieldLabel, { color: theme.text }]}>Note (optional)</Text>
            <TextInput
              style={[styles.input, { height: 70, textAlignVertical: "top", borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
              placeholder="e.g. Printer 3, Finance office, etc."
              placeholderTextColor={theme.mutedText}
              value={movementNote}
              onChangeText={setMovementNote}
              multiline
            />

            {error && (
              <Text style={{ color: "#f87171", marginTop: 6, fontSize: 13 }}>{error}</Text>
            )}

            <View style={styles.overlayButtonsRow}>
              <Pressable
                onPress={closeMovementDialog}
                style={[styles.overlayButton, styles.overlayCancel, { borderColor: theme.border }]}
                disabled={savingMovement}
              >
                <Text style={[styles.overlayCancelText, { color: theme.text }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={applyQuantityChange}
                style={[styles.overlayButton, styles.overlayConfirm, savingMovement && { opacity: 0.7 }]}
                disabled={savingMovement}
              >
                {savingMovement ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={styles.overlayConfirmText}>Confirm</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      )}

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
  overlayBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center" },
  overlayCard: { width: "90%", borderRadius: 16, padding: 16, borderWidth: 1 },
  overlayTitle: { fontSize: 18, fontWeight: "800", marginBottom: 4 },
  overlaySub: { fontSize: 13, marginBottom: 10 },
  overlayButtonsRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 14 },
  overlayButton: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, marginLeft: 8 },
  overlayCancel: { backgroundColor: "transparent", borderWidth: 1 },
  overlayCancelText: { fontWeight: "700" },
  overlayConfirm: { backgroundColor: "#22c55e" },
  overlayConfirmText: { color: "#000", fontWeight: "900" },
});
