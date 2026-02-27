// app/(tabs)/index.tsx
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAppTheme } from "../../constants/theme";
import { db } from "../../firebaseConfig";
import { useUserProfile } from "../../hooks/useUserProfile";

type Item = {
  id: string;
  name: string;
  currentQuantity: number;
  minQuantity: number;
  location?: string;
  barcode?: string;
  notes?: string;
};

type Toner = {
  id: string;
  model: string;
  partNumber?: string;
  color: string;
  quantity: number;
  minQuantity: number;
  printer?: string;
  supplier?: string;
  notes?: string;
  siteId: string;
};

type Printer = {
  id: string;
  name: string;
  location?: string;
  ipAddress?: string;
  siteId: string;
};

type SortMode = "name" | "stock";
type TabMode = "inventory" | "toners";
type TonerSubTab = "toners" | "printers";

const TONER_COLORS = ["Black", "Cyan", "Magenta", "Yellow", "Other"];

export default function IndexScreen() {
  const theme = useAppTheme();
  const { uid, profile, siteId, loading: profileLoading } = useUserProfile();

  // Tab state
  const [activeTab, setActiveTab] = useState<TabMode>("inventory");
  const [tonerSubTab, setTonerSubTab] = useState<TonerSubTab>("toners");

  // --- Inventory state ---
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("name");

  // --- Undo delete state ---
  const [pendingDelete, setPendingDelete] = useState<{
    item: Item;
    backup: any;
    timeoutId: any;
  } | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const undoAnim = useRef(new Animated.Value(0)).current;

  // --- Toner state ---
  const [toners, setToners] = useState<Toner[]>([]);
  const [tonersLoading, setTonersLoading] = useState(true);
  const [tonerSearch, setTonerSearch] = useState("");
  const [showTonerLowOnly, setShowTonerLowOnly] = useState(false);
  const [showTonerModal, setShowTonerModal] = useState(false);
  const [editingToner, setEditingToner] = useState<Toner | null>(null);
  const [tonerForm, setTonerForm] = useState({
    model: "",
    partNumber: "",
    color: "Black",
    quantity: "",
    minQuantity: "",
    printer: "",
    supplier: "",
    notes: "",
  });
  const [savingToner, setSavingToner] = useState(false);
  const [showPrinterDropdown, setShowPrinterDropdown] = useState(false);

  // --- Printer state ---
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [printersLoading, setPrintersLoading] = useState(true);
  const [importingPrinters, setImportingPrinters] = useState(false);

  // ─── Undo helpers ───────────────────────────────────────────────
  const showUndoBar = () => {
    Animated.timing(undoAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  };
  const hideUndoBar = () => {
    Animated.timing(undoAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start();
  };

  const scheduleDelete = async (item: Item) => {
    if (pendingDelete?.timeoutId) {
      clearTimeout(pendingDelete.timeoutId);
      try { await deleteDoc(doc(db, "items", pendingDelete.item.id)); } catch {}
      setPendingDelete(null);
      setHiddenIds((p) => { const n = new Set(p); n.delete(pendingDelete.item.id); return n; });
      hideUndoBar();
    }

    const backup = {
      name: item.name,
      currentQuantity: item.currentQuantity,
      minQuantity: item.minQuantity,
      location: item.location ?? "",
      barcode: item.barcode ?? "",
      notes: item.notes ?? "",
      siteId: siteId ?? null,
    };

    setHiddenIds((p) => new Set(p).add(item.id));
    showUndoBar();

    const timeoutId = setTimeout(async () => {
      try { await deleteDoc(doc(db, "items", item.id)); } catch {
        setHiddenIds((p) => { const n = new Set(p); n.delete(item.id); return n; });
      } finally {
        hideUndoBar();
        setPendingDelete(null);
      }
    }, 5000);

    setPendingDelete({ item, backup, timeoutId });
  };

  const undoDelete = async () => {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timeoutId);
    setHiddenIds((p) => { const n = new Set(p); n.delete(pendingDelete.item.id); return n; });
    try {
      await setDoc(doc(db, "items", pendingDelete.item.id), pendingDelete.backup, { merge: true });
    } catch {} finally {
      hideUndoBar();
      setPendingDelete(null);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  };

  // ─── Inventory listener ──────────────────────────────────────────
  useEffect(() => {
    if (profileLoading) return;
    if (!siteId) { setItems([]); setLoading(false); return; }

    setLoading(true);
    const q = query(collection(db, "items"), where("siteId", "==", siteId));
    const unsub = onSnapshot(q, (snap) => {
      const list: Item[] = snap.docs.map((docSnap) => {
        const d = docSnap.data() as any;
        return {
          id: docSnap.id,
          name: d.name || "Unnamed item",
          currentQuantity: Number(d.currentQuantity ?? 0),
          minQuantity: Number(d.minQuantity ?? 0),
          location: d.location || "",
          barcode: d.barcode || "",
          notes: d.notes || "",
        };
      });
      setItems(list.filter((i) => !hiddenIds.has(i.id)));
      setLoading(false);
    }, (err) => {
      console.log("Inventory snapshot error:", err);
      setItems([]);
      setLoading(false);
    });
    return () => unsub();
  }, [siteId, profileLoading, hiddenIds]);

  // ─── Toners listener ─────────────────────────────────────────────
  useEffect(() => {
    if (profileLoading) return;
    if (!siteId) { setToners([]); setTonersLoading(false); return; }

    setTonersLoading(true);
    const q = query(collection(db, "toners"), where("siteId", "==", siteId));
    const unsub = onSnapshot(q, (snap) => {
      const list: Toner[] = snap.docs.map((docSnap) => {
        const d = docSnap.data() as any;
        return {
          id: docSnap.id,
          model: d.model || "Unknown model",
          partNumber: d.partNumber || "",
          color: d.color || "Black",
          quantity: Number(d.quantity ?? 0),
          minQuantity: Number(d.minQuantity ?? 0),
          printer: d.printer || "",
          supplier: d.supplier || "",
          notes: d.notes || "",
          siteId: d.siteId || "",
        };
      });
      setToners(list);
      setTonersLoading(false);
    }, (err) => {
      console.log("Toners snapshot error:", err);
      setToners([]);
      setTonersLoading(false);
    });
    return () => unsub();
  }, [siteId, profileLoading]);

  // ─── Printers listener ───────────────────────────────────────────
  useEffect(() => {
    if (profileLoading) return;
    if (!siteId) { setPrinters([]); setPrintersLoading(false); return; }

    setPrintersLoading(true);
    const q = query(collection(db, "printers"), where("siteId", "==", siteId));
    const unsub = onSnapshot(q, (snap) => {
      const list: Printer[] = snap.docs.map((docSnap) => {
        const d = docSnap.data() as any;
        return {
          id: docSnap.id,
          name: d.name || "Unknown printer",
          location: d.location || "",
          ipAddress: d.ipAddress || "",
          siteId: d.siteId || "",
        };
      });
      setPrinters(list.sort((a, b) => a.name.localeCompare(b.name)));
      setPrintersLoading(false);
    }, (err) => {
      console.log("Printers snapshot error:", err);
      setPrinters([]);
      setPrintersLoading(false);
    });
    return () => unsub();
  }, [siteId, profileLoading]);

  // ─── Inventory computed ──────────────────────────────────────────
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filtered = useMemo(() => {
    let list = normalizedQuery.length === 0
      ? items
      : items.filter((i) => [i.name, i.location, i.barcode, i.notes].join(" ").toLowerCase().includes(normalizedQuery));
    if (showLowOnly) list = list.filter((i) => i.currentQuantity <= i.minQuantity);
    return list;
  }, [items, normalizedQuery, showLowOnly]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => sortMode === "name" ? a.name.localeCompare(b.name) : a.currentQuantity - b.currentQuantity);
    return list;
  }, [filtered, sortMode]);

  const lowStockCount = useMemo(() => items.filter((i) => i.currentQuantity <= i.minQuantity).length, [items]);

  // ─── Toners computed ─────────────────────────────────────────────
  const normalizedTonerQuery = tonerSearch.trim().toLowerCase();
  const filteredToners = useMemo(() => {
    let list = normalizedTonerQuery.length === 0
      ? toners
      : toners.filter((t) => [t.model, t.partNumber, t.color, t.printer, t.supplier, t.notes].join(" ").toLowerCase().includes(normalizedTonerQuery));
    if (showTonerLowOnly) list = list.filter((t) => t.quantity <= t.minQuantity);
    return list;
  }, [toners, normalizedTonerQuery, showTonerLowOnly]);

  const tonerLowCount = useMemo(() => toners.filter((t) => t.quantity <= t.minQuantity).length, [toners]);

  // ─── Toner modal helpers ─────────────────────────────────────────
  const openAddToner = () => {
    setEditingToner(null);
    setTonerForm({ model: "", partNumber: "", color: "Black", quantity: "", minQuantity: "", printer: "", supplier: "", notes: "" });
    setShowPrinterDropdown(false);
    setShowTonerModal(true);
  };

  const openEditToner = (toner: Toner) => {
    setEditingToner(toner);
    setTonerForm({
      model: toner.model,
      partNumber: toner.partNumber || "",
      color: toner.color,
      quantity: toner.quantity.toString(),
      minQuantity: toner.minQuantity.toString(),
      printer: toner.printer || "",
      supplier: toner.supplier || "",
      notes: toner.notes || "",
    });
    setShowPrinterDropdown(false);
    setShowTonerModal(true);
  };

  const saveToner = async () => {
    if (!tonerForm.model.trim()) {
      Alert.alert("Required", "Please enter a model name.");
      return;
    }
    if (!siteId) return;

    setSavingToner(true);
    try {
      const data = {
        model: tonerForm.model.trim(),
        partNumber: tonerForm.partNumber.trim(),
        color: tonerForm.color,
        quantity: parseInt(tonerForm.quantity) || 0,
        minQuantity: parseInt(tonerForm.minQuantity) || 0,
        printer: tonerForm.printer.trim(),
        supplier: tonerForm.supplier.trim(),
        notes: tonerForm.notes.trim(),
        siteId,
      };

      if (editingToner) {
        await setDoc(doc(db, "toners", editingToner.id), data, { merge: true });
      } else {
        await addDoc(collection(db, "toners"), data);
      }
      setShowTonerModal(false);
    } catch (err) {
      Alert.alert("Error", "Failed to save toner.");
    } finally {
      setSavingToner(false);
    }
  };

  const deleteToner = (toner: Toner) => {
    Alert.alert("Delete Toner?", `Delete "${toner.model} (${toner.color})"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try { await deleteDoc(doc(db, "toners", toner.id)); } catch {
            Alert.alert("Error", "Failed to delete toner.");
          }
        },
      },
    ]);
  };

  const deletePrinter = (printer: Printer) => {
    Alert.alert("Delete Printer?", `Delete "${printer.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try { await deleteDoc(doc(db, "printers", printer.id)); } catch {
            Alert.alert("Error", "Failed to delete printer.");
          }
        },
      },
    ]);
  };

  // ─── CSV Import ──────────────────────────────────────────────────
  const parseCSV = (text: string): string[][] => {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) =>
        line.split(",").map((cell) =>
          cell.trim().replace(/^"|"$/g, "").replace(/""/g, '"')
        )
      );
  };

  const importPrintersFromCSV = async () => {
    if (!siteId) return;

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "text/plain"],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      if (!file?.uri) return;

      setImportingPrinters(true);

      const content = await FileSystem.readAsStringAsync(file.uri, {
        encoding: "utf8",
      });

      const rows = parseCSV(content);

      if (rows.length < 2) {
        Alert.alert("Invalid CSV", "The file must have a header row and at least one printer.");
        setImportingPrinters(false);
        return;
      }

      // Find column indices from header row (handles BOM and various column name formats)
      const header = rows[0].map((h) => h.toLowerCase().trim().replace(/^\uFEFF/, "").replace(/\uFEFF/g, ""));

      // Map exact column names from the master CSV
      const finalNameIdx = header.findIndex((h) => h === "model");
      const finalLocationIdx = header.findIndex((h) => h === "description");
      const finalIpIdx = header.findIndex((h) => h === "ip");

      // Fallbacks for simpler CSVs
      const fallbackNameIdx = header.findIndex((h) => h.includes("name") || h.includes("model"));
      const fallbackLocationIdx = header.findIndex((h) => h.includes("location") || h.includes("room"));
      const fallbackIpIdx = header.findIndex((h) => h.includes("ip"));

      const nameIdx = finalNameIdx >= 0 ? finalNameIdx : fallbackNameIdx;
      const locationIdx = finalLocationIdx >= 0 ? finalLocationIdx : fallbackLocationIdx;
      const ipIdx = finalIpIdx >= 0 ? finalIpIdx : fallbackIpIdx;

      if (nameIdx === -1) {
        Alert.alert("Invalid CSV", "Could not find a 'Model' or 'Name' column in the header.");
        setImportingPrinters(false);
        return;
      }

      const dataRows = rows.slice(1);
      const validRows = dataRows.filter((row) => row[nameIdx]?.trim());

      if (validRows.length === 0) {
        Alert.alert("No Data", "No valid printer rows found in the CSV.");
        setImportingPrinters(false);
        return;
      }

      Alert.alert(
        "Import Printers",
        `Found ${validRows.length} printer(s). Import them now?`,
        [
          { text: "Cancel", style: "cancel", onPress: () => setImportingPrinters(false) },
          {
            text: "Import",
            onPress: async () => {
              try {
                const batchSize = 499;
                for (let i = 0; i < validRows.length; i += batchSize) {
                  const batch = writeBatch(db);
                  const chunk = validRows.slice(i, i + batchSize);
                  chunk.forEach((row) => {
                    const safeName = (row[nameIdx]?.trim() || "").toLowerCase().replace(/[^a-z0-9]/g, "_");
                    const safeIp = (ipIdx >= 0 ? row[ipIdx]?.trim() : "").replace(/[^a-z0-9]/g, "_");
                    const safeLocation = (locationIdx >= 0 ? row[locationIdx]?.trim() : "").toLowerCase().replace(/[^a-z0-9]/g, "_");
                    // Use IP if available, otherwise use location to keep spares unique
                    const uniquePart = safeIp || safeLocation || safeName;
                    const docId = `${siteId}__${safeName}__${uniquePart}`;
                    const ref = doc(db, "printers", docId);
                    batch.set(ref, {
                      name: row[nameIdx]?.trim() || "",
                      location: locationIdx >= 0 ? (row[locationIdx]?.trim() || "") : "",
                      ipAddress: ipIdx >= 0 ? (row[ipIdx]?.trim() || "") : "",
                      siteId,
                    }, { merge: true });
                  });
                  await batch.commit();
                }
                Alert.alert("Success", `${validRows.length} printer(s) imported. Existing printers were updated.`);
              } catch (err) {
                Alert.alert("Error", "Failed to import printers.");
              } finally {
                setImportingPrinters(false);
              }
            },
          },
        ]
      );
    } catch (err) {
      console.error("CSV import error:", err);
      Alert.alert("Error", "Failed to read the CSV file.");
      setImportingPrinters(false);
    }
  };

  const tonerColorDot = (color: string) => {
    switch (color.toLowerCase()) {
      case "black": return "#1f2937";
      case "cyan": return "#06b6d4";
      case "magenta": return "#ec4899";
      case "yellow": return "#eab308";
      default: return "#6b7280";
    }
  };

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <StatusBar style="auto" />

      <Text style={[styles.screenTitle, { color: theme.text }]}>Control Deck</Text>

      {!siteId ? (
        <Text style={{ color: "#ef4444", marginTop: 8, fontWeight: "800" }}>
          Your account doesn't have a site assigned yet.
        </Text>
      ) : null}

      {/* Sub-tabs */}
      <View style={[styles.subTabRow, { borderColor: theme.border }]}>
        <Pressable
          style={[styles.subTab, activeTab === "inventory" && { borderBottomColor: theme.tint, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab("inventory")}
        >
          <Text style={[styles.subTabText, { color: activeTab === "inventory" ? theme.tint : theme.mutedText }]}>
            Inventory
          </Text>
        </Pressable>
        <Pressable
          style={[styles.subTab, activeTab === "toners" && { borderBottomColor: theme.tint, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab("toners")}
        >
          <Text style={[styles.subTabText, { color: activeTab === "toners" ? theme.tint : theme.mutedText }]}>
            Toners {tonerLowCount > 0 ? "🔴" : ""}
          </Text>
        </Pressable>
      </View>

      {/* ── INVENTORY TAB ── */}
      {activeTab === "inventory" && (
        <>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator />
              <Text style={{ color: theme.mutedText, marginTop: 10 }}>Loading inventory…</Text>
            </View>
          ) : (
            <>
              <TextInput
                style={[styles.searchInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                placeholder="Search name, location, barcode, or notes…"
                placeholderTextColor={theme.mutedText}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />

              <View style={styles.filterRow}>
                <Pressable
                  onPress={() => setShowLowOnly((p) => !p)}
                  style={[styles.chip, { borderColor: showLowOnly ? theme.tint : theme.border, backgroundColor: showLowOnly ? theme.card : "transparent" }]}
                >
                  <Text style={[styles.chipText, { color: showLowOnly ? theme.text : theme.mutedText }]}>Low stock only</Text>
                </Pressable>

                <View style={styles.sortGroup}>
                  <Pressable
                    onPress={() => setSortMode("name")}
                    style={[styles.chipSmall, { borderColor: sortMode === "name" ? theme.tint : theme.border, backgroundColor: sortMode === "name" ? theme.card : "transparent" }]}
                  >
                    <Text style={[styles.chipTextSmall, { color: sortMode === "name" ? theme.text : theme.mutedText }]}>A–Z</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setSortMode("stock")}
                    style={[styles.chipSmall, { borderColor: sortMode === "stock" ? theme.tint : theme.border, backgroundColor: sortMode === "stock" ? theme.card : "transparent" }]}
                  >
                    <Text style={[styles.chipTextSmall, { color: sortMode === "stock" ? theme.text : theme.mutedText }]}>Low → High</Text>
                  </Pressable>
                </View>
              </View>

              {siteId && lowStockCount > 0 && !showLowOnly && normalizedQuery.length === 0 ? (
                <View style={[styles.alertBox, { borderColor: "#ef4444", backgroundColor: "rgba(239, 68, 68, 0.18)" }]}>
                  <Text style={[styles.alertTitle, { color: theme.text }]}>Needs Attention</Text>
                  <Text style={[styles.alertText, { color: theme.mutedText }]}>
                    {lowStockCount} item{lowStockCount === 1 ? " is" : "s are"} at or below minimum stock.
                  </Text>
                </View>
              ) : null}

              {!siteId ? (
                <Text style={{ color: theme.mutedText, marginTop: 14 }}>No site assigned for this user yet.</Text>
              ) : sorted.length === 0 ? (
                <Text style={{ color: theme.mutedText, marginTop: 14 }}>No items found.</Text>
              ) : (
                <FlatList
                  data={sorted}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={{ paddingBottom: 90 }}
                  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.tint} colors={[theme.tint]} />}
                  renderItem={({ item }) => {
                    const isLow = item.currentQuantity <= item.minQuantity;
                    return (
                      <Pressable
                        onPress={() => router.push({ pathname: "/item/[id]", params: { id: item.id } })}
                        style={[styles.card, { backgroundColor: theme.card, borderColor: isLow ? "#ef4444" : theme.border }]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.itemName, { color: theme.text }]}>{item.name}</Text>
                          {item.location ? <Text style={{ color: theme.tint, fontSize: 12, marginTop: 2 }}>Location: {item.location}</Text> : null}
                          {item.barcode ? <Text style={{ color: theme.mutedText, fontSize: 11, marginTop: 2 }}>Barcode: {item.barcode}</Text> : null}
                          {item.notes ? <Text numberOfLines={2} style={{ color: theme.mutedText, fontSize: 12, marginTop: 4 }}>Note: {item.notes}</Text> : null}
                        </View>
                        <View style={styles.rightControls}>
                          <Pressable
                            onPress={() => Alert.alert("Delete item?", `Delete "${item.name}"? You can undo for 5 seconds.`, [
                              { text: "Cancel", style: "cancel" },
                              { text: "Delete", style: "destructive", onPress: () => scheduleDelete(item) },
                            ])}
                            hitSlop={10}
                          >
                            <Ionicons name="trash-outline" size={18} color={theme.mutedText} />
                          </Pressable>
                          <Text style={{ fontWeight: "900", color: isLow ? "#ef4444" : theme.text, fontSize: 16, width: 28, textAlign: "right" }}>
                            {item.currentQuantity}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  }}
                />
              )}
            </>
          )}
        </>
      )}

      {/* ── TONERS TAB ── */}
      {activeTab === "toners" && (
        <>
          {/* Toner sub-tabs */}
          <View style={[styles.tonerSubTabRow, { borderColor: theme.border }]}>
            <Pressable
              style={[styles.tonerSubTab, tonerSubTab === "toners" && { borderBottomColor: "#007AFF", borderBottomWidth: 2 }]}
              onPress={() => setTonerSubTab("toners")}
            >
              <Text style={[styles.tonerSubTabText, { color: tonerSubTab === "toners" ? "#007AFF" : theme.mutedText }]}>
                Toners
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tonerSubTab, tonerSubTab === "printers" && { borderBottomColor: "#007AFF", borderBottomWidth: 2 }]}
              onPress={() => setTonerSubTab("printers")}
            >
              <Text style={[styles.tonerSubTabText, { color: tonerSubTab === "printers" ? "#007AFF" : theme.mutedText }]}>
                Printers ({printers.length})
              </Text>
            </Pressable>
          </View>

          {/* ── TONERS SUB-TAB ── */}
          {tonerSubTab === "toners" && (
            <>
              {tonersLoading ? (
                <View style={styles.center}>
                  <ActivityIndicator />
                  <Text style={{ color: theme.mutedText, marginTop: 10 }}>Loading toners…</Text>
                </View>
              ) : (
                <>
                  <View style={styles.tonerHeaderRow}>
                    <TextInput
                      style={[styles.searchInput, { flex: 1, borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                      placeholder="Search model, printer, supplier…"
                      placeholderTextColor={theme.mutedText}
                      value={tonerSearch}
                      onChangeText={setTonerSearch}
                    />
                    <Pressable style={[styles.addTonerBtn, { backgroundColor: '#007AFF' }]} onPress={openAddToner}>
                      <Ionicons name="add" size={22} color="#fff" />
                    </Pressable>
                  </View>

                  <Pressable
                    onPress={() => setShowTonerLowOnly((p) => !p)}
                    style={[styles.chip, { borderColor: showTonerLowOnly ? theme.tint : theme.border, backgroundColor: showTonerLowOnly ? theme.card : "transparent", marginBottom: 12 }]}
                  >
                    <Text style={[styles.chipText, { color: showTonerLowOnly ? theme.text : theme.mutedText }]}>Low stock only</Text>
                  </Pressable>

                  {tonerLowCount > 0 && !showTonerLowOnly && normalizedTonerQuery.length === 0 ? (
                    <View style={[styles.alertBox, { borderColor: "#ef4444", backgroundColor: "rgba(239, 68, 68, 0.18)" }]}>
                      <Text style={[styles.alertTitle, { color: theme.text }]}>Low Toner Stock</Text>
                      <Text style={[styles.alertText, { color: theme.mutedText }]}>
                        {tonerLowCount} toner{tonerLowCount === 1 ? " is" : "s are"} at or below minimum stock.
                      </Text>
                    </View>
                  ) : null}

                  {filteredToners.length === 0 ? (
                    <View style={styles.center}>
                      <Text style={{ color: theme.mutedText, marginTop: 14 }}>No toners found.</Text>
                      <Pressable style={[styles.addTonerBtn, { backgroundColor: '#007AFF', marginTop: 16 }]} onPress={openAddToner}>
                        <Ionicons name="add" size={22} color="#fff" />
                      </Pressable>
                    </View>
                  ) : (
                    <FlatList
                      data={filteredToners}
                      keyExtractor={(t) => t.id}
                      contentContainerStyle={{ paddingBottom: 90 }}
                      renderItem={({ item: toner }) => {
                        const isLow = toner.quantity <= toner.minQuantity;
                        return (
                          <Pressable
                            onPress={() => openEditToner(toner)}
                            style={[styles.card, { backgroundColor: theme.card, borderColor: isLow ? "#ef4444" : theme.border }]}
                          >
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: tonerColorDot(toner.color) }} />
                                <Text style={[styles.itemName, { color: theme.text }]}>{toner.model}</Text>
                              </View>
                              {toner.partNumber ? <Text style={{ color: theme.mutedText, fontSize: 11, marginTop: 2 }}>Part #: {toner.partNumber}</Text> : null}
                              {toner.printer ? <Text style={{ color: theme.tint, fontSize: 12, marginTop: 2 }}>Printer: {toner.printer}</Text> : null}
                              {toner.supplier ? <Text style={{ color: theme.mutedText, fontSize: 12, marginTop: 2 }}>Supplier: {toner.supplier}</Text> : null}
                              {toner.notes ? <Text numberOfLines={2} style={{ color: theme.mutedText, fontSize: 12, marginTop: 4 }}>Note: {toner.notes}</Text> : null}
                            </View>
                            <View style={styles.rightControls}>
                              <Pressable onPress={() => deleteToner(toner)} hitSlop={10}>
                                <Ionicons name="trash-outline" size={18} color={theme.mutedText} />
                              </Pressable>
                              <Text style={{ fontWeight: "900", color: isLow ? "#ef4444" : theme.text, fontSize: 16, width: 28, textAlign: "right" }}>
                                {toner.quantity}
                              </Text>
                            </View>
                          </Pressable>
                        );
                      }}
                    />
                  )}
                </>
              )}
            </>
          )}

          {/* ── PRINTERS SUB-TAB ── */}
          {tonerSubTab === "printers" && (
            <>
              {printersLoading ? (
                <View style={styles.center}>
                  <ActivityIndicator />
                  <Text style={{ color: theme.mutedText, marginTop: 10 }}>Loading printers…</Text>
                </View>
              ) : (
                <>
                  <Pressable
                    style={[styles.importBtn, { borderColor: "#007AFF" }, importingPrinters && { opacity: 0.6 }]}
                    onPress={importPrintersFromCSV}
                    disabled={importingPrinters}
                  >
                    {importingPrinters ? (
                      <ActivityIndicator color="#007AFF" size="small" />
                    ) : (
                      <>
                        <Ionicons name="cloud-upload-outline" size={18} color="#007AFF" />
                        <Text style={styles.importBtnText}>Import Printers from CSV</Text>
                      </>
                    )}
                  </Pressable>

                  <Text style={{ color: theme.mutedText, fontSize: 12, marginBottom: 14 }}>
                    CSV format: Name, Location, IP Address (first row = header)
                  </Text>

                  {printers.length === 0 ? (
                    <View style={styles.center}>
                      <Text style={{ color: theme.mutedText, textAlign: "center" }}>
                        No printers yet.{"\n"}Import a CSV to get started.
                      </Text>
                    </View>
                  ) : (
                    <FlatList
                      data={printers}
                      keyExtractor={(p) => p.id}
                      contentContainerStyle={{ paddingBottom: 90 }}
                      renderItem={({ item: printer }) => (
                        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                              <Ionicons name="print-outline" size={16} color={theme.mutedText} />
                              <Text style={[styles.itemName, { color: theme.text }]}>{printer.name}</Text>
                            </View>
                            {printer.location ? <Text style={{ color: theme.tint, fontSize: 12, marginTop: 2 }}>Location: {printer.location}</Text> : null}
                            {printer.ipAddress ? <Text style={{ color: theme.mutedText, fontSize: 11, marginTop: 2 }}>IP: {printer.ipAddress}</Text> : null}
                          </View>
                          <Pressable onPress={() => deletePrinter(printer)} hitSlop={10}>
                            <Ionicons name="trash-outline" size={18} color={theme.mutedText} />
                          </Pressable>
                        </View>
                      )}
                    />
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      {/* Undo bar */}
      {pendingDelete ? (
        <Animated.View style={[styles.undoBar, { backgroundColor: theme.card, borderColor: theme.border, opacity: undoAnim }]}>
          <Text style={{ color: theme.text }} numberOfLines={1}>Deleted "{pendingDelete.item.name}"</Text>
          <Pressable onPress={undoDelete}>
            <Text style={{ color: theme.tint, fontWeight: "900" }}>UNDO</Text>
          </Pressable>
        </Animated.View>
      ) : null}

      {/* ── TONER MODAL ── */}
      <Modal visible={showTonerModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowTonerModal(false)}>
        <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{editingToner ? "Edit Toner" : "Add Toner"}</Text>
            <Pressable onPress={() => setShowTonerModal(false)}>
              <Ionicons name="close" size={24} color={theme.mutedText} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {/* Model */}
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Model *</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="e.g. HP 26A"
              placeholderTextColor={theme.mutedText}
              value={tonerForm.model}
              onChangeText={(v) => setTonerForm((p) => ({ ...p, model: v }))}
            />

            {/* Part Number */}
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Part Number</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="e.g. CF226A"
              placeholderTextColor={theme.mutedText}
              value={tonerForm.partNumber}
              onChangeText={(v) => setTonerForm((p) => ({ ...p, partNumber: v }))}
            />

            {/* Color selector */}
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Color</Text>
            <View style={styles.colorRow}>
              {TONER_COLORS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setTonerForm((p) => ({ ...p, color: c }))}
                  style={[
                    styles.colorChip,
                    { borderColor: tonerForm.color === c ? "#007AFF" : theme.border, backgroundColor: tonerForm.color === c ? theme.card : "transparent" },
                  ]}
                >
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tonerColorDot(c), marginRight: 4 }} />
                  <Text style={[styles.chipTextSmall, { color: tonerForm.color === c ? theme.text : theme.mutedText }]}>{c}</Text>
                </Pressable>
              ))}
            </View>

            {/* Quantity + Min */}
            <View style={styles.rowFields}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Quantity</Text>
                <TextInput
                  style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                  placeholder="0"
                  placeholderTextColor={theme.mutedText}
                  keyboardType="numeric"
                  value={tonerForm.quantity}
                  onChangeText={(v) => setTonerForm((p) => ({ ...p, quantity: v }))}
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Min Stock</Text>
                <TextInput
                  style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                  placeholder="0"
                  placeholderTextColor={theme.mutedText}
                  keyboardType="numeric"
                  value={tonerForm.minQuantity}
                  onChangeText={(v) => setTonerForm((p) => ({ ...p, minQuantity: v }))}
                />
              </View>
            </View>

            {/* Printer dropdown */}
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Printer</Text>
            <Pressable
              style={[styles.fieldInput, { borderColor: theme.border, backgroundColor: theme.card, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
              onPress={() => setShowPrinterDropdown((p) => !p)}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: tonerForm.printer ? theme.text : theme.mutedText, fontSize: 14 }}>
                  {tonerForm.printer || "Select a printer…"}
                </Text>
                {tonerForm.printer ? (
                  <Text style={{ color: theme.mutedText, fontSize: 11, marginTop: 2 }}>
                    {printers.find((p) => p.name === tonerForm.printer)?.location || ""}
                  </Text>
                ) : null}
              </View>
              <Ionicons name={showPrinterDropdown ? "chevron-up" : "chevron-down"} size={16} color={theme.mutedText} />
            </Pressable>

            {showPrinterDropdown && (
              <View style={[styles.dropdown, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Pressable
                  style={[styles.dropdownItem, { borderBottomColor: theme.border }]}
                  onPress={() => { setTonerForm((p) => ({ ...p, printer: "" })); setShowPrinterDropdown(false); }}
                >
                  <Text style={{ color: theme.mutedText, fontSize: 14 }}>— None —</Text>
                </Pressable>
                {printers.length === 0 ? (
                  <View style={{ padding: 12 }}>
                    <Text style={{ color: theme.mutedText, fontSize: 13 }}>
                      No printers found. Import a CSV in the Printers tab first.
                    </Text>
                  </View>
                ) : (
                  printers.map((p) => (
                    <Pressable
                      key={p.id}
                      style={[styles.dropdownItem, { borderBottomColor: theme.border, backgroundColor: tonerForm.printer === p.name ? "rgba(0,122,255,0.1)" : "transparent" }]}
                      onPress={() => { setTonerForm((f) => ({ ...f, printer: p.name })); setShowPrinterDropdown(false); }}
                    >
                      <Text style={{ color: theme.text, fontSize: 14, fontWeight: tonerForm.printer === p.name ? "700" : "400" }}>{p.name}</Text>
                      {p.location ? <Text style={{ color: theme.mutedText, fontSize: 11 }}>{p.location}</Text> : null}
                    </Pressable>
                  ))
                )}
              </View>
            )}

            {/* Supplier */}
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Supplier</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="e.g. Staples, Amazon"
              placeholderTextColor={theme.mutedText}
              value={tonerForm.supplier}
              onChangeText={(v) => setTonerForm((p) => ({ ...p, supplier: v }))}
            />

            {/* Notes */}
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Notes</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, minHeight: 80, textAlignVertical: "top" }]}
              placeholder="Any additional notes…"
              placeholderTextColor={theme.mutedText}
              multiline
              value={tonerForm.notes}
              onChangeText={(v) => setTonerForm((p) => ({ ...p, notes: v }))}
            />

            {/* Save button */}
            <Pressable
              style={[styles.saveBtn, { backgroundColor: '#007AFF' }, savingToner && { opacity: 0.6 }]}
              onPress={saveToner}
              disabled={savingToner}
            >
              {savingToner ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>{editingToner ? "Save Changes" : "Add Toner"}</Text>}
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 16, paddingHorizontal: 16 },
  screenTitle: { fontSize: 26, fontWeight: "800", marginTop: 8, marginBottom: 12 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },

  subTabRow: { flexDirection: "row", borderBottomWidth: 1, marginBottom: 14 },
  subTab: { flex: 1, alignItems: "center", paddingVertical: 10 },
  subTabText: { fontSize: 15, fontWeight: "700" },

  tonerSubTabRow: { flexDirection: "row", borderBottomWidth: 1, marginBottom: 14 },
  tonerSubTab: { flex: 1, alignItems: "center", paddingVertical: 8 },
  tonerSubTabText: { fontSize: 13, fontWeight: "600" },

  searchInput: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, fontSize: 14, marginBottom: 10 },
  filterRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  chipSmall: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: "600" },
  chipTextSmall: { fontSize: 12, fontWeight: "600" },
  sortGroup: { flexDirection: "row", gap: 6 },

  alertBox: { borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1 },
  alertTitle: { fontWeight: "800" },
  alertText: { fontSize: 13, marginTop: 4 },

  card: { borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 10, flexDirection: "row", alignItems: "center", borderWidth: 1 },
  itemName: { fontSize: 16, fontWeight: "800" },
  rightControls: { flexDirection: "row", gap: 12, alignItems: "center", marginLeft: 12 },

  undoBar: {
    position: "absolute", left: 16, right: 16, bottom: 16, borderRadius: 14, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },

  tonerHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 0 },
  addTonerBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },

  importBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingVertical: 12, marginBottom: 8 },
  importBtnText: { color: "#007AFF", fontSize: 14, fontWeight: "700" },

  colorRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  colorChip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },

  rowFields: { flexDirection: "row", marginBottom: 0 },

  dropdown: { borderWidth: 1, borderRadius: 10, marginTop: 4, marginBottom: 8, overflow: "hidden" },
  dropdownItem: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1 },

  modalContainer: { flex: 1, padding: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: "800" },
  fieldLabel: { fontSize: 13, fontWeight: "600", marginBottom: 6, marginTop: 14 },
  fieldInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },

  saveBtn: { marginTop: 24, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  saveBtnText: { color: "#ffffff", fontSize: 16, fontWeight: "800" },
});