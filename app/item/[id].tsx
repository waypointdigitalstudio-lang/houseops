// app/item/[id].tsx
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
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
import { auth, db } from "../../firebaseConfig";
import { useToast } from "../../hooks/useToast";
import { useUserProfile } from "../../hooks/useUserProfile";

interface Item {
  id: string;
  name: string;
  currentQuantity: number;
  minQuantity: number;
  location?: string;
  barcode?: string;
  siteId?: string;
  isLowStock?: boolean;
  lowStockAt?: any;
}

interface Movement {
  id: string;
  type: "in" | "out" | string;
  delta: number;
  previousQuantity: number;
  newQuantity: number;
  by: string;
  note?: string | null;
  createdAt?: any;
  isLowStock?: boolean;
}

export default function ItemDetail() {
  const theme = useAppTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { profile } = useUserProfile();
  const mySiteId = profile?.siteId ?? "ballys_tiverton";

  const SITES = ["ballys_tiverton", "ballys_lincoln"];

  // Toast hook
  const { toast, fadeAnim, showToast, hideToast } = useToast();

  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);

  const [editLocation, setEditLocation] = useState("");
  const [editBarcode, setEditBarcode] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);

  const [editSiteId, setEditSiteId] = useState<string>(mySiteId);
  const [deletingItem, setDeletingItem] = useState(false);

  const [pendingDelta, setPendingDelta] = useState<number | null>(null);
  const [movementBy, setMovementBy] = useState("");
  const [movementNote, setMovementNote] = useState("");
  const [savingMovement, setSavingMovement] = useState(false);

  // disposal dialog state
  const [showDisposalDialog, setShowDisposalDialog] = useState(false);
  const [disposalReason, setDisposalReason] = useState<"broken" | "obsolete" | "lost" | "damaged" | "other">("broken");
  const [disposalNotes, setDisposalNotes] = useState("");
  const [disposalQuantity, setDisposalQuantity] = useState("1");
  const [disposingItem, setDisposingItem] = useState(false);

  const [movements, setMovements] = useState<Movement[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    const ref = doc(db, "items", String(id));

    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const d = snap.data() as any;
          const loaded: Item = {
            id: snap.id,
            name: d.name || "Unnamed item",
            currentQuantity: d.currentQuantity ?? 0,
            minQuantity: d.minQuantity ?? 0,
            location: d.location || "",
            barcode: d.barcode || "",
            siteId: d.siteId || mySiteId,
            isLowStock: d.isLowStock ?? undefined,
            lowStockAt: d.lowStockAt ?? null,
          };

          setItem(loaded);
          setEditLocation(loaded.location || "");
          setEditBarcode(loaded.barcode || "");
          setEditSiteId(loaded.siteId || mySiteId);
        } else {
          setItem(null);
        }
        setLoading(false);
      },
      (err) => {
        console.error("Error loading item detail:", err);
        setError("Failed to load item.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [id, mySiteId]);

  useEffect(() => {
    if (!id) return;

    const movementsRef = collection(db, "items", String(id), "movements");
    const q = query(movementsRef, orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Movement[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data() as any;
          list.push({
            id: docSnap.id,
            type: d.type || "out",
            delta: d.delta ?? 0,
            previousQuantity: d.previousQuantity ?? 0,
            newQuantity: d.newQuantity ?? 0,
            by: d.by || "Unknown",
            note: d.note ?? null,
            createdAt: d.createdAt ?? null,
            isLowStock: d.isLowStock ?? undefined,
          });
        });
        setMovements(list);
        setLoadingMovements(false);
      },
      (err) => {
        console.error("Error loading movements:", err);
        setLoadingMovements(false);
      }
    );

    return () => unsub();
  }, [id]);

  const handleSaveMeta = async () => {
    if (!item) return;
    setSavingMeta(true);
    setError(null);

    try {
      const ref = doc(db, "items", item.id);
      await updateDoc(ref, {
        location: editLocation.trim(),
        barcode: editBarcode.trim(),
        updatedAt: serverTimestamp(),
      });

      showToast("✓ Changes saved", "success");
      
      setTimeout(() => {
        setSavingMeta(false);
      }, 400);
    } catch (err) {
      console.error("Error saving item metadata:", err);
      showToast("Failed to save changes", "error");
      setSavingMeta(false);
    }
  };

  const handleMoveSite = () => {
    if (!item) return;

    const current = item.siteId || mySiteId;

    Alert.alert(
      "Move item to another site?",
      `Current site: ${current}\n\nChoose destination:`,
      [
        { text: "Cancel", style: "cancel" },

        ...SITES.map((s) => ({
          text: s,
          onPress: async () => {
            try {
              const ref = doc(db, "items", item.id);
              await updateDoc(ref, {
                siteId: s,
                updatedAt: serverTimestamp(),
              });

              setEditSiteId(s);
              showToast(`✓ Moved to ${s}`, "success");
              
              setTimeout(() => {
                router.replace("/(tabs)");
              }, 1500);
            } catch (e) {
              console.log("Move site failed:", e);
              showToast("Failed to move item", "error");
            }
          },
        })),
      ]
    );
  };

  const handleDeleteItem = () => {
    if (!item || deletingItem) return;

    Alert.alert(
      "Delete this item?",
      "This will remove the item from inventory. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              setDeletingItem(true);
              setError(null);
              await deleteDoc(doc(db, "items", item.id));
              
              showToast("✓ Item deleted", "success");
              
              setTimeout(() => {
                router.replace("/(tabs)");
              }, 1000);
            } catch (err) {
              console.error("Delete item failed:", err);
              showToast("Failed to delete item", "error");
              setDeletingItem(false);
            }
          },
        },
      ]
    );
  };

  const handleDisposeItem = () => {
    if (!item) return;
    setShowDisposalDialog(true);
    setDisposalReason("broken");
    setDisposalNotes("");
    setDisposalQuantity("1");
  };

  const confirmDisposal = async () => {
    if (!item) return;

    const qty = parseInt(disposalQuantity) || 1;
    if (qty <= 0 || qty > item.currentQuantity) {
      setError(`Quantity must be between 1 and ${item.currentQuantity}`);
      return;
    }

    setDisposingItem(true);
    setError(null);

    try {
      const user = auth.currentUser;
      if (!user) {
        setError("You must be logged in to dispose items");
        return;
      }

      const userName = user.displayName || user.email || "Unknown";

      await addDoc(collection(db, "disposals"), {
        itemId: item.id,
        itemName: item.name,
        siteId: item.siteId || mySiteId,
        reason: disposalReason,
        notes: disposalNotes.trim() || null,
        disposedBy: userName,
        disposedByUid: user.uid,
        disposedAt: serverTimestamp(),
        quantity: qty,
      });

      const newQuantity = item.currentQuantity - qty;
      await updateDoc(doc(db, "items", item.id), {
        currentQuantity: newQuantity,
        updatedAt: serverTimestamp(),
      });

      const movementsRef = collection(db, "items", item.id, "movements");
      await addDoc(movementsRef, {
        type: "disposal",
        delta: -qty,
        previousQuantity: item.currentQuantity,
        newQuantity: newQuantity,
        by: userName,
        note: `Disposed: ${disposalReason}${disposalNotes ? ` - ${disposalNotes}` : ""}`,
        siteId: item.siteId || mySiteId,
        createdAt: serverTimestamp(),
      });

      setShowDisposalDialog(false);
      showToast(`✓ ${qty} item(s) disposed`, "success");
    } catch (err) {
      console.error("Disposal failed:", err);
      showToast("Failed to dispose item", "error");
    } finally {
      setDisposingItem(false);
    }
  };

  const openMovementDialog = (delta: number) => {
    setPendingDelta(delta);
    setMovementBy("");
    setMovementNote("");
    setError(null);
  };

  const applyQuantityChange = async () => {
    if (!item || pendingDelta === null) return;

    const by = movementBy.trim();
    if (!by) {
      setError("Please enter who is taking / adding the item.");
      return;
    }

    const note = movementNote.trim();
    const delta = pendingDelta;

    const previousQuantity = item.currentQuantity;
    const newQuantity = Math.max(0, previousQuantity + delta);
    const isLowStock = newQuantity <= item.minQuantity;

    setSavingMovement(true);
    setError(null);

    try {
      const itemRef = doc(db, "items", item.id);
      const movementsRef = collection(db, "items", item.id, "movements");

      await updateDoc(itemRef, {
        currentQuantity: newQuantity,
        isLowStock,
        lowStockAt: isLowStock ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      });

      await addDoc(movementsRef, {
        type: delta < 0 ? "out" : "in",
        delta,
        previousQuantity,
        newQuantity,
        by,
        note: note || null,
        isLowStock,
        siteId: item.siteId || mySiteId,
        createdAt: serverTimestamp(),
      });

      showToast(
        delta < 0 
          ? `✓ Removed ${Math.abs(delta)} from stock` 
          : `✓ Added ${delta} to stock`,
        "success"
      );

      setPendingDelta(null);
      setMovementBy("");
      setMovementNote("");
    } catch (err) {
      console.error("Error applying quantity change:", err);
      showToast("Failed to update stock", "error");
    } finally {
      setSavingMovement(false);
    }
  };

  const closeMovementDialog = () => {
    if (savingMovement) return;
    setPendingDelta(null);
    setMovementBy("");
    setMovementNote("");
    setError(null);
  };

  const isLow = item && item.currentQuantity <= item.minQuantity;

  const formatMovementTime = (m: Movement) => {
    const ts = m.createdAt;
    if (!ts || !ts.toDate) return "";
    const d = ts.toDate() as Date;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: item?.name ? item.name : "Item details",
          headerStyle: { backgroundColor: theme.background },
          headerTitleStyle: {
            color: theme.text,
            fontWeight: "700",
            fontSize: 18,
          },
          headerTintColor: theme.text,
        }}
      />

      <ScrollView
        contentContainerStyle={[
          styles.container,
          { backgroundColor: theme.background },
        ]}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={[styles.loadingText, { color: theme.mutedText }]}>
              Loading item…
            </Text>
          </View>
        ) : !item ? (
          <View style={styles.center}>
            <Text style={[styles.errorText, { color: "#f87171" }]}>
              Item not found.
            </Text>
            <Text style={[styles.subText, { color: theme.mutedText }]}>
              It may have been deleted or the link is invalid.
            </Text>
          </View>
        ) : (
          <>
            <View
              style={[
                styles.card,
                { backgroundColor: theme.card, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.name, { color: theme.text }]}>
                {item.name}
              </Text>
              <Text style={[styles.idText, { color: theme.mutedText }]}>
                ID: {item.id}
              </Text>

              {isLow ? (
                <View style={styles.bannerLow}>
                  <Text style={styles.bannerLowText}>
                    Stock at or below minimum. Needs attention.
                  </Text>
                </View>
              ) : (
                <View style={styles.bannerOk}>
                  <Text style={styles.bannerOkText}>Stock is within range.</Text>
                </View>
              )}
            </View>

            <View
              style={[
                styles.card,
                { backgroundColor: theme.card, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: theme.text }]}>
                Stock
              </Text>

              <View style={styles.row}>
                <Text style={[styles.label, { color: theme.mutedText }]}>
                  Current quantity
                </Text>
                <Text style={[styles.valueBig, { color: theme.text }]}>
                  {item.currentQuantity}
                </Text>
              </View>

              <View style={styles.row}>
                <Text style={[styles.label, { color: theme.mutedText }]}>
                  Minimum quantity
                </Text>
                <Text style={[styles.value, { color: theme.text }]}>
                  {item.minQuantity}
                </Text>
              </View>

              <View style={styles.buttonRow}>
                <Pressable
                  style={[styles.stockButton, styles.stockButtonMinus]}
                  onPress={() => openMovementDialog(-1)}
                >
                  <Text style={[styles.stockButtonText, { color: theme.text }]}>
                    −1
                  </Text>
                </Pressable>

                <Pressable
                  style={[styles.stockButton, styles.stockButtonMinus]}
                  onPress={() => openMovementDialog(-5)}
                >
                  <Text style={[styles.stockButtonText, { color: theme.text }]}>
                    −5
                  </Text>
                </Pressable>

                <Pressable
                  style={[styles.stockButton, styles.stockButtonPlus]}
                  onPress={() => openMovementDialog(1)}
                >
                  <Text style={[styles.stockButtonText, { color: theme.text }]}>
                    +1
                  </Text>
                </Pressable>

                <Pressable
                  style={[styles.stockButton, styles.stockButtonPlus]}
                  onPress={() => openMovementDialog(5)}
                >
                  <Text style={[styles.stockButtonText, { color: theme.text }]}>
                    +5
                  </Text>
                </Pressable>
              </View>
            </View>

            <View
              style={[
                styles.card,
                { backgroundColor: theme.card, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: theme.text }]}>
                Details
              </Text>

              <Text style={[styles.fieldLabel, { color: theme.text }]}>Site</Text>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 10,
                  backgroundColor: theme.background,
                }}
              >
                <Text style={{ color: theme.text, fontWeight: "800" }}>
                  {editSiteId || "Unknown"}
                </Text>

                <Pressable
                  onPress={handleMoveSite}
                  style={({ pressed }) => [
                    {
                      paddingVertical: 6,
                      paddingHorizontal: 12,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: theme.tint,
                    },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text style={{ color: theme.tint, fontWeight: "900" }}>
                    Move
                  </Text>
                </Pressable>
              </View>

              <Text style={{ color: theme.mutedText, fontSize: 12, marginTop: 6 }}>
                Moving will remove it from this site's inventory list.
              </Text>

              <Text style={[styles.fieldLabel, { color: theme.text }]}>
                Location
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    borderColor: theme.border,
                    color: theme.text,
                    backgroundColor: theme.background,
                  },
                ]}
                placeholder="e.g. Closet A · Rack 3"
                placeholderTextColor={theme.mutedText}
                value={editLocation}
                onChangeText={setEditLocation}
              />

              <Text style={[styles.fieldLabel, { color: theme.text }]}>
                Barcode
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    borderColor: theme.border,
                    color: theme.text,
                    backgroundColor: theme.background,
                  },
                ]}
                placeholder="Scanned barcode value"
                placeholderTextColor={theme.mutedText}
                value={editBarcode}
                onChangeText={setEditBarcode}
              />

              {error && !pendingDelta && !showDisposalDialog && (
                <Text style={[styles.errorText, { color: "#f87171" }]}>
                  {error}
                </Text>
              )}

              <Pressable
                style={[
                  styles.saveButton,
                  { backgroundColor: theme.tint },
                  savingMeta && { opacity: 0.6 },
                ]}
                onPress={handleSaveMeta}
                disabled={savingMeta}
              >
                {savingMeta ? (
                  <View style={styles.savingContainer}>
                    <ActivityIndicator size="small" color="#000" />
                    <Text style={styles.saveButtonText}>Saving…</Text>
                  </View>
                ) : (
                  <Text style={styles.saveButtonText}>Save changes</Text>
                )}
              </Pressable>

              <Pressable
                style={[
                  styles.disposeButton,
                  { borderColor: "#f97316" },
                  (disposingItem || savingMeta || deletingItem) && { opacity: 0.6 },
                ]}
                onPress={handleDisposeItem}
                disabled={disposingItem || savingMeta || deletingItem}
              >
                <Text style={styles.disposeButtonText}>Mark as Disposed</Text>
              </Pressable>

              <Pressable
                style={[
                  styles.deleteButton,
                  { borderColor: "#ef4444" },
                  (deletingItem || savingMeta) && { opacity: 0.6 },
                ]}
                onPress={handleDeleteItem}
                disabled={deletingItem || savingMeta}
              >
                {deletingItem ? (
                  <ActivityIndicator />
                ) : (
                  <Text style={styles.deleteButtonText}>Delete item</Text>
                )}
              </Pressable>
            </View>

            <View
              style={[
                styles.card,
                { backgroundColor: theme.card, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: theme.text }]}>
                Recent movements
              </Text>

              {loadingMovements ? (
                <View style={styles.centerSmall}>
                  <ActivityIndicator />
                </View>
              ) : movements.length === 0 ? (
                <Text style={[styles.noMovementsText, { color: theme.mutedText }]}>
                  No movements logged yet for this item.
                </Text>
              ) : (
                movements.slice(0, 15).map((m) => {
                  const isOut = m.type === "out" || m.delta < 0;
                  const isDisposal = m.type === "disposal";
                  return (
                    <View key={m.id} style={styles.movementRow}>
                      <View
                        style={[
                          styles.movementPill,
                          isDisposal
                            ? { backgroundColor: "rgba(249, 115, 22, 0.25)" }
                            : isOut
                            ? styles.movementOut
                            : styles.movementIn,
                        ]}
                      >
                        <Text
                          style={[
                            styles.movementPillText,
                            { color: theme.text },
                          ]}
                        >
                          {isDisposal ? "DISPOSE" : isOut ? "OUT" : "IN"}
                        </Text>
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text style={[styles.movementMain, { color: theme.text }]}>
                          {m.by || "Unknown"} • {isOut || isDisposal ? m.delta : `+${m.delta}`} •
                          New: {m.newQuantity}
                        </Text>

                        {m.note ? (
                          <Text
                            style={[
                              styles.movementNote,
                              { color: theme.mutedText },
                            ]}
                          >
                            {m.note}
                          </Text>
                        ) : null}

                        <Text
                          style={[
                            styles.movementTime,
                            { color: theme.mutedText },
                          ]}
                        >
                          {formatMovementTime(m)}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </>
        )}
      </ScrollView>

      {/* Movement dialog overlay */}
      {item && pendingDelta !== null && (
        <View style={styles.overlayBackdrop}>
          <View
            style={[
              styles.overlayCard,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.overlayTitle, { color: theme.text }]}>
              {pendingDelta < 0 ? "Remove from stock" : "Add to stock"}
            </Text>

            <Text style={[styles.overlaySub, { color: theme.mutedText }]}>
              Current: {item.currentQuantity} • Change:{" "}
              {pendingDelta > 0 ? `+${pendingDelta}` : pendingDelta}
            </Text>

            <Text style={[styles.fieldLabel, { color: theme.text }]}>
              Who is taking / adding it?
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: theme.border,
                  color: theme.text,
                  backgroundColor: theme.background,
                },
              ]}
              placeholder="Name or initials"
              placeholderTextColor={theme.mutedText}
              value={movementBy}
              onChangeText={setMovementBy}
            />

            <Text style={[styles.fieldLabel, { color: theme.text }]}>
              Note (optional)
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  height: 70,
                  textAlignVertical: "top",
                  borderColor: theme.border,
                  color: theme.text,
                  backgroundColor: theme.background,
                },
              ]}
              placeholder="e.g. Guest PC 14, Table games project, etc."
              placeholderTextColor={theme.mutedText}
              value={movementNote}
              onChangeText={setMovementNote}
              multiline
            />

            {error && (
              <Text
                style={[
                  styles.errorText,
                  { color: "#f87171", marginTop: 6 },
                ]}
              >
                {error}
              </Text>
            )}

            <View style={styles.overlayButtonsRow}>
              <Pressable
                onPress={closeMovementDialog}
                style={[
                  styles.overlayButton,
                  styles.overlayCancel,
                  { borderColor: theme.border },
                ]}
                disabled={savingMovement}
              >
                <Text style={[styles.overlayCancelText, { color: theme.text }]}>
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                onPress={applyQuantityChange}
                style={[
                  styles.overlayButton,
                  styles.overlayConfirm,
                  savingMovement && { opacity: 0.7 },
                ]}
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

      {/* Disposal dialog overlay */}
      {item && showDisposalDialog && (
        <View style={styles.overlayBackdrop}>
          <View
            style={[
              styles.overlayCard,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.overlayTitle, { color: theme.text }]}>
              Mark as Disposed
            </Text>

            <Text style={[styles.overlaySub, { color: theme.mutedText }]}>
              Current stock: {item.currentQuantity}
            </Text>

            <Text style={[styles.fieldLabel, { color: theme.text }]}>
              Quantity to dispose
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: theme.border,
                  color: theme.text,
                  backgroundColor: theme.background,
                },
              ]}
              placeholder="1"
              placeholderTextColor={theme.mutedText}
              keyboardType="numeric"
              value={disposalQuantity}
              onChangeText={setDisposalQuantity}
            />

            <Text style={[styles.fieldLabel, { color: theme.text }]}>
              Reason
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {["broken", "damaged", "obsolete", "lost", "other"].map((r) => (
                <Pressable
                  key={r}
                  onPress={() => setDisposalReason(r as any)}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: disposalReason === r ? theme.tint : theme.border,
                    backgroundColor: disposalReason === r ? theme.card : "transparent",
                  }}
                >
                  <Text
                    style={{
                      color: disposalReason === r ? theme.tint : theme.text,
                      fontWeight: "700",
                      fontSize: 12,
                    }}
                  >
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.fieldLabel, { color: theme.text }]}>
              Notes (optional)
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  height: 70,
                  textAlignVertical: "top",
                  borderColor: theme.border,
                  color: theme.text,
                  backgroundColor: theme.background,
                },
              ]}
              placeholder="e.g. Screen cracked, water damage, etc."
              placeholderTextColor={theme.mutedText}
              value={disposalNotes}
              onChangeText={setDisposalNotes}
              multiline
            />

            {error && showDisposalDialog && (
              <Text
                style={[
                  styles.errorText,
                  { color: "#f87171", marginTop: 6 },
                ]}
              >
                {error}
              </Text>
            )}

            <View style={styles.overlayButtonsRow}>
              <Pressable
                onPress={() => setShowDisposalDialog(false)}
                style={[
                  styles.overlayButton,
                  styles.overlayCancel,
                  { borderColor: theme.border },
                ]}
                disabled={disposingItem}
              >
                <Text style={[styles.overlayCancelText, { color: theme.text }]}>
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                onPress={confirmDisposal}
                style={[
                  styles.overlayButton,
                  { backgroundColor: "#f97316" },
                  disposingItem && { opacity: 0.7 },
                ]}
                disabled={disposingItem}
              >
                {disposingItem ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={{ color: "#000", fontWeight: "900" }}>Dispose</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* Toast notification */}
      <Toast toast={toast} fadeAnim={fadeAnim} onDismiss={hideToast} />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    flexGrow: 1,
  },
  center: {
    marginTop: 40,
    alignItems: "center",
  },
  centerSmall: {
    marginTop: 8,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 8,
  },
  errorText: {
    fontSize: 14,
    fontWeight: "800",
    marginTop: 10,
  },
  subText: {
    marginTop: 4,
    fontSize: 13,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  name: {
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 4,
  },
  idText: {
    fontSize: 11,
    marginBottom: 8,
  },
  bannerLow: {
    backgroundColor: "rgba(239, 68, 68, 0.18)",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: "flex-start",
  },
  bannerLowText: {
    color: "#fecaca",
    fontSize: 12,
    fontWeight: "700",
  },
  bannerOk: {
    backgroundColor: "rgba(16, 185, 129, 0.18)",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: "flex-start",
  },
  bannerOkText: {
    color: "#bbf7d0",
    fontSize: 12,
    fontWeight: "700",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  label: {
    fontSize: 14,
  },
  value: {
    fontSize: 15,
    fontWeight: "700",
  },
  valueBig: {
    fontSize: 20,
    fontWeight: "900",
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  stockButton: {
    flex: 1,
    marginHorizontal: 4,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: "center",
    borderWidth: 1,
  },
  stockButtonMinus: {
    borderColor: "#f97373",
    backgroundColor: "rgba(239, 68, 68, 0.12)",
  },
  stockButtonPlus: {
    borderColor: "#34d399",
    backgroundColor: "rgba(16, 185, 129, 0.12)",
  },
  stockButtonText: {
    fontWeight: "800",
    fontSize: 14,
  },
  fieldLabel: {
    fontSize: 13,
    marginTop: 10,
    marginBottom: 4,
    fontWeight: "700",
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  saveButton: {
    marginTop: 14,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: "center",
  },
  saveButtonText: {
    color: "#000",
    fontWeight: "900",
  },
  savingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  disposeButton: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: "center",
    borderWidth: 1,
    backgroundColor: "transparent",
  },
  disposeButtonText: {
    color: "#f97316",
    fontWeight: "900",
  },
  deleteButton: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: "center",
    borderWidth: 1,
    backgroundColor: "transparent",
  },
  deleteButtonText: {
    color: "#ef4444",
    fontWeight: "900",
  },
  movementRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 8,
  },
  movementPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    marginRight: 8,
    marginTop: 2,
  },
  movementOut: {
    backgroundColor: "rgba(239, 68, 68, 0.25)",
  },
  movementIn: {
    backgroundColor: "rgba(34, 197, 94, 0.25)",
  },
  movementPillText: {
    fontSize: 11,
    fontWeight: "800",
  },
  movementMain: {
    fontSize: 13,
    fontWeight: "700",
  },
  movementNote: {
    fontSize: 12,
  },
  movementTime: {
    fontSize: 11,
    marginTop: 1,
  },
  noMovementsText: {
    fontSize: 13,
    marginTop: 8,
  },
  overlayBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  overlayCard: {
    width: "90%",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
  },
  overlayTitle: {
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 4,
  },
  overlaySub: {
    fontSize: 13,
    marginBottom: 10,
  },
  overlayButtonsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 14,
  },
  overlayButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    marginLeft: 8,
  },
  overlayCancel: {
    backgroundColor: "transparent",
    borderWidth: 1,
  },
  overlayCancelText: {
    fontWeight: "700",
  },
  overlayConfirm: {
    backgroundColor: "#22c55e",
  },
  overlayConfirmText: {
    color: "#000",
    fontWeight: "900",
  },
});