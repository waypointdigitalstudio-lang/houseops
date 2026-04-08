import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
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
import { Radio, RadioPart, RadioSubTab } from "../types/inventory";
import { normalizeCell, parseCSV, downloadRadioTemplate, downloadRadioPartTemplate } from "../utils/csvHelpers";

export interface RadioSectionRef {
  openRadioModal: (radio?: Radio) => void;
  openAddRadioPart: (barcode: string) => void;
}

interface RadioSectionProps {
  siteId: string | null;
}

const CONDITION_COLOR: Record<string, string> = {
  Good: "#22c55e",
  Fair: "#f59e0b",
  Poor: "#ef4444",
  "Out of Service": "#6b7280",
};

const RadioSection = forwardRef<RadioSectionRef, RadioSectionProps>(({ siteId }, ref) => {
  const router = useRouter();
  const theme = useAppTheme();

  const [radioSubTab, setRadioSubTab] = useState<RadioSubTab>("parts");
  const [radios, setRadios] = useState<Radio[]>([]);
  const [radioParts, setRadioParts] = useState<RadioPart[]>([]);
  const [radioSearch, setRadioSearch] = useState("");
  const [radioPartSearch, setRadioPartSearch] = useState("");
  const [importingRadios, setImportingRadios] = useState(false);
  const [importingRadioParts, setImportingRadioParts] = useState(false);

  const [showRadioModal, setShowRadioModal] = useState(false);
  const [editingRadio, setEditingRadio] = useState<Radio | null>(null);
  const [radioForm, setRadioForm] = useState({
    model: "", serialNumber: "", channel: "", assignedTo: "",
    location: "", condition: "Good", barcode: "", notes: "",
  });

  const [showRadioPartModal, setShowRadioPartModal] = useState(false);
  const [editingRadioPart, setEditingRadioPart] = useState<RadioPart | null>(null);
  const [radioPartForm, setRadioPartForm] = useState({
    name: "", compatibleModel: "", quantity: "", minQuantity: "",
    location: "", barcode: "", notes: "",
  });

  // Firestore listeners
  useEffect(() => {
    if (!siteId) return;
    const qRadios = query(collection(db, "radios"), where("siteId", "==", siteId));
    const unsubRadios = onSnapshot(qRadios, (snap) => {
      setRadios(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Radio)));
    });
    const qParts = query(collection(db, "radioParts"), where("siteId", "==", siteId));
    const unsubParts = onSnapshot(qParts, (snap) => {
      setRadioParts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RadioPart)));
    });
    return () => { unsubRadios(); unsubParts(); };
  }, [siteId]);

  const filteredRadios = useMemo(() => {
    if (!radioSearch) return [...radios].sort((a, b) => a.model.localeCompare(b.model));
    const q = radioSearch.toLowerCase();
    return radios
      .filter((r) => r.model.toLowerCase().includes(q) || r.serialNumber?.toLowerCase().includes(q) || r.assignedTo?.toLowerCase().includes(q))
      .sort((a, b) => a.model.localeCompare(b.model));
  }, [radios, radioSearch]);

  const filteredRadioParts = useMemo(() => {
    if (!radioPartSearch) return [...radioParts].sort((a, b) => a.name.localeCompare(b.name));
    const q = radioPartSearch.toLowerCase();
    return radioParts
      .filter((p) => p.name.toLowerCase().includes(q) || p.compatibleModel?.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [radioParts, radioPartSearch]);

  const openRadioModal = useCallback((radio?: Radio) => {
    setEditingRadio(radio ?? null);
    setRadioForm(radio ? {
      model: radio.model, serialNumber: radio.serialNumber ?? "", channel: radio.channel ?? "",
      assignedTo: radio.assignedTo ?? "", location: radio.location ?? "",
      condition: radio.condition ?? "Good", barcode: radio.barcode ?? "", notes: radio.notes ?? "",
    } : { model: "", serialNumber: "", channel: "", assignedTo: "", location: "", condition: "Good", barcode: "", notes: "" });
    setShowRadioModal(true);
  }, []);

  const openAddRadioPart = useCallback((barcode: string) => {
    setRadioSubTab("parts");
    setEditingRadioPart(null);
    setRadioPartForm({ name: "", compatibleModel: "", quantity: "", minQuantity: "", location: "", barcode, notes: "" });
    setShowRadioPartModal(true);
  }, []);

  // Expose methods for scanner in parent
  useImperativeHandle(ref, () => ({ openRadioModal, openAddRadioPart }), [openRadioModal, openAddRadioPart]);

  const saveRadio = useCallback(async () => {
    if (!radioForm.model.trim()) { Alert.alert("Error", "Model is required."); return; }
    const data = {
      model: radioForm.model.trim(), serialNumber: radioForm.serialNumber.trim(),
      channel: radioForm.channel.trim(), assignedTo: radioForm.assignedTo.trim(),
      location: radioForm.location.trim(), condition: radioForm.condition,
      barcode: radioForm.barcode.trim(), notes: radioForm.notes.trim(),
      siteId: siteId || "default",
    };
    try {
      if (editingRadio) { await updateDoc(doc(db, "radios", editingRadio.id), data); }
      else { await addDoc(collection(db, "radios"), { ...data, createdAt: serverTimestamp() }); }
      setShowRadioModal(false);
    } catch (err: any) { Alert.alert("Error", err.message || "Failed to save radio."); }
  }, [radioForm, editingRadio, siteId]);

  const deleteRadio = useCallback((radio: Radio) => {
    Alert.alert("Delete Radio", `Remove ${radio.model}${radio.serialNumber ? ` (${radio.serialNumber})` : ""}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => { try { await deleteDoc(doc(db, "radios", radio.id)); } catch (err: any) { Alert.alert("Error", err.message); } } },
    ]);
  }, []);

  const openRadioPartModal = useCallback((part?: RadioPart) => {
    setEditingRadioPart(part ?? null);
    setRadioPartForm(part ? {
      name: part.name, compatibleModel: part.compatibleModel ?? "",
      quantity: String(part.quantity), minQuantity: String(part.minQuantity ?? 0),
      location: part.location ?? "", barcode: part.barcode ?? "", notes: part.notes ?? "",
    } : { name: "", compatibleModel: "", quantity: "", minQuantity: "", location: "", barcode: "", notes: "" });
    setShowRadioPartModal(true);
  }, []);

  const saveRadioPart = useCallback(async () => {
    if (!radioPartForm.name.trim()) { Alert.alert("Error", "Part name is required."); return; }
    const data = {
      name: radioPartForm.name.trim(), compatibleModel: radioPartForm.compatibleModel.trim(),
      quantity: parseInt(radioPartForm.quantity) || 0,
      minQuantity: parseInt(radioPartForm.minQuantity) || 0,
      location: radioPartForm.location.trim(), barcode: radioPartForm.barcode.trim(),
      notes: radioPartForm.notes.trim(), siteId: siteId || "default",
    };
    try {
      if (editingRadioPart) { await updateDoc(doc(db, "radioParts", editingRadioPart.id), data); }
      else { await addDoc(collection(db, "radioParts"), { ...data, createdAt: serverTimestamp() }); }
      setShowRadioPartModal(false);
    } catch (err: any) { Alert.alert("Error", err.message || "Failed to save part."); }
  }, [radioPartForm, editingRadioPart, siteId]);

  const deleteRadioPart = useCallback((part: RadioPart) => {
    Alert.alert("Delete Part", `Remove ${part.name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => { try { await deleteDoc(doc(db, "radioParts", part.id)); } catch (err: any) { Alert.alert("Error", err.message); } } },
    ]);
  }, []);

  const importRadiosFromCSV = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "text/plain"] });
      if (result.canceled) return;
      setImportingRadios(true);
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const rows = parseCSV(content);
      if (rows.length < 2) { Alert.alert("Empty File", "No data rows found in the CSV."); return; }
      const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, ""));
      const col = (names: string[]) => { for (const n of names) { const idx = headers.findIndex((h) => h.includes(n)); if (idx !== -1) return idx; } return -1; };
      const iModel = col(["model", "name", "radio"]);
      const iSerial = col(["serial", "serialnumber", "sn"]);
      const iChannel = col(["channel", "chan"]);
      const iAssigned = col(["assigned", "assignedto", "user", "person"]);
      const iLocation = col(["location", "loc"]);
      const iCondition = col(["condition", "status", "state"]);
      const iNotes = col(["notes", "note"]);
      if (iModel === -1) { Alert.alert("Import Failed", "Could not find a 'Model' or 'Name' column."); return; }
      const VALID_CONDITIONS = ["Good", "Fair", "Poor", "Out of Service"];
      const dataRows = rows.slice(1).filter((row) => normalizeCell(row[iModel] ?? "") !== "");
      let count = 0;
      for (let i = 0; i < dataRows.length; i += 499) {
        const chunk = dataRows.slice(i, i + 499);
        const batch = writeBatch(db);
        for (const row of chunk) {
          const model = normalizeCell(row[iModel] ?? "");
          if (!model) continue;
          const rawCondition = normalizeCell(row[iCondition] ?? "Good");
          const condition = VALID_CONDITIONS.find((c) => c.toLowerCase() === rawCondition.toLowerCase()) || "Good";
          const docRef = doc(db, "radios", `${siteId}_${model}_${normalizeCell(row[iSerial] ?? count.toString())}`
            .toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 100));
          batch.set(docRef, { model, serialNumber: normalizeCell(row[iSerial] ?? ""), channel: normalizeCell(row[iChannel] ?? ""), assignedTo: normalizeCell(row[iAssigned] ?? ""), location: normalizeCell(row[iLocation] ?? ""), condition, notes: normalizeCell(row[iNotes] ?? ""), siteId: siteId || "default", importedAt: new Date().toISOString() }, { merge: true });
          count++;
        }
        await batch.commit();
      }
      Alert.alert("Import Complete", `${count} radio${count !== 1 ? "s" : ""} imported/updated.`);
    } catch (err: any) {
      Alert.alert("Import Failed", err.message || "An unexpected error occurred.");
    } finally {
      setImportingRadios(false);
    }
  };

  const importRadioPartsFromCSV = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "text/plain"] });
      if (result.canceled) return;
      setImportingRadioParts(true);
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const rows = parseCSV(content);
      if (rows.length < 2) { Alert.alert("Empty File", "No data rows found in the CSV."); return; }
      const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, ""));
      const col = (names: string[]) => { for (const n of names) { const idx = headers.findIndex((h) => h.includes(n)); if (idx !== -1) return idx; } return -1; };
      const iName = col(["name", "part", "item"]);
      const iCompat = col(["compatible", "model", "compatiblemodel"]);
      const iQty = col(["qty", "quantity", "amount", "stock"]);
      const iMin = col(["min", "minimum", "minqty"]);
      const iLocation = col(["location", "loc"]);
      const iNotes = col(["notes", "note"]);
      if (iName === -1) { Alert.alert("Import Failed", "Could not find a 'Name' or 'Part' column."); return; }
      const dataRows = rows.slice(1).filter((row) => normalizeCell(row[iName] ?? "") !== "");
      let count = 0;
      for (let i = 0; i < dataRows.length; i += 499) {
        const chunk = dataRows.slice(i, i + 499);
        const batch = writeBatch(db);
        for (const row of chunk) {
          const name = normalizeCell(row[iName] ?? "");
          if (!name) continue;
          const docRef = doc(db, "radioParts", `${siteId}_${name}`.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 100));
          batch.set(docRef, { name, compatibleModel: normalizeCell(row[iCompat] ?? ""), quantity: parseInt(normalizeCell(row[iQty] ?? "")) || 0, minQuantity: parseInt(normalizeCell(row[iMin] ?? "")) || 0, location: normalizeCell(row[iLocation] ?? ""), notes: normalizeCell(row[iNotes] ?? ""), siteId: siteId || "default", importedAt: new Date().toISOString() }, { merge: true });
          count++;
        }
        await batch.commit();
      }
      Alert.alert("Import Complete", `${count} part${count !== 1 ? "s" : ""} imported/updated.`);
    } catch (err: any) {
      Alert.alert("Import Failed", err.message || "An unexpected error occurred.");
    } finally {
      setImportingRadioParts(false);
    }
  };

  const exportRadiosToCSV = async () => {
    try {
      if (radios.length === 0) { Alert.alert("Nothing to export", "No radios to export."); return; }
      const header = "Model,Serial Number,Channel,Assigned To,Location,Condition,Notes";
      const rows = radios.map((r) =>
        [r.model, r.serialNumber ?? "", r.channel ?? "", r.assignedTo ?? "", r.location ?? "", r.condition ?? "", r.notes ?? ""]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
      );
      const csv = [header, ...rows].join("\n");
      const uri = FileSystem.cacheDirectory + "radios_export.csv";
      await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Export Radios CSV" });
    } catch (err: any) { Alert.alert("Export Failed", err.message || "An unexpected error occurred."); }
  };

  const exportRadioPartsToCSV = async () => {
    try {
      if (radioParts.length === 0) { Alert.alert("Nothing to export", "No radio parts to export."); return; }
      const header = "Name,Compatible Model,Quantity,Min Quantity,Location,Notes";
      const rows = radioParts.map((p) =>
        [p.name, p.compatibleModel ?? "", String(p.quantity), String(p.minQuantity ?? 0), p.location ?? "", p.notes ?? ""]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
      );
      const csv = [header, ...rows].join("\n");
      const uri = FileSystem.cacheDirectory + "radio_parts_export.csv";
      await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Export Radio Parts CSV" });
    } catch (err: any) { Alert.alert("Export Failed", err.message || "An unexpected error occurred."); }
  };

  const renderRadio = useCallback(({ item }: { item: Radio }) => (
    <View style={[inventoryStyles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Pressable onPress={() => openRadioModal(item)} style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
          <Text style={[inventoryStyles.itemName, { color: theme.text }]}>{item.model}</Text>
          {item.condition ? (
            <View style={{ marginLeft: 8, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: (CONDITION_COLOR[item.condition] ?? "#6b7280") + "22" }}>
              <Text style={{ color: CONDITION_COLOR[item.condition] ?? "#6b7280", fontSize: 10, fontWeight: "700" }}>{item.condition}</Text>
            </View>
          ) : null}
        </View>
        {item.serialNumber ? <Text style={{ color: theme.mutedText, fontSize: 12 }}>S/N: {item.serialNumber}</Text> : null}
        {item.channel ? <Text style={{ color: theme.mutedText, fontSize: 12 }}>Ch: {item.channel}</Text> : null}
        {item.assignedTo ? <Text style={{ color: theme.mutedText, fontSize: 12 }}>Assigned: {item.assignedTo}</Text> : null}
        {item.location ? (
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
            <Ionicons name="location-outline" size={12} color={theme.mutedText} style={{ marginRight: 3 }} />
            <Text style={{ color: theme.mutedText, fontSize: 12 }}>{item.location}</Text>
          </View>
        ) : null}
        {item.notes ? <Text style={{ color: theme.mutedText, fontSize: 11, fontStyle: "italic", marginTop: 3 }} numberOfLines={1}>{item.notes}</Text> : null}
      </Pressable>
      <Pressable onPress={() => deleteRadio(item)} hitSlop={8} style={{ padding: 6 }}>
        <Ionicons name="trash-outline" size={20} color="#ef4444" />
      </Pressable>
    </View>
  ), [theme, openRadioModal, deleteRadio]);

  const renderRadioPart = useCallback(({ item }: { item: RadioPart }) => (
    <View style={[inventoryStyles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Pressable onPress={() => router.push(`/radiopart/${item.id}` as any)} style={{ flex: 1 }}>
        <Text style={[inventoryStyles.itemName, { color: theme.text }]}>{item.name}</Text>
        {item.compatibleModel ? <Text style={{ color: theme.mutedText, fontSize: 12 }}>Compatible: {item.compatibleModel}</Text> : null}
        {item.location ? (
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
            <Ionicons name="location-outline" size={12} color={theme.mutedText} style={{ marginRight: 3 }} />
            <Text style={{ color: theme.mutedText, fontSize: 12 }}>{item.location}</Text>
          </View>
        ) : null}
        {item.notes ? <Text style={{ color: theme.mutedText, fontSize: 11, fontStyle: "italic", marginTop: 3 }} numberOfLines={1}>{item.notes}</Text> : null}
      </Pressable>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={{ color: theme.text, fontWeight: "800", fontSize: 18 }}>{item.quantity}</Text>
        <Text style={{ color: theme.mutedText, fontSize: 10 }}>QTY</Text>
      </View>
      <Pressable onPress={() => deleteRadioPart(item)} hitSlop={8} style={{ padding: 6 }}>
        <Ionicons name="trash-outline" size={20} color="#ef4444" />
      </Pressable>
    </View>
  ), [theme, router, deleteRadioPart]);

  return (
    <View style={{ flex: 1 }}>
      {/* Sub-tab bar */}
      <View style={{ flexDirection: "row", paddingHorizontal: 16, marginBottom: 12, gap: 12 }}>
        <Pressable
          onPress={() => setRadioSubTab("parts")}
          style={{ flex: 1, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: radioSubTab === "parts" ? theme.text : "transparent" }}
        >
          <Text style={{ textAlign: "center", color: radioSubTab === "parts" ? theme.text : theme.mutedText, fontWeight: "700" }}>
            Parts ({radioParts.length})
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setRadioSubTab("radios")}
          style={{ flex: 1, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: radioSubTab === "radios" ? theme.text : "transparent" }}
        >
          <Text style={{ textAlign: "center", color: radioSubTab === "radios" ? theme.text : theme.mutedText, fontWeight: "700" }}>
            Radios ({radios.length})
          </Text>
        </Pressable>
      </View>

      {radioSubTab === "radios" ? (
        <FlatList
          data={filteredRadios}
          keyExtractor={(item) => item.id}
          renderItem={renderRadio}
          contentContainerStyle={{ padding: 16 }}
          ListHeaderComponent={
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <TextInput
                  style={[inventoryStyles.searchInput, { flex: 1, backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
                  placeholder="Search radios..."
                  placeholderTextColor={theme.mutedText}
                  value={radioSearch}
                  onChangeText={setRadioSearch}
                />
                <Pressable onPress={() => openRadioModal()} style={[inventoryStyles.addTonerBtn, { backgroundColor: theme.text }]}>
                  <Ionicons name="add" size={24} color={theme.background} />
                </Pressable>
              </View>
              <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
                <Pressable
                  onPress={importRadiosFromCSV}
                  disabled={importingRadios}
                  style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, flex: 1, marginBottom: 0 }]}
                >
                  {importingRadios
                    ? <ActivityIndicator size="small" color={theme.text} />
                    : <><Ionicons name="cloud-upload-outline" size={16} color={theme.text} style={{ marginRight: 6 }} /><Text style={[inventoryStyles.importBtnText, { color: theme.text }]}>Import CSV</Text></>
                  }
                </Pressable>
                <Pressable
                  onPress={exportRadiosToCSV}
                  style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, flex: 1, marginBottom: 0 }]}
                >
                  <Ionicons name="cloud-download-outline" size={16} color={theme.text} style={{ marginRight: 6 }} />
                  <Text style={[inventoryStyles.importBtnText, { color: theme.text }]}>Export CSV</Text>
                </Pressable>
                <Pressable
                  onPress={() => downloadRadioTemplate().catch((e) => Alert.alert("Error", e.message))}
                  style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12, marginBottom: 0 }]}
                >
                  <Ionicons name="document-outline" size={18} color={theme.text} />
                </Pressable>
              </View>
            </>
          }
          ListEmptyComponent={<Text style={{ color: theme.mutedText, textAlign: "center", marginTop: 40 }}>No radios yet. Tap + to add one.</Text>}
        />
      ) : (
        <FlatList
          data={filteredRadioParts}
          keyExtractor={(item) => item.id}
          renderItem={renderRadioPart}
          contentContainerStyle={{ padding: 16 }}
          ListHeaderComponent={
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <TextInput
                  style={[inventoryStyles.searchInput, { flex: 1, backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
                  placeholder="Search parts..."
                  placeholderTextColor={theme.mutedText}
                  value={radioPartSearch}
                  onChangeText={setRadioPartSearch}
                />
                <Pressable onPress={() => openRadioPartModal()} style={[inventoryStyles.addTonerBtn, { backgroundColor: theme.text }]}>
                  <Ionicons name="add" size={24} color={theme.background} />
                </Pressable>
              </View>
              <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
                <Pressable
                  onPress={importRadioPartsFromCSV}
                  disabled={importingRadioParts}
                  style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, flex: 1, marginBottom: 0 }]}
                >
                  {importingRadioParts
                    ? <ActivityIndicator size="small" color={theme.text} />
                    : <><Ionicons name="cloud-upload-outline" size={16} color={theme.text} style={{ marginRight: 6 }} /><Text style={[inventoryStyles.importBtnText, { color: theme.text }]}>Import CSV</Text></>
                  }
                </Pressable>
                <Pressable
                  onPress={exportRadioPartsToCSV}
                  style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, flex: 1, marginBottom: 0 }]}
                >
                  <Ionicons name="cloud-download-outline" size={16} color={theme.text} style={{ marginRight: 6 }} />
                  <Text style={[inventoryStyles.importBtnText, { color: theme.text }]}>Export CSV</Text>
                </Pressable>
                <Pressable
                  onPress={() => downloadRadioPartTemplate().catch((e) => Alert.alert("Error", e.message))}
                  style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12, marginBottom: 0 }]}
                >
                  <Ionicons name="document-outline" size={18} color={theme.text} />
                </Pressable>
              </View>
            </>
          }
          ListEmptyComponent={<Text style={{ color: theme.mutedText, textAlign: "center", marginTop: 40 }}>No parts yet. Tap + to add one.</Text>}
        />
      )}

      {/* Radio Modal */}
      <Modal visible={showRadioModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowRadioModal(false)}>
        <View style={[inventoryStyles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={inventoryStyles.modalHeader}>
            <Text style={[inventoryStyles.modalTitle, { color: theme.text }]}>{editingRadio ? "Edit Radio" : "Add Radio"}</Text>
            <Pressable onPress={() => setShowRadioModal(false)}><Ionicons name="close" size={24} color={theme.text} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {[
              { label: "Model *", key: "model", placeholder: "e.g. Motorola RDU2020" },
              { label: "Serial Number", key: "serialNumber", placeholder: "e.g. 123ABC" },
              { label: "Channel", key: "channel", placeholder: "e.g. Ch 3" },
              { label: "Assigned To", key: "assignedTo", placeholder: "e.g. John Smith" },
              { label: "Location", key: "location", placeholder: "e.g. Security Desk" },
              { label: "Barcode / SKU", key: "barcode", placeholder: "e.g. 123456789012" },
            ].map(({ label, key, placeholder }) => (
              <View key={key}>
                <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>{label}</Text>
                <TextInput
                  style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                  placeholder={placeholder}
                  placeholderTextColor={theme.mutedText}
                  value={(radioForm as any)[key]}
                  onChangeText={(v) => setRadioForm((p) => ({ ...p, [key]: v }))}
                />
              </View>
            ))}
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Condition</Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {["Good", "Fair", "Poor", "Out of Service"].map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setRadioForm((p) => ({ ...p, condition: c }))}
                  style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: radioForm.condition === c ? theme.tint : theme.border, backgroundColor: radioForm.condition === c ? theme.tint + "22" : theme.card }}
                >
                  <Text style={{ color: radioForm.condition === c ? theme.tint : theme.mutedText, fontWeight: "700", fontSize: 13 }}>{c}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Notes</Text>
            <TextInput
              style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, height: 80, textAlignVertical: "top" }]}
              placeholder="Additional notes..."
              placeholderTextColor={theme.mutedText}
              multiline
              value={radioForm.notes}
              onChangeText={(v) => setRadioForm((p) => ({ ...p, notes: v }))}
            />
            <Pressable style={[inventoryStyles.saveBtn, { backgroundColor: theme.primary }]} onPress={saveRadio}>
              <Text style={{ color: "#000", fontWeight: "800", fontSize: 16 }}>{editingRadio ? "Save Changes" : "Add Radio"}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {/* Radio Part Modal */}
      <Modal visible={showRadioPartModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowRadioPartModal(false)}>
        <View style={[inventoryStyles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={inventoryStyles.modalHeader}>
            <Text style={[inventoryStyles.modalTitle, { color: theme.text }]}>{editingRadioPart ? "Edit Part" : "Add Radio Part"}</Text>
            <Pressable onPress={() => setShowRadioPartModal(false)}><Ionicons name="close" size={24} color={theme.text} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {[
              { label: "Part Name *", key: "name", placeholder: "e.g. Belt Clip" },
              { label: "Compatible Model", key: "compatibleModel", placeholder: "e.g. Motorola RDU2020" },
              { label: "Location", key: "location", placeholder: "e.g. Storage Room B" },
              { label: "Barcode / SKU", key: "barcode", placeholder: "e.g. 123456789012" },
            ].map(({ label, key, placeholder }) => (
              <View key={key}>
                <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>{label}</Text>
                <TextInput
                  style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                  placeholder={placeholder}
                  placeholderTextColor={theme.mutedText}
                  value={(radioPartForm as any)[key]}
                  onChangeText={(v) => setRadioPartForm((p) => ({ ...p, [key]: v }))}
                />
              </View>
            ))}
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Quantity</Text>
            <TextInput
              style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="0"
              placeholderTextColor={theme.mutedText}
              keyboardType="numeric"
              value={radioPartForm.quantity}
              onChangeText={(v) => setRadioPartForm((p) => ({ ...p, quantity: v }))}
            />
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Min Quantity</Text>
            <TextInput
              style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="0"
              placeholderTextColor={theme.mutedText}
              keyboardType="numeric"
              value={radioPartForm.minQuantity}
              onChangeText={(v) => setRadioPartForm((p) => ({ ...p, minQuantity: v }))}
            />
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Notes</Text>
            <TextInput
              style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, height: 80, textAlignVertical: "top" }]}
              placeholder="Additional notes..."
              placeholderTextColor={theme.mutedText}
              multiline
              value={radioPartForm.notes}
              onChangeText={(v) => setRadioPartForm((p) => ({ ...p, notes: v }))}
            />
            <Pressable style={[inventoryStyles.saveBtn, { backgroundColor: theme.primary }]} onPress={saveRadioPart}>
              <Text style={{ color: "#000", fontWeight: "800", fontSize: 16 }}>{editingRadioPart ? "Save Changes" : "Add Part"}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
});

RadioSection.displayName = "RadioSection";
export default RadioSection;
