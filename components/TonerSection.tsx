import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import React, {
  useCallback,
  useEffect,
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
  DataCardPrinter,
  Printer,
  Toner,
  TonerLink,
  TonerSubTab,
  TONER_COLORS,
  UNDO_ANIMATION_MS,
  UNDO_TIMEOUT_MS,
} from "../types/inventory";
import { getStockStatus, logActivity } from "../utils/activity";
import { normalizeCell, parseCSV, makeColFinder, downloadTonerTemplate, downloadPrinterTemplate, downloadDatacardTemplate } from "../utils/csvHelpers";
import TonerStockBadge from "./TonerStockBadge";

interface TonerSectionProps {
  siteId: string | null;
  onTonerCountChange: (count: number) => void;
}

export default function TonerSection({ siteId, onTonerCountChange }: TonerSectionProps) {
  const theme = useAppTheme();
  const router = useRouter();

  const [tonerSubTab, setTonerSubTab] = useState<TonerSubTab>("toners");

  // Toner state
  const [toners, setToners] = useState<Toner[]>([]);
  const [tonersLoading, setTonersLoading] = useState(true);
  const [tonerSearch, setTonerSearch] = useState("");
  const [showTonerLowOnly, setShowTonerLowOnly] = useState(false);
  const [showTonerModal, setShowTonerModal] = useState(false);
  const [editingToner, setEditingToner] = useState<Toner | null>(null);
  const [tonerForm, setTonerForm] = useState({ model: "", color: "Black", quantity: "", minQuantity: "", printer: "", notes: "", barcode: "" });

  // Toner undo state
  const [pendingTonerDelete, setPendingTonerDelete] = useState<{ toner: Toner; backup: any } | null>(null);
  const [hiddenTonerIds, setHiddenTonerIds] = useState<Set<string>>(new Set());
  const undoTonerAnim = useRef(new Animated.Value(0)).current;
  const undoTonerTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // Printer state
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [printersLoading, setPrintersLoading] = useState(true);
  const [importingPrinters, setImportingPrinters] = useState(false);
  const [printerSearch, setPrinterSearch] = useState("");
  const [showPrinterModal, setShowPrinterModal] = useState(false);
  const [editingPrinter, setEditingPrinter] = useState<Printer | null>(null);
  const [printerForm, setPrinterForm] = useState({ name: "", location: "", ipAddress: "", assetNumber: "", serial: "", tonerSeries: "", barcode: "", notes: "" });

  // Data Card Printer state
  const [datacardPrinters, setDatacardPrinters] = useState<DataCardPrinter[]>([]);
  const [datacardSearch, setDatacardSearch] = useState("");
  const [showDatacardModal, setShowDatacardModal] = useState(false);
  const [editingDatacard, setEditingDatacard] = useState<DataCardPrinter | null>(null);
  const [datacardForm, setDatacardForm] = useState({ name: "", location: "", ipAddress: "", assetNumber: "", serial: "", ribbonType: "", notes: "" });

  // Import state
  const [importingToners, setImportingToners] = useState(false);
  const [importingDatacardPrinters, setImportingDatacardPrinters] = useState(false);

  // Link Toner Modal state
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedPrinter, setSelectedPrinter] = useState<Printer | null>(null);
  const [tonerLinkSearch, setTonerLinkSearch] = useState("");
  const [tonerLinkList, setTonerLinkList] = useState<TonerLink[]>([]);

  // Mounted tracking + cleanup
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (undoTonerTimeoutRef.current) clearTimeout(undoTonerTimeoutRef.current);
    };
  }, []);

  // Firestore listeners
  useEffect(() => {
    if (!siteId) return;
    const q = query(collection(db, "toners"), where("siteId", "==", siteId));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Toner));
      setToners(list);
      setTonersLoading(false);
    }, (err) => { console.error("toners onSnapshot error:", err); setTonersLoading(false); });
    return () => unsub();
  }, [siteId]);

  useEffect(() => {
    if (!siteId) return;
    const q = query(collection(db, "printers"), where("siteId", "==", siteId));
    const unsub = onSnapshot(q, (snap) => {
      setPrinters(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Printer)));
      setPrintersLoading(false);
    }, (err) => { console.error("printers onSnapshot error:", err); setPrintersLoading(false); });
    return () => unsub();
  }, [siteId]);

  useEffect(() => {
    if (!siteId) return;
    const q = query(collection(db, "datacardPrinters"), where("siteId", "==", siteId));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as DataCardPrinter));
      setDatacardPrinters(list.sort((a, b) => a.name.localeCompare(b.name)));
    }, (err) => console.error("datacardPrinters onSnapshot error:", err));
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
    }, (err) => console.error("tonerLinkList onSnapshot error:", err));
    return () => unsub();
  }, [showLinkModal, siteId]);

  // Notify parent of visible toner count for summary stats
  useEffect(() => {
    const visibleCount = toners.filter((t) => !hiddenTonerIds.has(t.id)).length;
    onTonerCountChange(visibleCount);
  }, [toners, hiddenTonerIds, onTonerCountChange]);

  // Filtered lists
  const filteredToners = useMemo(() => {
    let list = toners.filter((t) => !hiddenTonerIds.has(t.id));
    if (tonerSearch) {
      const q = tonerSearch.toLowerCase();
      list = list.filter((t) => t.model.toLowerCase().includes(q) || t.printer?.toLowerCase().includes(q));
    }
    if (showTonerLowOnly) list = list.filter((t) => t.quantity <= t.minQuantity);
    return list.sort((a, b) => a.model.localeCompare(b.model));
  }, [toners, tonerSearch, showTonerLowOnly, hiddenTonerIds]);

  const filteredPrinters = useMemo(() => {
    if (!printerSearch) return printers.sort((a, b) => a.name.localeCompare(b.name));
    const q = printerSearch.toLowerCase();
    return printers
      .filter((p) => p.name.toLowerCase().includes(q) || p.location?.toLowerCase().includes(q) || p.ipAddress?.includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [printers, printerSearch]);

  const filteredDatacardPrinters = useMemo(() => {
    if (!datacardSearch) return datacardPrinters;
    const q = datacardSearch.toLowerCase();
    return datacardPrinters.filter(
      (p) => p.name.toLowerCase().includes(q) || p.location?.toLowerCase().includes(q) || p.ipAddress?.includes(q)
    );
  }, [datacardPrinters, datacardSearch]);

  const filteredTonerLinkList = useMemo(() => {
    if (!tonerLinkSearch) return tonerLinkList;
    return tonerLinkList.filter((t) => t.name.toLowerCase().includes(tonerLinkSearch.toLowerCase()));
  }, [tonerLinkList, tonerLinkSearch]);

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
        await logActivity({ siteId: siteId || "default", itemName: pendingTonerDelete.toner.model, itemId: pendingTonerDelete.toner.id, qty: 0, min: pendingTonerDelete.toner.minQuantity, prevState: prevStatus, nextState: "OUT", action: "deleted", itemType: "toner" });
      } catch (e) { console.error("Error committing previous toner delete:", e); }
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
        await logActivity({ siteId: siteId || "default", itemName: toner.model, itemId: toner.id, qty: 0, min: toner.minQuantity, prevState: prevStatus, nextState: "OUT", action: "deleted", itemType: "toner" });
      } catch (e) {
        console.error("Error during scheduled toner delete:", e);
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
    try { await setDoc(doc(db, "toners", toner.id), backup, { merge: true }); } catch (e) { console.error("Error restoring toner:", e); }
    dismissTonerUndoBanner();
  }, [pendingTonerDelete, dismissTonerUndoBanner]);

  // Toner CRUD
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
    const newQty = parseInt(tonerForm.quantity) || 0;
    const newMin = parseInt(tonerForm.minQuantity) || 0;
    const data = { ...tonerForm, quantity: newQty, minQuantity: newMin, siteId };
    try {
      if (editingToner) {
        const prevStatus = getStockStatus(editingToner.quantity, editingToner.minQuantity);
        const nextStatus = getStockStatus(newQty, newMin);
        await setDoc(doc(db, "toners", editingToner.id), data, { merge: true });
        await logActivity({ siteId: siteId || "default", itemName: data.model, itemId: editingToner.id, qty: newQty, min: newMin, prevState: prevStatus, nextState: nextStatus, action: "edited", itemType: "toner" });
      } else {
        const docRef = await addDoc(collection(db, "toners"), data);
        const nextStatus = getStockStatus(newQty, newMin);
        await logActivity({ siteId: siteId || "default", itemName: data.model, itemId: docRef.id, qty: newQty, min: newMin, prevState: "OK", nextState: nextStatus, action: "added", itemType: "toner" });
      }
      setShowTonerModal(false);
    } catch { Alert.alert("Error", "Failed to save toner."); }
  };

  // Printer CRUD
  const savePrinter = async () => {
    if (!printerForm.name) { Alert.alert("Error", "Name is required."); return; }
    const data = { ...printerForm, siteId };
    try {
      if (editingPrinter) {
        await setDoc(doc(db, "printers", editingPrinter.id), data, { merge: true });
        await logActivity({ siteId: siteId || "default", itemName: data.name, itemId: editingPrinter.id, qty: 0, min: 0, prevState: "OK", nextState: "OK", action: "edited", itemType: "printer" });
      } else {
        const docRef = await addDoc(collection(db, "printers"), data);
        await logActivity({ siteId: siteId || "default", itemName: data.name, itemId: docRef.id, qty: 0, min: 0, prevState: "OK", nextState: "OK", action: "added", itemType: "printer" });
      }
      setShowPrinterModal(false);
    } catch { Alert.alert("Error", "Failed to save printer."); }
  };

  const deletePrinter = (printer: Printer) => {
    Alert.alert("Delete Printer", `Remove ${printer.name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => { try { await deleteDoc(doc(db, "printers", printer.id)); setShowPrinterModal(false); setEditingPrinter(null); } catch (err: any) { Alert.alert("Error", err.message || "Failed to delete printer."); } } },
    ]);
  };

  // Data Card CRUD
  const saveDatacard = async () => {
    if (!datacardForm.name.trim()) { Alert.alert("Error", "Name is required."); return; }
    const data = {
      name: datacardForm.name.trim(), location: datacardForm.location.trim(),
      ipAddress: datacardForm.ipAddress.trim(), assetNumber: datacardForm.assetNumber.trim(),
      serial: datacardForm.serial.trim(), ribbonType: datacardForm.ribbonType.trim(),
      notes: datacardForm.notes.trim(), siteId: siteId || "default",
    };
    try {
      if (editingDatacard) { await setDoc(doc(db, "datacardPrinters", editingDatacard.id), data, { merge: true }); }
      else { await addDoc(collection(db, "datacardPrinters"), data); }
      setShowDatacardModal(false);
    } catch { Alert.alert("Error", "Failed to save data card printer."); }
  };

  const deleteDatacard = (printer: DataCardPrinter) => {
    Alert.alert("Delete Printer", `Remove ${printer.name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => { try { await deleteDoc(doc(db, "datacardPrinters", printer.id)); setShowDatacardModal(false); setEditingDatacard(null); } catch (err: any) { Alert.alert("Error", err.message || "Failed to delete."); } } },
    ]);
  };

  // Link/Unlink/Deduct
  const handleLinkToner = async (toner: TonerLink) => {
    if (!selectedPrinter) return;
    try {
      await updateDoc(doc(db, "printers", selectedPrinter.id), { tonerId: toner.id });
      await logActivity({ siteId: siteId || "default", itemName: `${toner.name} → ${selectedPrinter.name}`, itemId: selectedPrinter.id, qty: toner.stock, min: 0, prevState: "OK", nextState: "OK", action: "linked", itemType: "printer" });
      setShowLinkModal(false);
      setSelectedPrinter(null);
      Alert.alert("Linked!", `${toner.name} linked to ${selectedPrinter.name}.`);
    } catch { Alert.alert("Error", "Failed to link toner."); }
  };

  const handleUnlinkToner = async (printer: Printer) => {
    if (!printer.tonerId) return;
    const linkedToner = toners.find((t) => t.id === printer.tonerId);
    Alert.alert("Unlink Toner", `Remove ${linkedToner?.model || "toner"} from ${printer.name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Unlink", style: "destructive", onPress: async () => {
        try {
          await updateDoc(doc(db, "printers", printer.id), { tonerId: deleteField() });
          await logActivity({ siteId: siteId || "default", itemName: `${linkedToner?.model || "Unknown Toner"} ✕ ${printer.name}`, itemId: printer.id, qty: linkedToner?.quantity ?? 0, min: linkedToner?.minQuantity ?? 0, prevState: "OK", nextState: "OK", action: "unlinked", itemType: "printer" });
          Alert.alert("Unlinked!", `Toner removed from ${printer.name}.`);
        } catch { Alert.alert("Error", "Failed to unlink toner."); }
      }},
    ]);
  };

  const handleDeductToner = async (printer: Printer) => {
    if (!printer.tonerId) return;
    const linkedToner = toners.find((t) => t.id === printer.tonerId);
    Alert.alert("Deduct Toner", `Use 1 toner for ${printer.name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Deduct 1", onPress: async () => {
        try {
          const prevQty = linkedToner?.quantity ?? 1;
          const minQty = linkedToner?.minQuantity ?? 0;
          const newQty = Math.max(0, prevQty - 1);
          await updateDoc(doc(db, "toners", printer.tonerId!), { quantity: increment(-1) });
          await logActivity({ siteId: siteId || "default", itemName: linkedToner?.model || "Unknown Toner", itemId: printer.tonerId!, qty: newQty, min: minQty, prevState: getStockStatus(prevQty, minQty), nextState: getStockStatus(newQty, minQty), action: "deducted", itemType: "toner" });
        } catch { Alert.alert("Error", "Failed to update stock."); }
      }},
    ]);
  };

  // CSV Import
  const importTonersFromCSV = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "text/plain"] });
      if (result.canceled) return;
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
          batch.set(doc(db, "toners", stableId), { model, partNumber: normalizeCell(row[iPart] ?? ""), color, quantity: parseInt(normalizeCell(row[iQty] ?? "")) || 0, minQuantity: parseInt(normalizeCell(row[iMinQty] ?? "")) || 0, printer: normalizeCell(row[iPrinter] ?? ""), supplier: normalizeCell(row[iSupplier] ?? ""), notes: normalizeCell(row[iNotes] ?? ""), siteId: siteId || "default", importedAt: new Date().toISOString() }, { merge: true });
          count++;
        }
        await batch.commit();
      }
      Alert.alert("Import Complete", `${count} toner${count !== 1 ? "s" : ""} imported/updated.`);
    } catch (err: any) { Alert.alert("Import Failed", err.message || "An unexpected error occurred."); } finally { setImportingToners(false); }
  };

  const importPrintersFromCSV = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "text/plain"] });
      if (result.canceled) return;
      setImportingPrinters(true);
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const rows = parseCSV(content);
      if (rows.length < 2) { Alert.alert("Empty File", "No data rows found in the CSV."); return; }
      const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, ""));
      const col = makeColFinder(headers);
      const iName = col(["name", "printer"]);
      const iLocation = col(["location", "loc"]);
      const iIp = col(["ip", "ipaddress", "ip_address"]);
      const iAsset = col(["asset", "assetnumber"]);
      const iSerial = col(["serial", "sn"]);
      const iTonerSeries = col(["toner", "tonerseries"]);
      const iBarcode = col(["barcode", "sku", "upc"]);
      const iNotes = col(["notes", "note"]);
      if (iName === -1) { Alert.alert("Import Failed", "Could not find a 'Name' column."); return; }
      const dataRows = rows.slice(1).filter((row) => normalizeCell(row[iName] ?? "") !== "");
      let count = 0;
      for (let i = 0; i < dataRows.length; i += 499) {
        const chunk = dataRows.slice(i, i + 499);
        const batch = writeBatch(db);
        for (const row of chunk) {
          const name = normalizeCell(row[iName] ?? "");
          if (!name) continue;
          const stableId = `${siteId}_${name}`.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 100);
          batch.set(doc(db, "printers", stableId), { name, location: normalizeCell(row[iLocation] ?? ""), ipAddress: normalizeCell(row[iIp] ?? ""), assetNumber: normalizeCell(row[iAsset] ?? ""), serial: normalizeCell(row[iSerial] ?? ""), tonerSeries: normalizeCell(row[iTonerSeries] ?? ""), barcode: normalizeCell(row[iBarcode] ?? ""), notes: normalizeCell(row[iNotes] ?? ""), siteId: siteId || "default", importedAt: new Date().toISOString() }, { merge: true });
          count++;
        }
        await batch.commit();
      }
      Alert.alert("Import Complete", `${count} printer${count !== 1 ? "s" : ""} imported/updated.`);
    } catch (err: any) { Alert.alert("Import Failed", err.message || "An unexpected error occurred."); } finally { setImportingPrinters(false); }
  };

  const importDatacardPrintersFromCSV = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "text/plain"] });
      if (result.canceled) return;
      setImportingDatacardPrinters(true);
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
          const notes = noteParts.join(" | ");
          const idBase = serial || name;
          const stableId = `${siteId}_dc_${idBase}`.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 100);
          batch.set(doc(db, "datacardPrinters", stableId), { name, location: normalizeCell(row[iLocation] ?? ""), ipAddress: normalizeCell(row[iIp] ?? ""), assetNumber: iAsset !== -1 ? normalizeCell(row[iAsset] ?? "") : "", serial, ribbonType: iRibbon !== -1 ? normalizeCell(row[iRibbon] ?? "") : "", notes, siteId: siteId || "default", importedAt: new Date().toISOString() }, { merge: true });
          count++;
        }
        await batch.commit();
      }
      Alert.alert("Import Complete", `${count} data card printer${count !== 1 ? "s" : ""} imported/updated.`);
    } catch (err: any) { Alert.alert("Import Failed", err.message || "An unexpected error occurred."); } finally { setImportingDatacardPrinters(false); }
  };

  // Render functions
  const renderToner = ({ item }: { item: Toner }) => (
    <Pressable onPress={() => router.push(`/toners/${item.id}` as any)}>
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

  const renderPrinter = ({ item }: { item: Printer }) => (
    <View style={[inventoryStyles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Pressable style={{ flex: 1 }} onPress={() => { setEditingPrinter(item); setPrinterForm({ name: item.name || "", location: item.location || "", ipAddress: item.ipAddress || "", assetNumber: item.assetNumber || "", serial: item.serial || "", tonerSeries: item.tonerSeries || "", barcode: item.barcode || "", notes: item.notes || "" }); setShowPrinterModal(true); }}>
        <Text style={[inventoryStyles.itemName, { color: theme.text }]}>{item.name}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
          <Ionicons name="location-outline" size={14} color={theme.mutedText} style={{ marginRight: 4 }} />
          <Text style={{ color: theme.mutedText, fontSize: 12 }}>{item.location || "No location"}</Text>
          {item.tonerSeries && (
            <>
              <Ionicons name="pricetag-outline" size={12} color={theme.mutedText} style={{ marginLeft: 8, marginRight: 4 }} />
              <Text style={{ color: theme.mutedText, fontSize: 12 }}>#{item.tonerSeries}</Text>
            </>
          )}
        </View>
        {item.tonerId && <View style={{ marginTop: 6 }}><TonerStockBadge tonerId={item.tonerId} theme={theme} /></View>}
      </Pressable>
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: theme.text, fontWeight: "700", fontSize: 14 }}>{item.ipAddress || "No IP"}</Text>
          <Pressable onPress={() => deletePrinter(item)} hitSlop={8} style={{ padding: 4 }}>
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
          <Pressable hitSlop={8} style={[inventoryStyles.actionButton, { backgroundColor: "#2563eb" }]} onPress={() => { setSelectedPrinter(item); setTonerLinkSearch(""); setShowLinkModal(true); }}>
            <Text style={inventoryStyles.actionButtonText}>LINK TONER</Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  const renderDatacardPrinter = ({ item }: { item: DataCardPrinter }) => (
    <View style={[inventoryStyles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Pressable style={{ flex: 1 }} onPress={() => { setEditingDatacard(item); setDatacardForm({ name: item.name || "", location: item.location || "", ipAddress: item.ipAddress || "", assetNumber: item.assetNumber || "", serial: item.serial || "", ribbonType: item.ribbonType || "", notes: item.notes || "" }); setShowDatacardModal(true); }}>
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
        <Pressable onPress={() => deleteDatacard(item)} hitSlop={8} style={{ padding: 4 }}>
          <Ionicons name="trash-outline" size={18} color="#ef4444" />
        </Pressable>
      </View>
    </View>
  );

  const tonerUndoPointerEvents = pendingTonerDelete ? "auto" : "none";

  return (
    <View style={{ flex: 1 }}>
      {/* Sub-tab bar */}
      <View style={{ flexDirection: "row", paddingHorizontal: 16, marginBottom: 12, gap: 12 }}>
        <Pressable onPress={() => setTonerSubTab("toners")} style={{ flex: 1, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: tonerSubTab === "toners" ? theme.text : "transparent" }}>
          <Text style={{ textAlign: "center", color: tonerSubTab === "toners" ? theme.text : theme.mutedText, fontWeight: "700", fontSize: 12 }}>Toner Inventory</Text>
        </Pressable>
        <Pressable onPress={() => setTonerSubTab("printers")} style={{ flex: 1, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: tonerSubTab === "printers" ? theme.text : "transparent" }}>
          <Text style={{ textAlign: "center", color: tonerSubTab === "printers" ? theme.text : theme.mutedText, fontWeight: "700", fontSize: 12 }}>Printers ({printers.length})</Text>
        </Pressable>
        <Pressable onPress={() => setTonerSubTab("datacard")} style={{ flex: 1, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: tonerSubTab === "datacard" ? theme.text : "transparent" }}>
          <Text style={{ textAlign: "center", color: tonerSubTab === "datacard" ? theme.text : theme.mutedText, fontWeight: "700", fontSize: 12 }}>Data Card ({datacardPrinters.length})</Text>
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
        <FlatList
          data={filteredPrinters}
          keyExtractor={(item) => item.id}
          renderItem={renderPrinter}
          contentContainerStyle={{ padding: 16 }}
          ListHeaderComponent={
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <Pressable onPress={importPrintersFromCSV} disabled={importingPrinters} style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, flex: 1 }]}>
                  {importingPrinters ? <ActivityIndicator size="small" color={theme.text} /> : <><Ionicons name="cloud-upload-outline" size={16} color={theme.text} style={{ marginRight: 6 }} /><Text style={[inventoryStyles.importBtnText, { color: theme.text }]}>Import CSV</Text></>}
                </Pressable>
                <Pressable onPress={() => downloadPrinterTemplate().catch((e) => Alert.alert("Error", e.message))} style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12 }]}>
                  <Ionicons name="document-outline" size={18} color={theme.text} />
                </Pressable>
                <Pressable onPress={() => { setEditingPrinter(null); setPrinterForm({ name: "", location: "", ipAddress: "", assetNumber: "", serial: "", tonerSeries: "", barcode: "", notes: "" }); setShowPrinterModal(true); }} style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12 }]}>
                  <Ionicons name="add" size={18} color={theme.text} />
                </Pressable>
              </View>
              <TextInput style={[inventoryStyles.searchInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]} placeholder="Search printers..." placeholderTextColor={theme.mutedText} value={printerSearch} onChangeText={setPrinterSearch} />
            </>
          }
        />
      ) : (
        <FlatList
          data={filteredDatacardPrinters}
          keyExtractor={(item) => item.id}
          renderItem={renderDatacardPrinter}
          contentContainerStyle={{ padding: 16 }}
          ListHeaderComponent={
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <Pressable onPress={importDatacardPrintersFromCSV} disabled={importingDatacardPrinters} style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, flex: 1 }]}>
                  {importingDatacardPrinters ? <ActivityIndicator size="small" color={theme.text} /> : <><Ionicons name="cloud-upload-outline" size={16} color={theme.text} style={{ marginRight: 6 }} /><Text style={[inventoryStyles.importBtnText, { color: theme.text }]}>Import CSV</Text></>}
                </Pressable>
                <Pressable onPress={() => downloadDatacardTemplate().catch((e) => Alert.alert("Error", e.message))} style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12 }]}>
                  <Ionicons name="document-outline" size={18} color={theme.text} />
                </Pressable>
                <Pressable onPress={() => { setEditingDatacard(null); setDatacardForm({ name: "", location: "", ipAddress: "", assetNumber: "", serial: "", ribbonType: "", notes: "" }); setShowDatacardModal(true); }} style={[inventoryStyles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12 }]}>
                  <Ionicons name="add" size={18} color={theme.text} />
                </Pressable>
              </View>
              <TextInput style={[inventoryStyles.searchInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]} placeholder="Search data card printers..." placeholderTextColor={theme.mutedText} value={datacardSearch} onChangeText={setDatacardSearch} />
            </>
          }
          ListEmptyComponent={<Text style={{ color: theme.mutedText, textAlign: "center", marginTop: 40 }}>{datacardSearch ? "No results match." : "No data card printers yet. Tap + to add one."}</Text>}
        />
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
            <Pressable style={[inventoryStyles.saveBtn, { backgroundColor: "#2563eb" }]} onPress={saveToner}>
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

      {/* Printer Modal */}
      <Modal visible={showPrinterModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPrinterModal(false)}>
        <View style={[inventoryStyles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={inventoryStyles.modalHeader}>
            <Text style={[inventoryStyles.modalTitle, { color: theme.text }]}>{editingPrinter ? "Edit Printer" : "Add Printer"}</Text>
            <Pressable onPress={() => setShowPrinterModal(false)}><Ionicons name="close" size={24} color={theme.text} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {[
              { label: "Name *", key: "name", placeholder: "Printer name" },
              { label: "Location", key: "location", placeholder: "Location" },
              { label: "IP Address", key: "ipAddress", placeholder: "192.168.x.x" },
              { label: "Asset Number", key: "assetNumber", placeholder: "Asset #" },
              { label: "Serial", key: "serial", placeholder: "Serial #" },
              { label: "Toner Series", key: "tonerSeries", placeholder: "e.g. 1234-series" },
              { label: "Barcode", key: "barcode", placeholder: "Barcode" },
            ].map(({ label, key, placeholder }) => (
              <View key={key}>
                <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>{label}</Text>
                <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]} placeholder={placeholder} placeholderTextColor={theme.mutedText} value={(printerForm as any)[key]} onChangeText={(v) => setPrinterForm((p) => ({ ...p, [key]: v }))} />
              </View>
            ))}
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Notes</Text>
            <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, height: 100 }]} placeholder="Notes" placeholderTextColor={theme.mutedText} multiline value={printerForm.notes} onChangeText={(v) => setPrinterForm((p) => ({ ...p, notes: v }))} />
            <Pressable style={[inventoryStyles.saveBtn, { backgroundColor: "#2563eb" }]} onPress={savePrinter}>
              <Text style={inventoryStyles.saveBtnText}>{editingPrinter ? "Update Printer" : "Add Printer"}</Text>
            </Pressable>
            {editingPrinter && (
              <Pressable style={[inventoryStyles.saveBtn, { backgroundColor: "transparent", borderWidth: 1, borderColor: "#ef4444", marginTop: 8 }]} onPress={() => deletePrinter(editingPrinter)}>
                <Text style={[inventoryStyles.saveBtnText, { color: "#ef4444" }]}>Delete Printer</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Data Card Printer Modal */}
      <Modal visible={showDatacardModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowDatacardModal(false)}>
        <View style={[inventoryStyles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={inventoryStyles.modalHeader}>
            <Text style={[inventoryStyles.modalTitle, { color: theme.text }]}>{editingDatacard ? "Edit Data Card Printer" : "Add Data Card Printer"}</Text>
            <Pressable onPress={() => setShowDatacardModal(false)}><Ionicons name="close" size={24} color={theme.text} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {[
              { label: "Name *", key: "name", placeholder: "Printer name" },
              { label: "Location", key: "location", placeholder: "Location" },
              { label: "IP Address", key: "ipAddress", placeholder: "192.168.x.x" },
              { label: "Asset Number", key: "assetNumber", placeholder: "Asset #" },
              { label: "Serial", key: "serial", placeholder: "Serial #" },
              { label: "Ribbon Type", key: "ribbonType", placeholder: "e.g. YMCKO, KO, Monochrome" },
            ].map(({ label, key, placeholder }) => (
              <View key={key}>
                <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>{label}</Text>
                <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]} placeholder={placeholder} placeholderTextColor={theme.mutedText} value={(datacardForm as any)[key]} onChangeText={(v) => setDatacardForm((p) => ({ ...p, [key]: v }))} />
              </View>
            ))}
            <Text style={[inventoryStyles.fieldLabel, { color: theme.mutedText }]}>Notes</Text>
            <TextInput style={[inventoryStyles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, height: 100 }]} placeholder="Notes" placeholderTextColor={theme.mutedText} multiline value={datacardForm.notes} onChangeText={(v) => setDatacardForm((p) => ({ ...p, notes: v }))} />
            <Pressable style={[inventoryStyles.saveBtn, { backgroundColor: "#2563eb" }]} onPress={saveDatacard}>
              <Text style={inventoryStyles.saveBtnText}>{editingDatacard ? "Update Printer" : "Add Printer"}</Text>
            </Pressable>
            {editingDatacard && (
              <Pressable style={[inventoryStyles.saveBtn, { backgroundColor: "transparent", borderWidth: 1, borderColor: "#ef4444", marginTop: 8 }]} onPress={() => deleteDatacard(editingDatacard)}>
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
              {filteredTonerLinkList.map((t) => (
                <Pressable key={t.id} style={[inventoryStyles.linkItem, { borderBottomColor: theme.border }]} onPress={() => handleLinkToner(t)}>
                  <Text style={{ color: theme.text, fontWeight: "700", fontSize: 15 }}>{t.name}</Text>
                  <Text style={{ color: theme.mutedText, fontSize: 12, marginTop: 2 }}>Stock: {t.stock}</Text>
                </Pressable>
              ))}
              {filteredTonerLinkList.length === 0 && <Text style={{ color: theme.mutedText, textAlign: "center", marginTop: 24 }}>No toners found.</Text>}
            </ScrollView>
            <Pressable style={{ marginTop: 16, alignItems: "center" }} onPress={() => setShowLinkModal(false)}>
              <Text style={{ color: theme.tint, fontWeight: "800", fontSize: 16 }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
