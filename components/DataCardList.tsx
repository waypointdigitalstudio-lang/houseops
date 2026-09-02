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
  setDoc,
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
import { DataCardPrinter } from "../types/inventory";
import { downloadDatacardTemplate, makeColFinder, normalizeCell, parseCSV } from "../utils/csvHelpers";

interface DataCardListProps {
  siteId: string | null;
}

const emptyForm = { name: "", location: "", ipAddress: "", assetNumber: "", serial: "", ribbonType: "", notes: "" };

export default function DataCardList({ siteId }: DataCardListProps) {
  const theme = useAppTheme();

  const [datacardPrinters, setDatacardPrinters] = useState<DataCardPrinter[]>([]);
  const [datacardSearch, setDatacardSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<DataCardPrinter | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!siteId) return;
    const q = query(collection(db, "datacardPrinters"), where("siteId", "==", siteId));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as DataCardPrinter));
      setDatacardPrinters(list.sort((a, b) => a.name.localeCompare(b.name)));
    }, (err) => { if (__DEV__) console.error("datacardPrinters onSnapshot error:", err); });
    return () => unsub();
  }, [siteId]);

  const filtered = useMemo(() => {
    if (!datacardSearch) return datacardPrinters;
    const q = datacardSearch.toLowerCase();
    return datacardPrinters.filter(
      (p) => p.name.toLowerCase().includes(q) || p.location?.toLowerCase().includes(q) || p.ipAddress?.includes(q)
    );
  }, [datacardPrinters, datacardSearch]);

  const openAdd = () => { setEditing(null); setForm(emptyForm); setShowModal(true); };
  const openEdit = (item: DataCardPrinter) => {
    setEditing(item);
    setForm({ name: item.name || "", location: item.location || "", ipAddress: item.ipAddress || "", assetNumber: item.assetNumber || "", serial: item.serial || "", ribbonType: item.ribbonType || "", notes: item.notes || "" });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) { Alert.alert("Error", "Name is required."); return; }
    if (!siteId) { Alert.alert("Error", "No site assigned to your account."); return; }
    const data = { name: form.name.trim(), location: form.location.trim(), ipAddress: form.ipAddress.trim(), assetNumber: form.assetNumber.trim(), serial: form.serial.trim(), ribbonType: form.ribbonType.trim(), notes: form.notes.trim(), siteId };
    try {
      if (editing) { await setDoc(doc(db, "datacardPrinters", editing.id), data, { merge: true }); }
      else { await addDoc(collection(db, "datacardPrinters"), data); }
      setShowModal(false);
    } catch { Alert.alert("Error", "Failed to save data card printer."); }
  };

  const remove = (item: DataCardPrinter) => {
    Alert.alert("Delete Printer", `Remove ${item.name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await deleteDoc(doc(db, "datacardPrinters", item.id)); setShowModal(false); setEditing(null); }
        catch (err: any) { Alert.alert("Error", err.message || "Failed to delete."); }
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
      const iModel = col(["datacard", "model", "name"]);
      const iSerial = col(["serial", "sn", "serialnumber"]);
      const iLocation = col(["location", "loc"]);
      const iIp = col(["printerip", "ipaddress", "ip_address", "ip"]);
      const iAsset = col(["asset", "assetnumber"]);
      const iRibbon = col(["ribbon", "ribbontype"]);
      const iWarranty = col(["warranty"]);
      const iStatus = col(["status"]);
      const iMac = col(["mac", "macaddress"]);
      const iNotes = col(["notes", "note"]);
      if (iModel === -1 && iSerial === -1) { Alert.alert("Import Failed", "Could not find a model or serial number column."); return; }
      const idCol = iModel !== -1 ? iModel : iSerial;
      const dataRows = rows.slice(1).filter((row) => normalizeCell(row[idCol] ?? "") !== "");
      let count = 0;
      for (let i = 0; i < dataRows.length; i += 499) {
        const chunk = dataRows.slice(i, i + 499);
        const batch = writeBatch(db);
        for (const row of chunk) {
          const model = iModel !== -1 ? normalizeCell(row[iModel] ?? "") : "";
          const serial = iSerial !== -1 ? normalizeCell(row[iSerial] ?? "") : "";
          const name = model && serial ? `${model} - ${serial}` : model || serial;
          if (!name) continue;
          const noteParts: string[] = [];
          const warranty = iWarranty !== -1 ? normalizeCell(row[iWarranty] ?? "") : "";
          if (warranty) noteParts.push(`Warranty: ${warranty}`);
          const status = iStatus !== -1 ? normalizeCell(row[iStatus] ?? "") : "";
          if (status) noteParts.push(`Status: ${status}`);
          const mac = iMac !== -1 ? normalizeCell(row[iMac] ?? "") : "";
          if (mac) noteParts.push(`MAC: ${mac}`);
          const existingNotes = iNotes !== -1 ? normalizeCell(row[iNotes] ?? "") : "";
          if (existingNotes) noteParts.push(existingNotes);
          const stableId = `${siteId}_dc_${serial || name}`.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 100);
          batch.set(doc(db, "datacardPrinters", stableId), { name, location: normalizeCell(row[iLocation] ?? ""), ipAddress: normalizeCell(row[iIp] ?? ""), assetNumber: iAsset !== -1 ? normalizeCell(row[iAsset] ?? "") : "", serial, ribbonType: iRibbon !== -1 ? normalizeCell(row[iRibbon] ?? "") : "", notes: noteParts.join(" | "), siteId, importedAt: new Date().toISOString() }, { merge: true });
          count++;
        }
        await batch.commit();
      }
      Alert.alert("Import Complete", `${count} data card printer${count !== 1 ? "s" : ""} imported/updated.`);
    } catch (err: any) { Alert.alert("Import Failed", err.message || "An unexpected error occurred."); } finally { setImporting(false); }
  };

  const renderItem = ({ item }: { item: DataCardPrinter }) => (
    <View style={[inventoryStyles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Pressable style={{ flex: 1 }} onPress={() => openEdit(item)}>
        <Text style={[inventoryStyles.itemName, { color: theme.text }]}>{item.name}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
          <Ionicons name="location-outline" size={14} color={theme.mutedText} style={{ marginRight: 4 }} />
          <Text style={{ color: theme.mutedText, fontSize: 12 }}>{item.location || "No location"}</Text>
          {item.ribbonType && (
            <>
              <Ionicons name="pricetag-outline" size={12} color={theme.mutedText} style={{ marginLeft: 8, marginRight: 4 }} />
              <Text style={{ color: theme.mutedText, fontSize: 12 }}>{item.ribbonType}</Text>
            </>
          )}
        </View>
      </Pressable>
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        <Text style={{ color: theme.text, fontWeight: "700", fontSize: 14 }}>{item.ipAddress || "No IP"}</Text>
        <Pressable onPress={() => remove(item)} hitSlop={8} style={{ padding: 4 }}>
          <Ionicons name="trash-outline" size={18} color="#ef4444" />
        </Pressable>
      </View>
    </View>
  );

  const fields = [
    { label: "Name *", key: "name", placeholder: "Printer name" },
    { label: "Location", key: "location", placeholder: "Location" },
    { label: "IP Address", key: "ipAddress", placeholder: "192.168.x.x" },
    { label: "Asset Number", key: "assetNumber", placeholder: "Asset #" },
    { label: "Serial", key: "serial", placeholder: "Serial #" },
    { label: "Ribbon Type", key: "ribbonType", placeholder: "e.g. YMCKO, KO, Monochrome" },
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
              <Pressable onPress={() => downloadDatacardTemplate().catch((e) => Alert.alert("Error", e.message))} style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12 }]}>
                <Ionicons name="document-outline" size={18} color={theme.text} />
              </Pressable>
              <Pressable onPress={openAdd} style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12 }]}>
                <Ionicons name="add" size={18} color={theme.text} />
              </Pressable>
            </View>
            <TextInput style={[inventoryStyles.searchInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]} placeholder="Search data card printers..." placeholderTextColor={theme.mutedText} value={datacardSearch} onChangeText={setDatacardSearch} />
          </>
        }
        ListEmptyComponent={<Text style={{ color: theme.mutedText, textAlign: "center", marginTop: 40 }}>{datacardSearch ? "No results match." : "No data card printers yet. Tap + to add one."}</Text>}
      />

      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowModal(false)}>
        <View style={[inventoryStyles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={inventoryStyles.modalHeader}>
            <Text style={[inventoryStyles.modalTitle, { color: theme.text }]}>{editing ? "Edit Data Card Printer" : "Add Data Card Printer"}</Text>
            <Pressable onPress={() => setShowModal(false)}><Ionicons name="close" size={24} color={theme.text} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {fields.map(({ label, key, placeholder }) => (
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
    </>
  );
}
