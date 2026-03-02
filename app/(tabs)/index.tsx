// app/(tabs)/index.tsx
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
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
  assetNumber?: string;
  serial?: string;
  siteId: string;
};

type SortMode = "name" | "stock";
type TabMode = "inventory" | "toners";
type TonerSubTab = "toners" | "printers";

const TONER_COLORS = ["Black", "Cyan", "Magenta", "Yellow", "Other"];

export default function IndexScreen() {
  const theme = useAppTheme();
  const router = useRouter();
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

  // --- Printer state ---
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [printersLoading, setPrintersLoading] = useState(true);
  const [importingPrinters, setImportingPrinters] = useState(false);

  // ─── Undo helpers ────────────────────────────────────────────────
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
    if (!siteId) return;
    const q = query(collection(db, "items"), where("siteId", "==", siteId));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Item));
      setItems(list);
      setLoading(false);
    });
    return () => unsub();
  }, [siteId]);

  // ─── Toner listener ──────────────────────────────────────────────
  useEffect(() => {
    if (!siteId) return;
    const q = query(collection(db, "toners"), where("siteId", "==", siteId));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Toner));
      setToners(list);
      setTonersLoading(false);
    });
    return () => unsub();
  }, [siteId]);

  // ─── Printer listener ────────────────────────────────────────────
  useEffect(() => {
    if (!siteId) return;
    const q = query(collection(db, "printers"), where("siteId", "==", siteId));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Printer));
      setPrinters(list);
      setPrintersLoading(false);
    });
    return () => unsub();
  }, [siteId]);

  // ─── CSV Import ──────────────────────────────────────────────────
  const normalizeCell = (v?: string): string => {
    if (!v) return "";
    const t = v.trim();
    if (t.toLowerCase() === "nan" || t === "-" || t === "") return "";
    return t;
  };

  const parseCSV = (text: string): string[][] => {
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) return [];

    const firstLine = lines[0];
    const delimiter = firstLine.includes("|")
      ? "|"
      : firstLine.includes(";")
      ? ";"
      : ",";

    return lines.map((line) =>
      line
        .split(delimiter)
        .map((cell) => cell.trim().replace(/^"|"$/g, "").replace(/""/g, '"'))
    );
  };

  const importPrintersFromCSV = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: "text/csv" });
      if (res.canceled) return;

      setImportingPrinters(true);
      const fileUri = res.assets[0].uri;
      const content = await FileSystem.readAsStringAsync(fileUri);
      const rows = parseCSV(content);

      if (rows.length < 2) {
        Alert.alert("Error", "CSV file is empty or invalid.");
        setImportingPrinters(false);
        return;
      }

      const headers = rows[0].map((h) => h.toLowerCase().trim());
      const nameIdx = headers.indexOf("model");
      const locationIdx = headers.indexOf("description");
      const ipIdx = headers.indexOf("ip");
      const assetIdx = headers.indexOf("asset number");
      const serialIdx = headers.indexOf("serial");
      const hostIdx = headers.indexOf("host name");

      if (nameIdx === -1) {
        Alert.alert("Error", 'CSV must have a "Model" column.');
        setImportingPrinters(false);
        return;
      }

      const dataRows = rows.slice(1);

      const cleanedRows = dataRows.filter((row) => {
        const firstCell = (row[0] || "").toLowerCase().trim();
        const nameCell = (row[nameIdx] || "").toLowerCase().trim();
        if (firstCell === "room #" || firstCell === "room#") return false;
        if (nameCell === "model" || nameCell === "name") return false;
        if (firstCell.startsWith(":---") || firstCell.startsWith("---")) return false;
        return true;
      });

      const validRows = cleanedRows.filter((row) => normalizeCell(row[nameIdx]));

      const batchSize = 100;
      for (let i = 0; i < validRows.length; i += batchSize) {
        const chunk = validRows.slice(i, i + batchSize);
        const batch = writeBatch(db);

        chunk.forEach((row, chunkIndex) => {
          const rawIp = normalizeCell(ipIdx >= 0 ? row[ipIdx] : "");
          const safeIp = rawIp.replace(/[^a-z0-9]/g, "_");
          const safeLocation = normalizeCell(locationIdx >= 0 ? row[locationIdx] : "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "_");

          const assetNum = normalizeCell(assetIdx >= 0 ? row[assetIdx] : "");
          const serial = normalizeCell(serialIdx >= 0 ? row[serialIdx] : "");
          const host = normalizeCell(hostIdx >= 0 ? row[hostIdx] : "");
          const safeAsset = assetNum.toLowerCase().replace(/[^a-z0-9]/g, "_");
          const safeSerial = serial.toLowerCase().replace(/[^a-z0-9]/g, "_");
          const safeHost = host.toLowerCase().replace(/[^a-z0-9]/g, "_");

          const stableKey =
            safeAsset || safeSerial || safeHost || safeIp || safeLocation || String(i + chunkIndex);
          const docId = `${siteId}__${stableKey}`;

          const ref = doc(db, "printers", docId);
          batch.set(
            ref,
            {
              name: normalizeCell(row[nameIdx]),
              location: normalizeCell(locationIdx >= 0 ? row[locationIdx] : ""),
              ipAddress: rawIp,
              assetNumber: assetNum,
              serial: serial,
              siteId,
            },
            { merge: true }
          );
        });

        await batch.commit();
      }

      Alert.alert("Success", `${validRows.length} printer(s) imported. Existing printers were updated.`);
    } catch (err) {
      console.error("Import failed:", err);
      Alert.alert("Error", "Failed to import printers.");
    } finally {
      setImportingPrinters(false);
    }
  };

  // ─── Toner Form ──────────────────────────────────────────────────
  const openTonerModal = (toner?: Toner) => {
    if (toner) {
      setEditingToner(toner);
      setTonerForm({
        model: toner.model,
        partNumber: toner.partNumber || "",
        color: toner.color,
        quantity: String(toner.quantity),
        minQuantity: String(toner.minQuantity),
        printer: toner.printer || "",
        supplier: toner.supplier || "",
        notes: toner.notes || "",
      });
    } else {
      setEditingToner(null);
      setTonerForm({
        model: "",
        partNumber: "",
        color: "Black",
        quantity: "",
        minQuantity: "",
        printer: "",
        supplier: "",
        notes: "",
      });
    }
    setShowTonerModal(true);
  };

  const saveToner = async () => {
    if (!tonerForm.model.trim() || !tonerForm.quantity.trim()) {
      Alert.alert("Error", "Model and Quantity are required.");
      return;
    }
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
    } catch (e) {
      Alert.alert("Error", "Failed to save toner.");
    } finally {
      setSavingToner(false);
    }
  };

  // ─── Filtering & Sorting ─────────────────────────────────────────
  const filteredItems = useMemo(() => {
    let list = items.filter((i) => !hiddenIds.has(i.id));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.location?.toLowerCase().includes(q)
      );
    }
    if (showLowOnly) {
      list = list.filter((i) => i.currentQuantity <= i.minQuantity);
    }
    return list.sort((a, b) => {
      if (sortMode === "stock") return a.currentQuantity - b.currentQuantity;
      return a.name.localeCompare(b.name);
    });
  }, [items, searchQuery, showLowOnly, sortMode, hiddenIds]);

  const filteredToners = useMemo(() => {
    let list = [...toners];
    if (tonerSearch) {
      const q = tonerSearch.toLowerCase();
      list = list.filter(
        (t) =>
          t.model.toLowerCase().includes(q) ||
          t.printer?.toLowerCase().includes(q)
      );
    }
    if (showTonerLowOnly) {
      list = list.filter((t) => t.quantity <= t.minQuantity);
    }
    return list.sort((a, b) => a.model.localeCompare(b.model));
  }, [toners, tonerSearch, showTonerLowOnly]);

  // ─── Render Helpers ──────────────────────────────────────────────
  const renderItem = ({ item }: { item: Item }) => (
    <Pressable onPress={() => router.push({ pathname: "/item/[id]", params: { id: item.id } })}>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.itemName, { color: theme.text }]}>{item.name}</Text>
          <Text style={{ color: theme.mutedText, fontSize: 12 }}>{item.location || "No location"}</Text>
        </View>
        <View style={styles.rightControls}>
          <View style={{ alignItems: "flex-end" }}>
            <Text
              style={{
                color: item.currentQuantity <= item.minQuantity ? "#ef4444" : theme.text,
                fontWeight: "800",
                fontSize: 18,
              }}
            >
              {item.currentQuantity}
            </Text>
            <Text style={{ color: theme.mutedText, fontSize: 10 }}>STOCK</Text>
          </View>
          <Pressable onPress={() => scheduleDelete(item)} style={{ padding: 4 }}>
            <Ionicons name="trash-outline" size={20} color="#ef4444" />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );

  const renderToner = ({ item }: { item: Toner }) => (
    <Pressable onPress={() => openTonerModal(item)}>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.itemName, { color: theme.text }]}>{item.model}</Text>
          <Text style={{ color: theme.mutedText, fontSize: 12 }}>{item.printer || "Universal"}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text
            style={{
              color: item.quantity <= item.minQuantity ? "#ef4444" : theme.text,
              fontWeight: "800",
              fontSize: 18,
            }}
          >
            {item.quantity}
          </Text>
          <Text style={{ color: theme.mutedText, fontSize: 10 }}>{item.color.toUpperCase()}</Text>
        </View>
      </View>
    </Pressable>
  );

  const renderPrinter = ({ item }: { item: Printer }) => (
    <Pressable onPress={() => router.push({ pathname: "/printers/[id]" as any, params: { id: item.id } })}>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.itemName, { color: theme.text }]}>{item.name}</Text>
          <Text style={{ color: theme.mutedText, fontSize: 12 }}>{item.location || "No location"}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: theme.tint, fontWeight: "700", fontSize: 13 }}>
            {item.ipAddress || "No IP"}
          </Text>
          <Text style={{ color: theme.mutedText, fontSize: 10 }}>PRINTER</Text>
        </View>
      </View>
    </Pressable>
  );

  if (profileLoading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <StatusBar style="light" />
      <Text style={[styles.screenTitle, { color: theme.text }]}>Control Deck</Text>

      {/* Main Tabs */}
      <View style={[styles.subTabRow, { borderBottomColor: theme.border }]}>
        <Pressable
          style={[styles.subTab, activeTab === "inventory" && { borderBottomWidth: 3, borderBottomColor: theme.tint }]}
          onPress={() => setActiveTab("inventory")}
        >
          <Text style={[styles.subTabText, { color: activeTab === "inventory" ? theme.tint : theme.mutedText }]}>
            Inventory
          </Text>
        </Pressable>
        <Pressable
          style={[styles.subTab, activeTab === "toners" && { borderBottomWidth: 3, borderBottomColor: theme.tint }]}
          onPress={() => setActiveTab("toners")}
        >
          <Text style={[styles.subTabText, { color: activeTab === "toners" ? theme.tint : theme.mutedText }]}>
            Toners & Printers
          </Text>
        </Pressable>
      </View>

      {activeTab === "inventory" ? (
        <>
          <TextInput
            style={[styles.searchInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
            placeholder="Search inventory…"
            placeholderTextColor={theme.mutedText}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <View style={styles.filterRow}>
            <Pressable
              style={[styles.chip, { borderColor: theme.border }, showLowOnly && { backgroundColor: "rgba(239,68,68,0.2)", borderColor: "#ef4444" }]}
              onPress={() => setShowLowOnly(!showLowOnly)}
            >
              <Text style={[styles.chipText, { color: showLowOnly ? "#ef4444" : theme.text }]}>Low Stock</Text>
            </Pressable>
            <View style={styles.sortGroup}>
              <Pressable
                style={[styles.chipSmall, { borderColor: theme.border }, sortMode === "name" && { backgroundColor: theme.tint }]}
                onPress={() => setSortMode("name")}
              >
                <Text style={[styles.chipTextSmall, { color: sortMode === "name" ? "#000" : theme.text }]}>A-Z</Text>
              </Pressable>
              <Pressable
                style={[styles.chipSmall, { borderColor: theme.border }, sortMode === "stock" && { backgroundColor: theme.tint }]}
                onPress={() => setSortMode("stock")}
              >
                <Text style={[styles.chipTextSmall, { color: sortMode === "stock" ? "#000" : theme.text }]}>Stock</Text>
              </Pressable>
            </View>
          </View>
          <FlatList
            data={filteredItems}
            keyExtractor={(i) => i.id}
            renderItem={renderItem}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.tint} />}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={{ color: theme.mutedText }}>No items found.</Text>
              </View>
            }
          />
        </>
      ) : (
        <>
          <View style={[styles.tonerSubTabRow, { borderBottomColor: theme.border }]}>
            <Pressable
              style={[styles.tonerSubTab, tonerSubTab === "toners" && { borderBottomWidth: 2, borderBottomColor: theme.tint }]}
              onPress={() => setTonerSubTab("toners")}
            >
              <Text style={[styles.tonerSubTabText, { color: tonerSubTab === "toners" ? theme.tint : theme.mutedText }]}>
                Toner Inventory
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tonerSubTab, tonerSubTab === "printers" && { borderBottomWidth: 2, borderBottomColor: theme.tint }]}
              onPress={() => setTonerSubTab("printers")}
            >
              <Text style={[styles.tonerSubTabText, { color: tonerSubTab === "printers" ? theme.tint : theme.mutedText }]}>
                Printers ({printers.length})
              </Text>
            </Pressable>
          </View>

          {tonerSubTab === "toners" ? (
            <>
              <View style={styles.tonerHeaderRow}>
                <TextInput
                  style={[styles.searchInput, { flex: 1, borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                  placeholder="Search toners…"
                  placeholderTextColor={theme.mutedText}
                  value={tonerSearch}
                  onChangeText={setTonerSearch}
                />
                <Pressable style={[styles.addTonerBtn, { backgroundColor: theme.tint }]} onPress={() => openTonerModal()}>
                  <Ionicons name="add" size={24} color="#000" />
                </Pressable>
              </View>
              <FlatList
                data={filteredToners}
                keyExtractor={(t) => t.id}
                renderItem={renderToner}
                ListEmptyComponent={
                  <View style={styles.center}>
                    <Text style={{ color: theme.mutedText }}>No toners found.</Text>
                  </View>
                }
              />
            </>
          ) : (
            <>
              <Pressable
                style={[styles.importBtn, { borderColor: theme.tint }]}
                onPress={importPrintersFromCSV}
                disabled={importingPrinters}
              >
                {importingPrinters ? (
                  <ActivityIndicator size="small" color={theme.tint} />
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={20} color={theme.tint} />
                    <Text style={styles.importBtnText}>Import Printers CSV</Text>
                  </>
                )}
              </Pressable>
              <FlatList
                data={printers}
                keyExtractor={(p) => p.id}
                renderItem={renderPrinter}
                ListEmptyComponent={
                  <View style={styles.center}>
                    <Text style={{ color: theme.mutedText }}>No printers imported yet.</Text>
                  </View>
                }
              />
            </>
          )}
        </>
      )}

      {/* Undo Bar */}
      <Animated.View
        style={[
          styles.undoBar,
          {
            backgroundColor: theme.card,
            borderColor: theme.tint,
            transform: [{ translateY: undoAnim.interpolate({ inputRange: [0, 1], outputRange: [100, 0] }) }],
          },
        ]}
      >
        <Text style={{ color: theme.text, fontWeight: "700" }}>Item deleted</Text>
        <Pressable
          onPress={undoDelete}
          style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: theme.tint, borderRadius: 8 }}
        >
          <Text style={{ color: "#000", fontWeight: "800" }}>UNDO</Text>
        </Pressable>
      </Animated.View>

      {/* Toner Modal */}
      <Modal visible={showTonerModal} animationType="slide" transparent={false}>
        <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>
              {editingToner ? "Edit Toner" : "Add New Toner"}
            </Text>
            <Pressable onPress={() => setShowTonerModal(false)}>
              <Ionicons name="close" size={28} color={theme.text} />
            </Pressable>
          </View>
          <ScrollView>
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Model / Name</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="e.g. HP 58X Black"
              placeholderTextColor={theme.mutedText}
              value={tonerForm.model}
              onChangeText={(v) => setTonerForm((p) => ({ ...p, model: v }))}
            />

            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Color</Text>
            <View style={styles.colorRow}>
              {TONER_COLORS.map((c) => (
                <Pressable
                  key={c}
                  style={[
                    styles.colorChip,
                    { borderColor: theme.border },
                    tonerForm.color === c && { backgroundColor: theme.tint, borderColor: theme.tint },
                  ]}
                  onPress={() => setTonerForm((p) => ({ ...p, color: c }))}
                >
                  <Text style={{ color: tonerForm.color === c ? "#000" : theme.text, fontWeight: "700" }}>{c}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.rowFields}>
              <View style={{ flex: 1, marginRight: 10 }}>
                <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Quantity</Text>
                <TextInput
                  style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                  keyboardType="numeric"
                  value={tonerForm.quantity}
                  onChangeText={(v) => setTonerForm((p) => ({ ...p, quantity: v }))}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Min Qty</Text>
                <TextInput
                  style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                  keyboardType="numeric"
                  value={tonerForm.minQuantity}
                  onChangeText={(v) => setTonerForm((p) => ({ ...p, minQuantity: v }))}
                />
              </View>
            </View>

            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Compatible Printer Model</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="e.g. LaserJet M402dne"
              placeholderTextColor={theme.mutedText}
              value={tonerForm.printer}
              onChangeText={(v) => setTonerForm((p) => ({ ...p, printer: v }))}
            />

            <Pressable
              style={[styles.saveBtn, { backgroundColor: "#007AFF" }, savingToner && { opacity: 0.6 }]}
              onPress={saveToner}
              disabled={savingToner}
            >
              {savingToner ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.saveBtnText}>{editingToner ? "Save Changes" : "Add Toner"}</Text>
              )}
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
  card: { borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 10, flexDirection: "row", alignItems: "center", borderWidth: 1 },
  itemName: { fontSize: 16, fontWeight: "800" },
  rightControls: { flexDirection: "row", gap: 12, alignItems: "center", marginLeft: 12 },
  undoBar: { position: "absolute", left: 16, right: 16, bottom: 16, borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tonerHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 0 },
  addTonerBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  importBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingVertical: 12, marginBottom: 8 },
  importBtnText: { color: "#007AFF", fontSize: 14, fontWeight: "700" },
  colorRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  colorChip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  rowFields: { flexDirection: "row", marginBottom: 0 },
  modalContainer: { flex: 1, padding: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: "800" },
  fieldLabel: { fontSize: 13, fontWeight: "600", marginBottom: 6, marginTop: 14 },
  fieldInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  saveBtn: { marginTop: 24, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  saveBtnText: { color: "#ffffff", fontSize: 16, fontWeight: "800" },
});