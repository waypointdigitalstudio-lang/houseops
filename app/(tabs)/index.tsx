import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import inventoryStyles from "../../constants/inventoryStyles";
import { useAppTheme } from "../../constants/theme";
import { db } from "../../firebaseConfig";
import { useUserProfile } from "../../hooks/useUserProfile";
import { Item, Radio, SortMode, TabMode, UNDO_ANIMATION_MS, UNDO_TIMEOUT_MS } from "../../types/inventory";
import { getStockStatus, logActivity } from "../../utils/activity";
import { downloadDisposalTemplate, downloadInventoryTemplate, normalizeCell, parseCSV } from "../../utils/csvHelpers";
import RadioSection, { RadioSectionRef } from "../../components/RadioSection";
import TonerSection, { TonerSectionRef } from "../../components/TonerSection";

export default function IndexScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const { uid, profile, siteId, loading: profileLoading } = useUserProfile();
  const { addTonerBarcode } = useLocalSearchParams<{ addTonerBarcode?: string }>();

  // Tab state
  const [activeTab, setActiveTab] = useState<TabMode>("inventory");

  // Toner count — lifted up from TonerSection for the summary card
  const [visibleTonerCount, setVisibleTonerCount] = useState(0);

  // Refs for scanner → section prefill
  const radioSectionRef = useRef<RadioSectionRef>(null);
  const tonerSectionRef = useRef<TonerSectionRef>(null);

  // --- Inventory state ---
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("name");

  // --- Scanner state ---
  const [showScanModal, setShowScanModal] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanningEnabled, setScanningEnabled] = useState(true);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const lastScanRef = useRef<{ data: string; at: number } | null>(null);

  // --- Inventory add modal state ---
  const [showInventoryModal, setShowInventoryModal] = useState(false);
  const [itemForm, setItemForm] = useState({ name: "", currentQuantity: "", minQuantity: "", location: "", barcode: "", notes: "" });

  // --- Disposal modal state ---
  const [showDisposeModal, setShowDisposeModal] = useState(false);
  const [disposingItem, setDisposingItem] = useState<Item | null>(null);
  const [disposeSaving, setDisposeSaving] = useState(false);
  const [disposeForm, setDisposeForm] = useState({ itemName: "", model: "", amount: "", vendor: "", approxAmount: "", multipleAmount: "", approxAge: "", description: "", disposedBy: "" });

  // --- Inventory undo state ---
  const [pendingDelete, setPendingDelete] = useState<{ item: Item; backup: any } | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const undoAnim = useRef(new Animated.Value(0)).current;
  const undoTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // --- Import state ---
  const [importingInventory, setImportingInventory] = useState(false);

  // Mounted tracking + cleanup
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (undoTimeoutRef.current) { clearTimeout(undoTimeoutRef.current); undoTimeoutRef.current = null; }
    };
  }, []);

  // Route param: deep-link to add toner with prefilled barcode
  useEffect(() => {
    const bc = String(addTonerBarcode ?? "").trim();
    if (!bc) return;
    setActiveTab("toners");
    // Use a short delay to let TonerSection mount before calling the ref
    const t = setTimeout(() => { tonerSectionRef.current?.openAddToner(bc); }, 300);
    return () => clearTimeout(t);
  }, [addTonerBarcode]);

  // Inventory Firestore listener
  useEffect(() => {
    if (!siteId) return;
    const q = query(collection(db, "items"), where("siteId", "==", siteId));
    const unsub = onSnapshot(q, (snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Item)));
      setLoading(false);
    }, (err) => { if (__DEV__) console.error("items onSnapshot error:", err); setLoading(false); });
    return () => unsub();
  }, [siteId]);

  // Inventory undo
  // itemId: only clear pendingDelete if this specific item is still pending,
  // preventing a stale timeout from wiping a newer delete's undo state.
  const dismissUndoBanner = useCallback((itemId?: string) => {
    if (undoTimeoutRef.current) { clearTimeout(undoTimeoutRef.current); undoTimeoutRef.current = null; }
    Animated.timing(undoAnim, { toValue: 0, duration: UNDO_ANIMATION_MS, useNativeDriver: true }).start(() => {
      if (isMountedRef.current) {
        setPendingDelete((prev) => (itemId && prev?.item.id !== itemId ? prev : null));
      }
    });
  }, [undoAnim]);

  const scheduleDelete = useCallback(async (item: Item) => {
    if (pendingDelete) {
      if (undoTimeoutRef.current) { clearTimeout(undoTimeoutRef.current); undoTimeoutRef.current = null; }
      try {
        await deleteDoc(doc(db, "items", pendingDelete.item.id));
        if (siteId) {
          const prevStatus = getStockStatus(pendingDelete.item.currentQuantity, pendingDelete.item.minQuantity);
          await logActivity({ siteId, itemName: pendingDelete.item.name, itemId: pendingDelete.item.id, qty: 0, min: pendingDelete.item.minQuantity, prevState: prevStatus, nextState: "OUT", action: "deleted", itemType: "inventory" });
        }
      } catch (e) { if (__DEV__) console.error("Error committing previous delete:", e); }
      setHiddenIds((prev) => { const next = new Set(prev); next.delete(pendingDelete.item.id); return next; });
      undoAnim.setValue(0);
      setPendingDelete(null);
    }
    const backup = { ...item };
    delete (backup as any).id;
    setHiddenIds((prev) => new Set(prev).add(item.id));
    setPendingDelete({ item, backup });
    Animated.timing(undoAnim, { toValue: 1, duration: UNDO_ANIMATION_MS, useNativeDriver: true }).start();
    undoTimeoutRef.current = setTimeout(async () => {
      if (!isMountedRef.current) return;
      try {
        await deleteDoc(doc(db, "items", item.id));
        if (siteId) {
          const prevStatus = getStockStatus(item.currentQuantity, item.minQuantity);
          await logActivity({ siteId, itemName: item.name, itemId: item.id, qty: 0, min: item.minQuantity, prevState: prevStatus, nextState: "OUT", action: "deleted", itemType: "inventory" });
        }
      } catch (e) {
        if (__DEV__) console.error("Error during scheduled delete:", e);
        if (isMountedRef.current) setHiddenIds((prev) => { const next = new Set(prev); next.delete(item.id); return next; });
      }
      if (isMountedRef.current) dismissUndoBanner(item.id);
    }, UNDO_TIMEOUT_MS);
  }, [pendingDelete, undoAnim, dismissUndoBanner, siteId]);

  const undoDelete = useCallback(async () => {
    if (!pendingDelete) return;
    if (undoTimeoutRef.current) { clearTimeout(undoTimeoutRef.current); undoTimeoutRef.current = null; }
    const { item, backup } = pendingDelete;
    setHiddenIds((prev) => { const next = new Set(prev); next.delete(item.id); return next; });
    try { await setDoc(doc(db, "items", item.id), backup, { merge: true }); } catch (e) { if (__DEV__) console.error("Error restoring item:", e); }
    dismissUndoBanner(item.id);
  }, [pendingDelete, dismissUndoBanner]);

  // Inventory CRUD
  const openInventoryModal = useCallback(() => {
    setItemForm({ name: "", currentQuantity: "", minQuantity: "", location: "", barcode: "", notes: "" });
    setShowInventoryModal(true);
  }, []);

  const saveItem = useCallback(async () => {
    if (!itemForm.name.trim()) { Alert.alert("Error", "Item name is required."); return; }
    if (!itemForm.currentQuantity.trim()) { Alert.alert("Error", "Quantity is required."); return; }
    if (!siteId) { Alert.alert("Error", "No site assigned to your account."); return; }
    const newQty = parseInt(itemForm.currentQuantity) || 0;
    const newMin = parseInt(itemForm.minQuantity) || 0;
    const data = { name: itemForm.name.trim(), currentQuantity: newQty, minQuantity: newMin, location: itemForm.location.trim(), barcode: itemForm.barcode.trim(), notes: itemForm.notes.trim(), siteId };
    try {
      const docRef = await addDoc(collection(db, "items"), data);
      await logActivity({ siteId, itemName: data.name, itemId: docRef.id, qty: newQty, min: newMin, prevState: "OK", nextState: getStockStatus(newQty, newMin), action: "added", itemType: "inventory" });
      setShowInventoryModal(false);
    } catch { Alert.alert("Error", "Failed to save inventory item."); }
  }, [itemForm, siteId]);

  const openDisposeModal = useCallback((item: Item) => {
    setDisposingItem(item);
    setDisposeForm({ itemName: item.name || "", model: "", amount: "", vendor: "", approxAmount: "", multipleAmount: "", approxAge: "", description: item.notes || "", disposedBy: "" });
    setShowDisposeModal(true);
  }, []);

  const confirmDispose = useCallback(async () => {
    if (!disposingItem) return;
    if (!disposeForm.itemName.trim()) { Alert.alert("Error", "Item name is required."); return; }
    if (!disposeForm.disposedBy.trim()) { Alert.alert("Error", "Please enter who is disposing this item."); return; }
    if (!siteId) { Alert.alert("Error", "No site assigned to your account."); return; }
    setDisposeSaving(true);
    try {
      const disposedQty = parseInt(disposeForm.amount) || 1;
      const newQty = Math.max(0, disposingItem.currentQuantity - disposedQty);
      await addDoc(collection(db, "disposals"), {
        itemId: disposingItem.id, itemName: disposeForm.itemName.trim(), model: disposeForm.model.trim(),
        quantity: disposedQty, vendor: disposeForm.vendor.trim(), approxValue: disposeForm.approxAmount.trim(),
        totalValue: disposeForm.multipleAmount.trim(), approxAge: disposeForm.approxAge.trim(),
        notes: disposeForm.description.trim(), disposedBy: disposeForm.disposedBy.trim(),
        disposedByUid: uid || "", siteId, reason: "other" as const,
        disposedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "items", disposingItem.id), { currentQuantity: newQty });
      await logActivity({ siteId, itemName: disposeForm.itemName.trim(), itemId: disposingItem.id, qty: newQty, min: disposingItem.minQuantity, prevState: getStockStatus(disposingItem.currentQuantity, disposingItem.minQuantity), nextState: getStockStatus(newQty, disposingItem.minQuantity), action: "disposed", itemType: "inventory" });
      setShowDisposeModal(false);
      setDisposingItem(null);
      setDisposeSaving(false);
    } catch { Alert.alert("Error", "Failed to dispose item. Please try again."); setDisposeSaving(false); }
  }, [disposingItem, disposeForm, uid, siteId]);

  // Scanner
  const openScanModal = useCallback(async () => {
    if (!cameraPermission?.granted) {
      const res = await requestCameraPermission();
      if (!res.granted) { Alert.alert("Camera permission needed", "Enable camera access to use the scanner."); return; }
    }
    lastScanRef.current = null;
    setScanBusy(false);
    setScanningEnabled(true);
    setShowScanModal(true);
  }, [cameraPermission, requestCameraPermission]);

  const handleBarcodeScanned = useCallback(async ({ data }: { data: string }) => {
    if (!scanningEnabled || scanBusy) return;
    const now = Date.now();
    const last = lastScanRef.current;
    if (last && last.data === data && now - last.at < 1500) return;
    lastScanRef.current = { data, at: now };
    setScanBusy(true);
    setScanningEnabled(false);
    try {
      const clean = String(data).trim();

      if (!siteId) { Alert.alert("Error", "No site assigned to your account."); setScanBusy(false); setScanningEnabled(true); return; }

      const itemSnap = await getDocs(query(collection(db, "items"), where("barcode", "==", clean), where("siteId", "==", siteId)));
      if (!itemSnap.empty) { setShowScanModal(false); router.push({ pathname: "/item/[id]", params: { id: itemSnap.docs[0].id } }); return; }

      const tonerSnap = await getDocs(query(collection(db, "toners"), where("barcode", "==", clean), where("siteId", "==", siteId)));
      if (!tonerSnap.empty) { setShowScanModal(false); router.push({ pathname: "/toners/[id]" as any, params: { id: tonerSnap.docs[0].id } }); return; }

      const radioSnap = await getDocs(query(collection(db, "radios"), where("barcode", "==", clean), where("siteId", "==", siteId)));
      if (!radioSnap.empty) {
        setShowScanModal(false);
        setActiveTab("radios");
        radioSectionRef.current?.openRadioModal({ id: radioSnap.docs[0].id, ...radioSnap.docs[0].data() } as Radio);
        return;
      }

      const radioPartSnap = await getDocs(query(collection(db, "radioParts"), where("barcode", "==", clean), where("siteId", "==", siteId)));
      if (!radioPartSnap.empty) { setShowScanModal(false); router.push(`/radiopart/${radioPartSnap.docs[0].id}` as any); return; }

      Alert.alert(
        "Barcode not found",
        `Where would you like to add "${clean}"?`,
        [
          { text: "Inventory", onPress: () => { setShowScanModal(false); setActiveTab("inventory"); setItemForm({ name: "", currentQuantity: "", minQuantity: "", location: "", barcode: clean, notes: "" }); setShowInventoryModal(true); } },
          { text: "Toner", onPress: () => { setShowScanModal(false); setActiveTab("toners"); setTimeout(() => tonerSectionRef.current?.openAddToner(clean), 150); } },
          { text: "Radio Parts", onPress: () => { setShowScanModal(false); setActiveTab("radios"); setTimeout(() => radioSectionRef.current?.openAddRadioPart(clean), 150); } },
          { text: "Scan Again", onPress: () => { setScanBusy(false); setScanningEnabled(true); } },
          { text: "Cancel", style: "cancel", onPress: () => setShowScanModal(false) },
        ]
      );
    } catch { Alert.alert("Scan failed", "Could not look up that barcode. Try again."); }
    finally { setScanBusy(false); }
  }, [scanningEnabled, scanBusy, router, siteId]);

  // CSV Import — Inventory
  const importInventoryFromCSV = async () => {
    if (!siteId) { Alert.alert("Error", "No site assigned to your account."); return; }
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "text/plain"] });
      if (result.canceled) return;
      setImportingInventory(true);
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const rows = parseCSV(content);
      if (rows.length < 2) { Alert.alert("Empty File", "No data rows found in the CSV."); return; }
      const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, ""));
      const col = (names: string[]) => { for (const n of names) { const idx = headers.findIndex((h) => h.includes(n)); if (idx !== -1) return idx; } return -1; };
      const iName = col(["name", "item", "description"]);
      const iQty = col(["qty", "quantity", "amount", "stock"]);
      const iMinQty = col(["min", "minimum", "minqty", "minstock"]);
      const iLocation = col(["location", "loc", "shelf", "room"]);
      const iBarcode = col(["barcode", "sku", "upc"]);
      const iNotes = col(["notes", "note", "desc"]);
      if (iName === -1) { Alert.alert("Import Failed", "Could not find a 'Name' or 'Item' column."); return; }
      const dataRows = rows.slice(1).filter((row) => normalizeCell(row[iName] ?? "") !== "");
      let count = 0;
      for (let i = 0; i < dataRows.length; i += 499) {
        const chunk = dataRows.slice(i, i + 499);
        const batch = writeBatch(db);
        for (const row of chunk) {
          const name = normalizeCell(row[iName] ?? "");
          if (!name) continue;
          const stableId = `${siteId}_${name}`.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 100);
          batch.set(doc(db, "items", stableId), { name, currentQuantity: parseInt(normalizeCell(row[iQty] ?? "")) || 0, minQuantity: parseInt(normalizeCell(row[iMinQty] ?? "")) || 0, location: normalizeCell(row[iLocation] ?? ""), barcode: normalizeCell(row[iBarcode] ?? ""), notes: normalizeCell(row[iNotes] ?? ""), siteId, importedAt: serverTimestamp() }, { merge: true });
          count++;
        }
        await batch.commit();
      }
      Alert.alert("Import Complete", `${count} inventory item${count !== 1 ? "s" : ""} imported/updated.`);
    } catch (err: any) { Alert.alert("Import Failed", err.message || "An unexpected error occurred."); }
    finally { setImportingInventory(false); }
  };

  // Derived data
  const filteredItems = useMemo(() => {
    let list = items.filter((i) => !hiddenIds.has(i.id));
    if (searchQuery) list = list.filter((i) => i.name.toLowerCase().includes(searchQuery.toLowerCase()));
    if (showLowOnly) list = list.filter((i) => i.currentQuantity <= i.minQuantity);
    return list.sort((a, b) => sortMode === "name" ? a.name.localeCompare(b.name) : a.currentQuantity - b.currentQuantity);
  }, [items, searchQuery, showLowOnly, sortMode, hiddenIds]);

  const summaryStats = useMemo(() => {
    const visible = items.filter((i) => !hiddenIds.has(i.id));
    return {
      totalItems: visible.length,
      outOfStock: visible.filter((i) => i.currentQuantity <= 0).length,
      lowStock: visible.filter((i) => i.currentQuantity > 0 && i.minQuantity > 0 && i.currentQuantity <= i.minQuantity).length,
      totalToners: visibleTonerCount,
    };
  }, [items, hiddenIds, visibleTonerCount]);

  const renderInventoryItem = ({ item }: { item: Item }) => (
    <View style={[inventoryStyles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Pressable onPress={() => router.push(`/item/${item.id}`)} style={{ flex: 1 }}>
        <Text style={[inventoryStyles.itemName, { color: theme.text }]}>{item.name}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
          <Ionicons name="location-outline" size={14} color={theme.mutedText} style={{ marginRight: 4 }} />
          <Text style={{ color: theme.mutedText, fontSize: 12 }}>{item.location || "No location"}</Text>
        </View>
        {item.barcode ? (
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
            <Ionicons name="barcode-outline" size={14} color={theme.mutedText} style={{ marginRight: 4 }} />
            <Text style={{ color: theme.mutedText, fontSize: 11 }}>{item.barcode}</Text>
          </View>
        ) : null}
        {item.notes ? <Text style={{ color: theme.mutedText, fontSize: 11, marginTop: 4, fontStyle: "italic" }} numberOfLines={2}>{item.notes}</Text> : null}
      </Pressable>
      <View style={inventoryStyles.rightControls}>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: item.currentQuantity <= item.minQuantity ? theme.danger : theme.text, fontWeight: "800", fontSize: 18 }}>{item.currentQuantity}</Text>
          <Text style={{ color: theme.mutedText, fontSize: 10 }}>STOCK</Text>
          {item.currentQuantity <= item.minQuantity && <Text style={{ color: theme.danger, fontSize: 10, fontWeight: "700" }}>LOW</Text>}
        </View>
        <Pressable onPress={() => openDisposeModal(item)} hitSlop={8} style={{ padding: 6 }}>
          <Ionicons name="archive-outline" size={20} color={theme.warning} />
        </Pressable>
        <Pressable onPress={() => scheduleDelete(item)} hitSlop={8} style={{ padding: 6 }}>
          <Ionicons name="trash-outline" size={20} color={theme.danger} />
        </Pressable>
      </View>
    </View>
  );

  if (profileLoading || loading) {
    return (
      <View style={[inventoryStyles.container, { backgroundColor: theme.background, justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={theme.tint} />
      </View>
    );
  }

  const inventoryUndoPointerEvents = pendingDelete ? "auto" : "none";

  return (
    <View style={[inventoryStyles.container, { backgroundColor: theme.background }]}>
      <StatusBar style="light" />

      {/* Header + tab bar */}
      <View style={inventoryStyles.header}>
        <Text style={[inventoryStyles.title, { color: theme.text }]}>Nexus</Text>
        <View style={[inventoryStyles.tabBar, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Pressable onPress={() => setActiveTab("inventory")} style={[inventoryStyles.tab, activeTab === "inventory" && { backgroundColor: theme.background, borderColor: theme.border }]}>
            <Text style={[inventoryStyles.tabText, { color: activeTab === "inventory" ? theme.text : theme.mutedText }]}>Inventory</Text>
          </Pressable>
          <Pressable onPress={() => setActiveTab("toners")} style={[inventoryStyles.tab, activeTab === "toners" && { backgroundColor: theme.background, borderColor: theme.border }]}>
            <Text style={[inventoryStyles.tabText, { color: activeTab === "toners" ? theme.text : theme.mutedText }]}>Toners & Printers</Text>
          </Pressable>
          <Pressable onPress={() => setActiveTab("radios")} style={[inventoryStyles.tab, activeTab === "radios" && { backgroundColor: theme.background, borderColor: theme.border }]}>
            <Text style={[inventoryStyles.tabText, { color: activeTab === "radios" ? theme.text : theme.mutedText }]}>Radios</Text>
          </Pressable>
        </View>
      </View>

      {/* Tab content */}
      {activeTab === "inventory" ? (
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => item.id}
          renderItem={renderInventoryItem}
          contentContainerStyle={{ padding: 16 }}
          ListHeaderComponent={
            <>
              {/* Summary cards */}
              <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
                <View style={[inventoryStyles.statCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <Text style={[inventoryStyles.statValue, { color: theme.text }]}>{summaryStats.totalItems}</Text>
                  <Text style={[inventoryStyles.statLabel, { color: theme.mutedText }]}>Items</Text>
                </View>
                <View style={[inventoryStyles.statCard, { backgroundColor: theme.card, borderColor: summaryStats.lowStock > 0 ? theme.warning + "40" : theme.border }]}>
                  <Text style={[inventoryStyles.statValue, { color: summaryStats.lowStock > 0 ? theme.warning : theme.text }]}>{summaryStats.lowStock}</Text>
                  <Text style={[inventoryStyles.statLabel, { color: theme.mutedText }]}>Low</Text>
                </View>
                <View style={[inventoryStyles.statCard, { backgroundColor: theme.card, borderColor: summaryStats.outOfStock > 0 ? theme.danger + "40" : theme.border }]}>
                  <Text style={[inventoryStyles.statValue, { color: summaryStats.outOfStock > 0 ? theme.danger : theme.text }]}>{summaryStats.outOfStock}</Text>
                  <Text style={[inventoryStyles.statLabel, { color: theme.mutedText }]}>Out</Text>
                </View>
                <View style={[inventoryStyles.statCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <Text style={[inventoryStyles.statValue, { color: "#8b5cf6" }]}>{summaryStats.totalToners}</Text>
                  <Text style={[inventoryStyles.statLabel, { color: theme.mutedText }]}>Toners</Text>
                </View>
              </View>

              {/* Action buttons */}
              <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
                <Pressable onPress={importInventoryFromCSV} disabled={importingInventory} style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, flex: 1, marginBottom: 0 }]}>
                  {importingInventory ? <ActivityIndicator size="small" color={theme.text} /> : <><Ionicons name="cloud-upload-outline" size={16} color={theme.text} style={{ marginRight: 6 }} /><Text style={[inventoryStyles.importBtnText, { color: theme.text }]}>Import CSV</Text></>}
                </Pressable>
                <Pressable onPress={() => downloadInventoryTemplate().catch((e) => Alert.alert("Error", e.message))} style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12, marginBottom: 0 }]}>
                  <Ionicons name="document-outline" size={18} color={theme.text} />
                </Pressable>
                <Pressable onPress={openScanModal} style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12, marginBottom: 0 }]}>
                  <Ionicons name="barcode-outline" size={18} color={theme.text} />
                </Pressable>
                <Pressable onPress={() => openInventoryModal()} style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12, marginBottom: 0 }]}>
                  <Ionicons name="add" size={18} color={theme.text} />
                </Pressable>
              </View>

              <TextInput style={[inventoryStyles.searchInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]} placeholder="Search inventory..." placeholderTextColor={theme.mutedText} value={searchQuery} onChangeText={setSearchQuery} />
              <View style={inventoryStyles.filterRow}>
                <View style={inventoryStyles.sortGroup}>
                  <Pressable onPress={() => setSortMode("name")} style={[inventoryStyles.chipSmall, { backgroundColor: sortMode === "name" ? theme.text : "transparent", borderColor: theme.border }]}>
                    <Text style={[inventoryStyles.chipTextSmall, { color: sortMode === "name" ? theme.background : theme.mutedText }]}>A-Z</Text>
                  </Pressable>
                  <Pressable onPress={() => setSortMode("stock")} style={[inventoryStyles.chipSmall, { backgroundColor: sortMode === "stock" ? theme.text : "transparent", borderColor: theme.border }]}>
                    <Text style={[inventoryStyles.chipTextSmall, { color: sortMode === "stock" ? theme.background : theme.mutedText }]}>Stock</Text>
                  </Pressable>
                </View>
                <Pressable onPress={() => setShowLowOnly(!showLowOnly)} style={[inventoryStyles.chipSmall, { backgroundColor: showLowOnly ? theme.danger : "transparent", borderColor: showLowOnly ? theme.danger : theme.border }]}>
                  <Text style={[inventoryStyles.chipTextSmall, { color: showLowOnly ? "#fff" : theme.mutedText }]}>Low Stock</Text>
                </Pressable>
              </View>
            </>
          }
        />
      ) : activeTab === "toners" ? (
        <TonerSection ref={tonerSectionRef} siteId={siteId} onTonerCountChange={setVisibleTonerCount} />
      ) : (
        <RadioSection ref={radioSectionRef} siteId={siteId} />
      )}

      {/* Inventory Undo Bar */}
      <Animated.View
        pointerEvents={inventoryUndoPointerEvents}
        style={[inventoryStyles.undoBar, { backgroundColor: theme.card, borderColor: theme.border, bottom: 16, opacity: undoAnim, zIndex: 1000, transform: [{ translateY: undoAnim.interpolate({ inputRange: [0, 1], outputRange: [120, 0] }) }] }]}
      >
        <Text style={{ color: theme.text, fontWeight: "700" }}>Item deleted</Text>
        <Pressable onPress={undoDelete} style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#fff", borderRadius: 8 }}>
          <Text style={{ color: "#000", fontWeight: "800" }}>UNDO</Text>
        </Pressable>
      </Animated.View>

      {/* Scanner Modal */}
      <Modal visible={showScanModal} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setShowScanModal(false)}>
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <CameraView style={StyleSheet.absoluteFill} facing="back" autofocus="on" onBarcodeScanned={scanningEnabled ? handleBarcodeScanned : undefined} />
          <View style={{ position: "absolute", left: 16, right: 16, bottom: 48, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 16, padding: 16 }}>
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16, marginBottom: 12 }}>
              {scanBusy ? "Looking up barcode…" : scanningEnabled ? "Point at a barcode" : "Paused"}
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable onPress={() => { setScanBusy(false); setScanningEnabled(true); }} style={{ flex: 1, backgroundColor: theme.primary, paddingVertical: 10, borderRadius: 999, alignItems: "center" }}>
                <Text style={{ color: "#fff", fontWeight: "800" }}>Scan again</Text>
              </Pressable>
              <Pressable onPress={() => setShowScanModal(false)} style={{ flex: 1, backgroundColor: "#374151", paddingVertical: 10, borderRadius: 999, alignItems: "center" }}>
                <Text style={{ color: "#fff", fontWeight: "800" }}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Inventory Item Modal */}
      <Modal visible={showInventoryModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowInventoryModal(false)}>
        <View style={[inventoryStyles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={inventoryStyles.modalHeader}>
            <Text style={[inventoryStyles.modalTitle, { color: theme.text }]}>Add New Item</Text>
            <Pressable onPress={() => setShowInventoryModal(false)}><Ionicons name="close" size={24} color={theme.text} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Item Name *</Text>
            <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]} placeholder="e.g. AA Batteries" placeholderTextColor={theme.mutedText} value={itemForm.name} onChangeText={(v) => setItemForm((p) => ({ ...p, name: v }))} />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Current Quantity *</Text>
                <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]} keyboardType="numeric" placeholder="0" placeholderTextColor={theme.mutedText} value={itemForm.currentQuantity} onChangeText={(v) => setItemForm((p) => ({ ...p, currentQuantity: v }))} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Min Quantity</Text>
                <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]} keyboardType="numeric" placeholder="0" placeholderTextColor={theme.mutedText} value={itemForm.minQuantity} onChangeText={(v) => setItemForm((p) => ({ ...p, minQuantity: v }))} />
              </View>
            </View>
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Location</Text>
            <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]} placeholder="e.g. Storage Room A, Shelf 3" placeholderTextColor={theme.mutedText} value={itemForm.location} onChangeText={(v) => setItemForm((p) => ({ ...p, location: v }))} />
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Barcode / SKU</Text>
            <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]} placeholder="e.g. 123456789012" placeholderTextColor={theme.mutedText} value={itemForm.barcode} onChangeText={(v) => setItemForm((p) => ({ ...p, barcode: v }))} />
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Notes</Text>
            <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, height: 100, textAlignVertical: "top" }]} placeholder="Additional notes about this item..." placeholderTextColor={theme.mutedText} multiline value={itemForm.notes} onChangeText={(v) => setItemForm((p) => ({ ...p, notes: v }))} />
            <Pressable style={[inventoryStyles.saveBtn, { backgroundColor: theme.primary }]} onPress={saveItem}>
              <Text style={inventoryStyles.saveBtnText}>Add Item</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {/* Disposal Modal */}
      <Modal visible={showDisposeModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (!disposeSaving) { setShowDisposeModal(false); setDisposingItem(null); } }}>
        <View style={[inventoryStyles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={inventoryStyles.modalHeader}>
            <Text style={[inventoryStyles.modalTitle, { color: theme.text }]}>Dispose Item</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Pressable onPress={() => downloadDisposalTemplate().catch((e) => Alert.alert("Error", e.message))} hitSlop={8}>
                <Ionicons name="document-outline" size={22} color={theme.mutedText} />
              </Pressable>
              <Pressable onPress={() => { if (!disposeSaving) { setShowDisposeModal(false); setDisposingItem(null); } }}>
                <Ionicons name="close" size={24} color={theme.text} />
              </Pressable>
            </View>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Item *</Text>
            <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]} placeholder="Item name" placeholderTextColor={theme.mutedText} value={disposeForm.itemName} onChangeText={(v) => setDisposeForm((p) => ({ ...p, itemName: v }))} />
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Model</Text>
            <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]} placeholder="e.g. HP LaserJet Pro" placeholderTextColor={theme.mutedText} value={disposeForm.model} onChangeText={(v) => setDisposeForm((p) => ({ ...p, model: v }))} />
            {disposingItem && <Text style={{ color: theme.mutedText, fontSize: 12, marginBottom: 8 }}>Current stock: {disposingItem.currentQuantity}</Text>}
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Amount</Text>
                <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]} keyboardType="numeric" placeholder="Qty" placeholderTextColor={theme.mutedText} value={disposeForm.amount} onChangeText={(v) => setDisposeForm((p) => ({ ...p, amount: v }))} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Approx Amount ($)</Text>
                <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]} keyboardType="numeric" placeholder="Unit value" placeholderTextColor={theme.mutedText} value={disposeForm.approxAmount} onChangeText={(v) => setDisposeForm((p) => ({ ...p, approxAmount: v }))} />
              </View>
            </View>
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Vendor</Text>
            <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]} placeholder="e.g. Amazon, Staples" placeholderTextColor={theme.mutedText} value={disposeForm.vendor} onChangeText={(v) => setDisposeForm((p) => ({ ...p, vendor: v }))} />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Multiple Amount ($)</Text>
                <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]} keyboardType="numeric" placeholder="Total value" placeholderTextColor={theme.mutedText} value={disposeForm.multipleAmount} onChangeText={(v) => setDisposeForm((p) => ({ ...p, multipleAmount: v }))} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Approx Age</Text>
                <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]} placeholder="e.g. 2 years" placeholderTextColor={theme.mutedText} value={disposeForm.approxAge} onChangeText={(v) => setDisposeForm((p) => ({ ...p, approxAge: v }))} />
              </View>
            </View>
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Description</Text>
            <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, height: 80, textAlignVertical: "top" }]} placeholder="Reason for disposal, condition, etc." placeholderTextColor={theme.mutedText} multiline value={disposeForm.description} onChangeText={(v) => setDisposeForm((p) => ({ ...p, description: v }))} />
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Who is disposing it? *</Text>
            <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]} placeholder="Your name" placeholderTextColor={theme.mutedText} value={disposeForm.disposedBy} onChangeText={(v) => setDisposeForm((p) => ({ ...p, disposedBy: v }))} />
            <Pressable style={[inventoryStyles.saveBtn, { backgroundColor: theme.danger, opacity: disposeSaving ? 0.6 : 1 }]} onPress={confirmDispose} disabled={disposeSaving}>
              {disposeSaving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={[inventoryStyles.saveBtnText, { color: "#fff" }]}>Confirm Disposal</Text>}
            </Pressable>
            <Pressable style={[inventoryStyles.saveBtn, { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.border, marginTop: 10 }]} onPress={() => { if (!disposeSaving) { setShowDisposeModal(false); setDisposingItem(null); } }} disabled={disposeSaving}>
              <Text style={[inventoryStyles.saveBtnText, { color: theme.text }]}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
