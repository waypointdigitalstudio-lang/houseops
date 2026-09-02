import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import inventoryStyles from "../constants/inventoryStyles";
import { useAppTheme } from "../constants/theme";
import { db } from "../firebaseConfig";
import {
  Toner,
  TonerSubTab,
  TONER_COLORS,
  UNDO_ANIMATION_MS,
  UNDO_TIMEOUT_MS,
} from "../types/inventory";
import { getStockStatus, logActivity } from "../utils/activity";
import { downloadTonerTemplate, makeColFinder, normalizeCell, parseCSV } from "../utils/csvHelpers";
import DataCardList from "./DataCardList";
import PrinterList from "./PrinterList";
import TonerStockBadge from "./TonerStockBadge";

export interface TonerSectionRef {
  openAddToner: (barcode: string) => void;
}

interface TonerSectionProps {
  siteId: string | null;
  onTonerCountChange: (count: number) => void;
}

const TonerSection = forwardRef<TonerSectionRef, TonerSectionProps>(function TonerSection({ siteId, onTonerCountChange }, ref) {
  const theme = useAppTheme();

  const [tonerSubTab, setTonerSubTab] = useState<TonerSubTab>("toners");

  // Toner state
  const [toners, setToners] = useState<Toner[]>([]);
  const [tonersLoading, setTonersLoading] = useState(true);
  const [tonerSearch, setTonerSearch] = useState("");
  const [showTonerLowOnly, setShowTonerLowOnly] = useState(false);
  const [showTonerModal, setShowTonerModal] = useState(false);
  const [editingToner, setEditingToner] = useState<Toner | null>(null);
  const [tonerForm, setTonerForm] = useState({ model: "", color: "Black", quantity: "", minQuantity: "", printer: "", notes: "", barcode: "" });
  const [importingToners, setImportingToners] = useState(false);

  // Toner undo state
  const [pendingTonerDelete, setPendingTonerDelete] = useState<{ toner: Toner; backup: any } | null>(null);
  const [hiddenTonerIds, setHiddenTonerIds] = useState<Set<string>>(new Set());
  const undoTonerAnim = useRef(new Animated.Value(0)).current;
  const undoTonerTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // Mounted tracking + cleanup
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (undoTonerTimeoutRef.current) clearTimeout(undoTonerTimeoutRef.current);
    };
  }, []);

  // Toners Firestore listener
  useEffect(() => {
    if (!siteId) return;
    const q = query(collection(db, "toners"), where("siteId", "==", siteId));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Toner));
      setToners(list);
      setTonersLoading(false);
    }, (err) => { if (__DEV__) console.error("toners onSnapshot error:", err); setTonersLoading(false); });
    return () => unsub();
  }, [siteId]);

  // Notify parent of visible toner count for summary stats
  useEffect(() => {
    const visibleCount = toners.filter((t) => !hiddenTonerIds.has(t.id)).length;
    onTonerCountChange(visibleCount);
  }, [toners, hiddenTonerIds, onTonerCountChange]);

  const filteredToners = useMemo(() => {
    let list = toners.filter((t) => !hiddenTonerIds.has(t.id));
    if (tonerSearch) {
      const q = tonerSearch.toLowerCase();
      list = list.filter((t) => t.model.toLowerCase().includes(q) || t.printer?.toLowerCase().includes(q));
    }
    if (showTonerLowOnly) list = list.filter((t) => t.quantity <= t.minQuantity);
    return list.sort((a, b) => a.model.localeCompare(b.model));
  }, [toners, tonerSearch, showTonerLowOnly, hiddenTonerIds]);

  // Toner undo logic
  const dismissTonerUndoBanner = useCallback(() => {
    if (undoTonerTimeoutRef.current) { clearTimeout(undoTonerTimeoutRef.current); undoTonerTimeoutRef.current = null; }
    Animated.timing(undoTonerAnim, { toValue: 0, duration: UNDO_ANIMATION_MS, useNativeDriver: true }).start(() => {
      if (isMountedRef.current) setPendingTonerDelete(null);
    });
  }, [undoTonerAnim]);

  const scheduleTonerDelete = useCallback(async (toner: Toner) => {
    if (pendingTonerDelete) {
      if (undoTonerTimeoutRef.current) { clearTimeout(undoTonerTimeoutRef.current); undoTonerTimeoutRef.current = null; }
      try {
        await deleteDoc(doc(db, "toners", pendingTonerDelete.toner.id));
        const prevStatus = getStockStatus(pendingTonerDelete.toner.quantity, pendingTonerDelete.toner.minQuantity);
        await logActivity({ siteId: siteId ?? "", itemName: pendingTonerDelete.toner.model, itemId: pendingTonerDelete.toner.id, qty: 0, min: pendingTonerDelete.toner.minQuantity, prevState: prevStatus, nextState: "OUT", action: "deleted", itemType: "toner" });
      } catch (e) { if (__DEV__) console.error("Error committing previous toner delete:", e); }
      setHiddenTonerIds((prev) => { const next = new Set(prev); next.delete(pendingTonerDelete.toner.id); return next; });
      undoTonerAnim.setValue(0);
      setPendingTonerDelete(null);
    }
    const backup = { ...toner };
    delete (backup as any).id;
    setHiddenTonerIds((prev) => new Set(prev).add(toner.id));
    setPendingTonerDelete({ toner, backup });
    Animated.timing(undoTonerAnim, { toValue: 1, duration: UNDO_ANIMATION_MS, useNativeDriver: true }).start();
    undoTonerTimeoutRef.current = setTimeout(async () => {
      if (!isMountedRef.current) return;
      try {
        await deleteDoc(doc(db, "toners", toner.id));
        const prevStatus = getStockStatus(toner.quantity, toner.minQuantity);
        await logActivity({ siteId: siteId ?? "", itemName: toner.model, itemId: toner.id, qty: 0, min: toner.minQuantity, prevState: prevStatus, nextState: "OUT", action: "deleted", itemType: "toner" });
      } catch (e) {
        if (__DEV__) console.error("Error during scheduled toner delete:", e);
        if (isMountedRef.current) setHiddenTonerIds((prev) => { const next = new Set(prev); next.delete(toner.id); return next; });
      }
      if (isMountedRef.current) dismissTonerUndoBanner();
    }, UNDO_TIMEOUT_MS);
  }, [pendingTonerDelete, undoTonerAnim, dismissTonerUndoBanner, siteId]);

  const undoTonerDelete = useCallback(async () => {
    if (!pendingTonerDelete) return;
    if (undoTonerTimeoutRef.current) { clearTimeout(undoTonerTimeoutRef.current); undoTonerTimeoutRef.current = null; }
    const { toner, backup } = pendingTonerDelete;
    setHiddenTonerIds((prev) => { const next = new Set(prev); next.delete(toner.id); return next; });
    try { await setDoc(doc(db, "toners", toner.id), backup, { merge: true }); } catch (e) { if (__DEV__) console.error("Error restoring toner:", e); }
    dismissTonerUndoBanner();
  }, [pendingTonerDelete, dismissTonerUndoBanner]);

  // Toner CRUD
  const openAddToner = useCallback((barcode: string) => {
    setTonerSubTab("toners");
    setEditingToner(null);
    setTonerForm({ model: "", color: "Black", quantity: "", minQuantity: "", printer: "", notes: "", barcode });
    setShowTonerModal(true);
  }, []);

  useImperativeHandle(ref, () => ({ openAddToner }), [openAddToner]);

  const openTonerModal = (toner?: Toner) => {
    if (toner) {
      setEditingToner(toner);
      setTonerForm({ model: toner.model, color: toner.color, quantity: String(toner.quantity), minQuantity: String(toner.minQuantity), printer: toner.printer || "", notes: toner.notes || "", barcode: toner.barcode || "" });
    } else {
      setEditingToner(null);
      setTonerForm({ model: "", color: "Black", quantity: "", minQuantity: "", printer: "", notes: "", barcode: "" });
    }
    setShowTonerModal(true);
  };

  const saveToner = async () => {
    if (!tonerForm.model || !tonerForm.quantity) { Alert.alert("Error", "Model and Quantity are required."); return; }
    if (!siteId) { Alert.alert("Error", "No site assigned to your account."); return; }
    const newQty = parseInt(tonerForm.quantity) || 0;
    const newMin = parseInt(tonerForm.minQuantity) || 0;
    const data = { ...tonerForm, quantity: newQty, minQuantity: newMin, siteId };
    try {
      if (editingToner) {
        const prevStatus = getStockStatus(editingToner.quantity, editingToner.minQuantity);
        const nextStatus = getStockStatus(newQty, newMin);
        await setDoc(doc(db, "toners", editingToner.id), data, { merge: true });
        await logActivity({ siteId, itemName: data.model, itemId: editingToner.id, qty: newQty, min: newMin, prevState: prevStatus, nextState: nextStatus, action: "edited", itemType: "toner" });
      } else {
        const docRef = await addDoc(collection(db, "toners"), data);
        const nextStatus = getStockStatus(newQty, newMin);
        await logActivity({ siteId, itemName: data.model, itemId: docRef.id, qty: newQty, min: newMin, prevState: "OK", nextState: nextStatus, action: "added", itemType: "toner" });
      }
      setShowTonerModal(false);
    } catch { Alert.alert("Error", "Failed to save toner."); }
  };

  const importTonersFromCSV = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "text/plain"] });
      if (result.canceled) return;
      if (!siteId) { Alert.alert("Error", "No site assigned to your account."); return; }
      setImportingToners(true);
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const rows = parseCSV(content);
      if (rows.length < 2) { Alert.alert("Empty File", "No data rows found in the CSV."); return; }
      const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, ""));
      const col = makeColFinder(headers);
      const iModel = col(["model", "name", "toner"]);
      const iPart = col(["part", "partnumber", "sku"]);
      const iColor = col(["color", "colour", "type"]);
      const iQty = col(["qty", "quantity", "amount", "stock"]);
      const iMinQty = col(["min", "minimum", "minqty"]);
      const iPrinter = col(["printer", "compatible", "machine"]);
      const iSupplier = col(["supplier", "vendor"]);
      const iNotes = col(["notes", "note"]);
      if (iModel === -1) { Alert.alert("Import Failed", "Could not find a 'Model' or 'Name' column."); return; }
      const dataRows = rows.slice(1).filter((row) => normalizeCell(row[iModel] ?? "") !== "");
      let count = 0;
      for (let i = 0; i < dataRows.length; i += 499) {
        const chunk = dataRows.slice(i, i + 499);
        const batch = writeBatch(db);
        for (const row of chunk) {
          const model = normalizeCell(row[iModel] ?? "");
          if (!model) continue;
          const rawColor = normalizeCell(row[iColor] ?? "Black");
          const color = TONER_COLORS.find((c) => c.toLowerCase() === rawColor.toLowerCase()) || "Other";
          const stableId = `${siteId}_${model}_${color}`.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 100);
          batch.set(doc(db, "toners", stableId), { model, partNumber: normalizeCell(row[iPart] ?? ""), color, quantity: parseInt(normalizeCell(row[iQty] ?? "")) || 0, minQuantity: parseInt(normalizeCell(row[iMinQty] ?? "")) || 0, printer: normalizeCell(row[iPrinter] ?? ""), supplier: normalizeCell(row[iSupplier] ?? ""), notes: normalizeCell(row[iNotes] ?? ""), siteId, importedAt: new Date().toISOString() }, { merge: true });
          count++;
        }
        await batch.commit();
      }
      Alert.alert("Import Complete", `${count} toner${count !== 1 ? "s" : ""} imported/updated.`);
    } catch (err: any) { Alert.alert("Import Failed", err.message || "An unexpected error occurred."); } finally { setImportingToners(false); }
  };

  const renderToner = ({ item }: { item: Toner }) => (
    <Pressable onPress={() => openTonerModal(item)}>
      <View style={[inventoryStyles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[inventoryStyles.itemName, { color: theme.text }]}>{item.model}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
            <Ionicons name="print-outline" size={14} color={theme.mutedText} style={{ marginRight: 4 }} />
            <Text style={{ color: theme.mutedText, fontSize: 12 }}>{item.printer || "Universal"}</Text>
          </View>
          {item.partNumber ? <Text style={{ color: theme.mutedText, fontSize: 11, marginTop: 2 }}>Part: {item.partNumber}</Text> : null}
        </View>
        <View style={inventoryStyles.rightControls}>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ color: item.quantity <= item.minQuantity ? "#ef4444" : theme.text, fontWeight: "800", fontSize: 18 }}>{item.quantity}</Text>
            <Text style={{ color: theme.mutedText, fontSize: 10 }}>{item.color.toUpperCase()}</Text>
            {item.quantity <= item.minQuantity && <Text style={{ color: "#ef4444", fontSize: 10, fontWeight: "700" }}>LOW</Text>}
          </View>
          <Pressable onPress={() => scheduleTonerDelete(item)} style={{ padding: 4 }}>
            <Ionicons name="trash-outline" size={20} color="#ef4444" />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );

  const tonerUndoPointerEvents = pendingTonerDelete ? "auto" : "none";

  // Printer count display from printers sub-tab (passed via inline in sub-tab bar below)
  // We no longer own printer/datacard state here — those components manage themselves.

  return (
    <View style={{ flex: 1 }}>
      {/* Sub-tab bar */}
      <View style={{ flexDirection: "row", paddingHorizontal: 16, marginBottom: 12, gap: 12 }}>
        <Pressable onPress={() => setTonerSubTab("toners")} style={{ flex: 1, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: tonerSubTab === "toners" ? theme.text : "transparent" }}>
          <Text style={{ textAlign: "center", color: tonerSubTab === "toners" ? theme.text : theme.mutedText, fontWeight: "700", fontSize: 12 }}>Toner Inventory</Text>
        </Pressable>
        <Pressable onPress={() => setTonerSubTab("printers")} style={{ flex: 1, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: tonerSubTab === "printers" ? theme.text : "transparent" }}>
          <Text style={{ textAlign: "center", color: tonerSubTab === "printers" ? theme.text : theme.mutedText, fontWeight: "700", fontSize: 12 }}>Printers</Text>
        </Pressable>
        <Pressable onPress={() => setTonerSubTab("datacard")} style={{ flex: 1, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: tonerSubTab === "datacard" ? theme.text : "transparent" }}>
          <Text style={{ textAlign: "center", color: tonerSubTab === "datacard" ? theme.text : theme.mutedText, fontWeight: "700", fontSize: 12 }}>Data Card</Text>
        </Pressable>
      </View>

      {tonerSubTab === "toners" ? (
        <FlatList
          data={filteredToners}
          keyExtractor={(item) => item.id}
          renderItem={renderToner}
          contentContainerStyle={{ padding: 16 }}
          ListHeaderComponent={
            <>
              <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
                <Pressable onPress={importTonersFromCSV} disabled={importingToners} style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, flex: 1, marginBottom: 0 }]}>
                  {importingToners ? <ActivityIndicator size="small" color={theme.text} /> : <><Ionicons name="cloud-upload-outline" size={16} color={theme.text} style={{ marginRight: 6 }} /><Text style={[inventoryStyles.importBtnText, { color: theme.text }]}>Import CSV</Text></>}
                </Pressable>
                <Pressable onPress={() => downloadTonerTemplate().catch((e) => Alert.alert("Error", e.message))} style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12, marginBottom: 0 }]}>
                  <Ionicons name="document-outline" size={18} color={theme.text} />
                </Pressable>
              </View>
              <View style={inventoryStyles.tonerHeaderRow}>
                <TextInput style={[inventoryStyles.searchInput, { flex: 1, backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]} placeholder="Search toners..." placeholderTextColor={theme.mutedText} value={tonerSearch} onChangeText={setTonerSearch} />
                <Pressable onPress={() => setShowTonerLowOnly(!showTonerLowOnly)} style={[inventoryStyles.chipSmall, { height: 38, justifyContent: "center", backgroundColor: showTonerLowOnly ? "#ef4444" : "transparent", borderColor: showTonerLowOnly ? "#ef4444" : theme.border }]}>
                  <Text style={[inventoryStyles.chipTextSmall, { color: showTonerLowOnly ? "#fff" : theme.mutedText }]}>Low</Text>
                </Pressable>
                <Pressable onPress={() => openTonerModal()} style={[inventoryStyles.addTonerBtn, { backgroundColor: theme.text }]}>
                  <Ionicons name="add" size={24} color={theme.background} />
                </Pressable>
              </View>
            </>
          }
        />
      ) : tonerSubTab === "printers" ? (
        <PrinterList siteId={siteId} toners={toners} />
      ) : (
        <DataCardList siteId={siteId} />
      )}

      {/* Toner Undo Bar */}
      <Animated.View
        pointerEvents={tonerUndoPointerEvents}
        style={[inventoryStyles.undoBar, { backgroundColor: theme.card, borderColor: theme.border, bottom: 16, opacity: undoTonerAnim, zIndex: 1001, transform: [{ translateY: undoTonerAnim.interpolate({ inputRange: [0, 1], outputRange: [120, 0] }) }] }]}
      >
        <Text style={{ color: theme.text, fontWeight: "700" }}>Toner deleted</Text>
        <Pressable onPress={undoTonerDelete} style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#fff", borderRadius: 8 }}>
          <Text style={{ color: "#000", fontWeight: "800" }}>UNDO</Text>
        </Pressable>
      </Animated.View>

      {/* Toner Modal */}
      <Modal visible={showTonerModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setShowTonerModal(false); setEditingToner(null); }}>
        <View style={[inventoryStyles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={inventoryStyles.modalHeader}>
            <Text style={[inventoryStyles.modalTitle, { color: theme.text }]}>{editingToner ? "Edit Toner" : "Add New Toner"}</Text>
            <Pressable onPress={() => { setShowTonerModal(false); setEditingToner(null); }}><Ionicons name="close" size={24} color={theme.text} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Model Name *</Text>
            <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]} placeholder="e.g. 202X" placeholderTextColor={theme.mutedText} value={tonerForm.model} onChangeText={(v) => setTonerForm((p) => ({ ...p, model: v }))} />
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Color</Text>
            <View style={inventoryStyles.colorRow}>
              {TONER_COLORS.map((c) => (
                <Pressable key={c} onPress={() => setTonerForm((p) => ({ ...p, color: c }))} style={[inventoryStyles.colorChip, { borderColor: tonerForm.color === c ? theme.text : theme.border, backgroundColor: tonerForm.color === c ? theme.text : "transparent" }]}>
                  <Text style={[inventoryStyles.chipTextSmall, { color: tonerForm.color === c ? theme.background : theme.mutedText }]}>{c}</Text>
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Quantity *</Text>
                <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]} keyboardType="numeric" value={tonerForm.quantity} onChangeText={(v) => setTonerForm((p) => ({ ...p, quantity: v }))} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Min Qty</Text>
                <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]} keyboardType="numeric" value={tonerForm.minQuantity} onChangeText={(v) => setTonerForm((p) => ({ ...p, minQuantity: v }))} />
              </View>
            </View>
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Compatible Printer</Text>
            <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]} placeholder="e.g. HP LaserJet M404" placeholderTextColor={theme.mutedText} value={tonerForm.printer} onChangeText={(v) => setTonerForm((p) => ({ ...p, printer: v }))} />
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Barcode / SKU</Text>
            <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]} placeholder="e.g. 123456789012" placeholderTextColor={theme.mutedText} value={tonerForm.barcode} onChangeText={(v) => setTonerForm((p) => ({ ...p, barcode: v }))} />
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Notes</Text>
            <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, height: 80, textAlignVertical: "top" }]} placeholder="Additional notes..." placeholderTextColor={theme.mutedText} multiline value={tonerForm.notes} onChangeText={(v) => setTonerForm((p) => ({ ...p, notes: v }))} />
            <Pressable style={[inventoryStyles.saveBtn, { backgroundColor: theme.primary }]} onPress={saveToner}>
              <Text style={inventoryStyles.saveBtnText}>{editingToner ? "Update Toner" : "Add Toner"}</Text>
            </Pressable>
            {editingToner && (
              <Pressable style={[inventoryStyles.saveBtn, { backgroundColor: "transparent", borderWidth: 1, borderColor: "#ef4444", marginTop: 8 }]} onPress={() => { setShowTonerModal(false); scheduleTonerDelete(editingToner); setEditingToner(null); }}>
                <Text style={[inventoryStyles.saveBtnText, { color: "#ef4444" }]}>Delete Toner</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
});

export default TonerSection;
