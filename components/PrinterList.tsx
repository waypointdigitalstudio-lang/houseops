import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { Printer, Toner, TonerLink } from "../types/inventory";
import { getStockStatus, logActivity } from "../utils/activity";
import { downloadPrinterTemplate, makeColFinder, normalizeCell, parseCSV } from "../utils/csvHelpers";
import TonerStockBadge from "./TonerStockBadge";

interface PrinterListProps {
  siteId: string | null;
  toners: Toner[];
}

const emptyForm = { name: "", location: "", roomNumber: "", ipAddress: "", assetNumber: "", toshibaId: "", serial: "", tonerSeries: "", barcode: "", notes: "" };

export default function PrinterList({ siteId, toners }: PrinterListProps) {
  const theme = useAppTheme();

  const [printers, setPrinters] = useState<Printer[]>([]);
  const [printersLoading, setPrintersLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Printer | null>(null);
  const [form, setForm] = useState(emptyForm);

  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedPrinter, setSelectedPrinter] = useState<Printer | null>(null);
  const [tonerLinkSearch, setTonerLinkSearch] = useState("");
  const [tonerLinkList, setTonerLinkList] = useState<TonerLink[]>([]);

  useEffect(() => {
    if (!siteId) return;
    const q = query(collection(db, "printers"), where("siteId", "==", siteId));
    const unsub = onSnapshot(q, (snap) => {
      setPrinters(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Printer)));
      setPrintersLoading(false);
    }, (err) => { if (__DEV__) console.error("printers onSnapshot error:", err); setPrintersLoading(false); });
    return () => unsub();
  }, [siteId]);

  useEffect(() => {
    if (!showLinkModal || !siteId) return;
    const q = query(collection(db, "toners"), where("siteId", "==", siteId), orderBy("model", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setTonerLinkList(snap.docs.map((d) => {
        const data = d.data() as any;
        return { id: d.id, name: data.model || data.name || "Unknown", stock: data.quantity ?? data.stock ?? 0 } as TonerLink;
      }));
    }, (err) => { if (__DEV__) console.error("tonerLinkList onSnapshot error:", err); });
    return () => unsub();
  }, [showLinkModal, siteId]);

  const filtered = useMemo(() => {
    if (!search) return printers.sort((a, b) => a.name.localeCompare(b.name));
    const q = search.toLowerCase();
    return printers
      .filter((p) => p.name.toLowerCase().includes(q) || p.location?.toLowerCase().includes(q) || p.ipAddress?.includes(q) || p.toshibaId?.toLowerCase().includes(q) || p.assetNumber?.toLowerCase().includes(q) || p.roomNumber?.includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [printers, search]);

  const filteredLinkList = useMemo(() => {
    if (!tonerLinkSearch) return tonerLinkList;
    return tonerLinkList.filter((t) => t.name.toLowerCase().includes(tonerLinkSearch.toLowerCase()));
  }, [tonerLinkList, tonerLinkSearch]);

  const openEdit = (item: Printer) => {
    setEditing(item);
    setForm({ name: item.name || "", location: item.location || "", roomNumber: item.roomNumber || "", ipAddress: item.ipAddress || "", assetNumber: item.assetNumber || "", toshibaId: item.toshibaId || "", serial: item.serial || "", tonerSeries: item.tonerSeries || "", barcode: item.barcode || "", notes: item.notes || "" });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.name) { Alert.alert("Error", "Name is required."); return; }
    if (!siteId) { Alert.alert("Error", "No site assigned to your account."); return; }
    const data = { ...form, siteId };
    try {
      if (editing) {
        await setDoc(doc(db, "printers", editing.id), data, { merge: true });
        await logActivity({ siteId, itemName: data.name, itemId: editing.id, qty: 0, min: 0, prevState: "OK", nextState: "OK", action: "edited", itemType: "printer" });
      } else {
        const ref = await addDoc(collection(db, "printers"), data);
        await logActivity({ siteId, itemName: data.name, itemId: ref.id, qty: 0, min: 0, prevState: "OK", nextState: "OK", action: "added", itemType: "printer" });
      }
      setShowModal(false);
    } catch { Alert.alert("Error", "Failed to save printer."); }
  };

  const remove = (item: Printer) => {
    Alert.alert("Delete Printer", `Remove ${item.name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await deleteDoc(doc(db, "printers", item.id)); setShowModal(false); setEditing(null); }
        catch (err: any) { Alert.alert("Error", err.message || "Failed to delete printer."); }
      }},
    ]);
  };

  const handleLinkToner = async (toner: TonerLink) => {
    if (!selectedPrinter) return;
    try {
      await updateDoc(doc(db, "printers", selectedPrinter.id), { tonerId: toner.id });
      await logActivity({ siteId: siteId ?? "", itemName: `${toner.name} → ${selectedPrinter.name}`, itemId: selectedPrinter.id, qty: toner.stock, min: 0, prevState: "OK", nextState: "OK", action: "linked", itemType: "printer" });
      setShowLinkModal(false);
      setSelectedPrinter(null);
      Alert.alert("Linked!", `${toner.name} linked to ${selectedPrinter.name}.`);
    } catch { Alert.alert("Error", "Failed to link toner."); }
  };

  const handleUnlinkToner = async (printer: Printer) => {
    if (!printer.tonerId) return;
    const linked = toners.find((t) => t.id === printer.tonerId);
    Alert.alert("Unlink Toner", `Remove ${linked?.model || "toner"} from ${printer.name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Unlink", style: "destructive", onPress: async () => {
        try {
          await updateDoc(doc(db, "printers", printer.id), { tonerId: deleteField() });
          await logActivity({ siteId: siteId ?? "", itemName: `${linked?.model || "Unknown Toner"} ✕ ${printer.name}`, itemId: printer.id, qty: linked?.quantity ?? 0, min: linked?.minQuantity ?? 0, prevState: "OK", nextState: "OK", action: "unlinked", itemType: "printer" });
          Alert.alert("Unlinked!", `Toner removed from ${printer.name}.`);
        } catch { Alert.alert("Error", "Failed to unlink toner."); }
      }},
    ]);
  };

  const handleDeductToner = async (printer: Printer) => {
    if (!printer.tonerId) return;
    const linked = toners.find((t) => t.id === printer.tonerId);
    Alert.alert("Deduct Toner", `Use 1 toner for ${printer.name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Deduct 1", onPress: async () => {
        try {
          const prevQty = linked?.quantity ?? 1;
          const minQty = linked?.minQuantity ?? 0;
          const newQty = Math.max(0, prevQty - 1);
          await updateDoc(doc(db, "toners", printer.tonerId!), { quantity: increment(-1) });
          await logActivity({ siteId: siteId ?? "", itemName: linked?.model || "Unknown Toner", itemId: printer.tonerId!, qty: newQty, min: minQty, prevState: getStockStatus(prevQty, minQty), nextState: getStockStatus(newQty, minQty), action: "deducted", itemType: "toner" });
        } catch { Alert.alert("Error", "Failed to update stock."); }
      }},
    ]);
  };

  const importCSV = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "text/plain"] });
      if (result.canceled) return;
      if (!siteId) { Alert.alert("Error", "No site assigned to your account."); return; }
      setImporting(true);
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const rows = parseCSV(content);
      if (rows.length < 2) { Alert.alert("Empty File", "No data rows found in the CSV."); return; }
      const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, ""));
      const col = makeColFinder(headers);
      const iName = col(["name", "printer", "description", "desc"]);
      const iLocation = col(["location", "loc", "dept", "department"]);
      const iRoomNumber = col(["room#", "room", "roomnumber", "roomnum"]);
      const iIp = col(["ip", "ipaddress", "ip_address"]);
      const iAsset = col(["assetnumber", "asset"]);
      const iToshibaId = col(["toshibaid", "toshiba", "ballysnumber", "ballys"]);
      const iSerial = col(["serial", "sn", "serialnumber"]);
      const iModel = col(["model", "make"]);
      const iTonerSeries = col(["toner", "tonerseries"]);
      const iBarcode = col(["barcode", "sku", "upc"]);
      const iNotes = col(["notes", "note"]);
      if (iName === -1) { Alert.alert("Import Failed", "Could not find a 'Name', 'Description', or 'Printer' column."); return; }
      const dataRows = rows.slice(1).filter((row) => normalizeCell(row[iName] ?? "") !== "");
      let count = 0;
      for (let i = 0; i < dataRows.length; i += 499) {
        const chunk = dataRows.slice(i, i + 499);
        const batch = writeBatch(db);
        for (const row of chunk) {
          const name = normalizeCell(row[iName] ?? "");
          if (!name) continue;
          const stableId = `${siteId}_${name}`.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 100);
          batch.set(doc(db, "printers", stableId), { name, location: normalizeCell(row[iLocation] ?? ""), roomNumber: iRoomNumber !== -1 ? normalizeCell(row[iRoomNumber] ?? "") : "", ipAddress: normalizeCell(row[iIp] ?? ""), assetNumber: normalizeCell(row[iAsset] ?? ""), toshibaId: iToshibaId !== -1 ? normalizeCell(row[iToshibaId] ?? "") : "", serial: normalizeCell(row[iSerial] ?? ""), model: iModel !== -1 ? normalizeCell(row[iModel] ?? "") : "", tonerSeries: normalizeCell(row[iTonerSeries] ?? ""), barcode: normalizeCell(row[iBarcode] ?? ""), notes: normalizeCell(row[iNotes] ?? ""), siteId, importedAt: new Date().toISOString() }, { merge: true });
          count++;
        }
        await batch.commit();
      }
      Alert.alert("Import Complete", `${count} printer${count !== 1 ? "s" : ""} imported/updated.`);
    } catch (err: any) { Alert.alert("Import Failed", err.message || "An unexpected error occurred."); } finally { setImporting(false); }
  };

  const renderItem = ({ item }: { item: Printer }) => (
    <View style={[inventoryStyles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Pressable style={{ flex: 1 }} onPress={() => openEdit(item)}>
        <Text style={[inventoryStyles.itemName, { color: theme.text }]}>{item.name}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
          <Ionicons name="location-outline" size={14} color={theme.mutedText} style={{ marginRight: 4 }} />
          <Text style={{ color: theme.mutedText, fontSize: 12 }}>{item.location || "No location"}</Text>
          {item.roomNumber ? <Text style={{ color: theme.mutedText, fontSize: 12, marginLeft: 6 }}>· Rm {item.roomNumber}</Text> : null}
        </View>
        {(item.toshibaId || item.assetNumber) ? (
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 3, gap: 10 }}>
            {item.toshibaId ? (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Ionicons name="barcode-outline" size={12} color={theme.mutedText} style={{ marginRight: 3 }} />
                <Text style={{ color: theme.mutedText, fontSize: 11 }}>{item.toshibaId}</Text>
              </View>
            ) : null}
            {item.assetNumber ? (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Ionicons name="pricetag-outline" size={12} color={theme.mutedText} style={{ marginRight: 3 }} />
                <Text style={{ color: theme.mutedText, fontSize: 11 }}>{item.assetNumber}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        {item.tonerSeries ? (
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
            <Ionicons name="print-outline" size={12} color={theme.mutedText} style={{ marginRight: 3 }} />
            <Text style={{ color: theme.mutedText, fontSize: 11 }}>#{item.tonerSeries}</Text>
          </View>
        ) : null}
        {item.tonerId && <View style={{ marginTop: 6 }}><TonerStockBadge tonerId={item.tonerId} theme={theme} /></View>}
      </Pressable>
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: theme.text, fontWeight: "700", fontSize: 14 }}>{item.ipAddress || "No IP"}</Text>
          <Pressable onPress={() => remove(item)} hitSlop={8} style={{ padding: 4 }}>
            <Ionicons name="trash-outline" size={18} color="#ef4444" />
          </Pressable>
        </View>
        {item.tonerId ? (
          <>
            <Pressable hitSlop={8} style={[inventoryStyles.actionButton, { backgroundColor: "#ef4444" }]} onPress={() => handleDeductToner(item)}>
              <Text style={inventoryStyles.actionButtonText}>DEDUCT 1</Text>
            </Pressable>
            <Pressable hitSlop={8} style={[inventoryStyles.actionButton, { backgroundColor: "#f59e0b" }]} onPress={() => handleUnlinkToner(item)}>
              <Text style={inventoryStyles.actionButtonText}>UNLINK</Text>
            </Pressable>
          </>
        ) : (
          <Pressable hitSlop={8} style={[inventoryStyles.actionButton, { backgroundColor: theme.primary }]} onPress={() => { setSelectedPrinter(item); setTonerLinkSearch(""); setShowLinkModal(true); }}>
            <Text style={inventoryStyles.actionButtonText}>LINK TONER</Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  const formFields = [
    { label: "Name *", key: "name", placeholder: "Printer name" },
    { label: "Location / Dept", key: "location", placeholder: "e.g. CAGE, FINANCE" },
    { label: "Room #", key: "roomNumber", placeholder: "e.g. 1327" },
    { label: "IP Address", key: "ipAddress", placeholder: "192.168.x.x" },
    { label: "Toshiba / BAL #", key: "toshibaId", placeholder: "e.g. BAL0810" },
    { label: "Asset Number", key: "assetNumber", placeholder: "Asset #" },
    { label: "Serial", key: "serial", placeholder: "Serial #" },
    { label: "Toner Series", key: "tonerSeries", placeholder: "e.g. 1234-series" },
    { label: "Barcode", key: "barcode", placeholder: "Barcode" },
  ];

  return (
    <>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16 }}
        ListHeaderComponent={
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <Pressable onPress={importCSV} disabled={importing} style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, flex: 1 }]}>
                {importing ? <ActivityIndicator size="small" color={theme.text} /> : <><Ionicons name="cloud-upload-outline" size={16} color={theme.text} style={{ marginRight: 6 }} /><Text style={[inventoryStyles.importBtnText, { color: theme.text }]}>Import CSV</Text></>}
              </Pressable>
              <Pressable onPress={() => downloadPrinterTemplate().catch((e) => Alert.alert("Error", e.message))} style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12 }]}>
                <Ionicons name="document-outline" size={18} color={theme.text} />
              </Pressable>
              <Pressable onPress={() => { setEditing(null); setForm(emptyForm); setShowModal(true); }} style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12 }]}>
                <Ionicons name="add" size={18} color={theme.text} />
              </Pressable>
            </View>
            <TextInput style={[inventoryStyles.searchInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]} placeholder="Search printers..." placeholderTextColor={theme.mutedText} value={search} onChangeText={setSearch} />
          </>
        }
      />

      {/* Printer Modal */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowModal(false)}>
        <View style={[inventoryStyles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={inventoryStyles.modalHeader}>
            <Text style={[inventoryStyles.modalTitle, { color: theme.text }]}>{editing ? "Edit Printer" : "Add Printer"}</Text>
            <Pressable onPress={() => setShowModal(false)}><Ionicons name="close" size={24} color={theme.text} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {formFields.map(({ label, key, placeholder }) => (
              <View key={key}>
                <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>{label}</Text>
                <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]} placeholder={placeholder} placeholderTextColor={theme.mutedText} value={(form as any)[key]} onChangeText={(v) => setForm((p) => ({ ...p, [key]: v }))} />
              </View>
            ))}
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Notes</Text>
            <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, height: 100 }]} placeholder="Notes" placeholderTextColor={theme.mutedText} multiline value={form.notes} onChangeText={(v) => setForm((p) => ({ ...p, notes: v }))} />
            <Pressable style={[inventoryStyles.saveBtn, { backgroundColor: theme.primary }]} onPress={save}>
              <Text style={inventoryStyles.saveBtnText}>{editing ? "Update Printer" : "Add Printer"}</Text>
            </Pressable>
            {editing && (
              <Pressable style={[inventoryStyles.saveBtn, { backgroundColor: "transparent", borderWidth: 1, borderColor: "#ef4444", marginTop: 8 }]} onPress={() => remove(editing)}>
                <Text style={[inventoryStyles.saveBtnText, { color: "#ef4444" }]}>Delete Printer</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Link Toner Modal */}
      <Modal visible={showLinkModal} animationType="slide" transparent={true} onRequestClose={() => setShowLinkModal(false)}>
        <View style={inventoryStyles.modalOverlay}>
          <View style={[inventoryStyles.linkModalContent, { backgroundColor: theme.card }]}>
            <Text style={[inventoryStyles.modalTitle, { color: theme.text, marginBottom: 12 }]}>Link Toner to {selectedPrinter?.name}</Text>
            <TextInput style={[inventoryStyles.searchInput, { backgroundColor: theme.background, color: theme.text, borderColor: theme.border }]} placeholder="Search toners..." placeholderTextColor={theme.mutedText} value={tonerLinkSearch} onChangeText={setTonerLinkSearch} />
            <ScrollView style={{ maxHeight: 380 }}>
              {filteredLinkList.map((t) => (
                <Pressable key={t.id} style={[inventoryStyles.linkItem, { borderBottomColor: theme.border }]} onPress={() => handleLinkToner(t)}>
                  <Text style={{ color: theme.text, fontWeight: "700", fontSize: 15 }}>{t.name}</Text>
                  <Text style={{ color: theme.mutedText, fontSize: 12, marginTop: 2 }}>Stock: {t.stock}</Text>
                </Pressable>
              ))}
              {filteredLinkList.length === 0 && <Text style={{ color: theme.mutedText, textAlign: "center", marginTop: 24 }}>No toners found.</Text>}
            </ScrollView>
            <Pressable style={{ marginTop: 16, alignItems: "center" }} onPress={() => setShowLinkModal(false)}>
              <Text style={{ color: theme.tint, fontWeight: "800", fontSize: 16 }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}
