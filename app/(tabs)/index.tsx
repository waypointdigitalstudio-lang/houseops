// app/(tabs)/index.tsx
// FIXED VERSION V3 - Bulletproof Undo Banner + Inventory Item Edit Support + Activity Logging
// Changes marked with "// FIX:" for undo banner, "// NEW:" for inventory edit, "// ACTIVITY:" for activity logging

import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
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
  writeBatch
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
  View
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
  color: string;
  quantity: number;
  minQuantity: number;
  printer?: string;
  notes?: string;
  barcode?: string;
  siteId: string;
};

type Printer = {
  id: string;
  name: string;
  location?: string;
  ipAddress?: string;
  assetNumber?: string;
  serial?: string;
  tonerSeries?: string;
  barcode?: string;
  notes?: string;
  siteId: string;
  tonerId?: string;
  importedAt?: string;
};

type Radio = {
  id: string;
  model: string;
  serialNumber?: string;
  channel?: string;
  assignedTo?: string;
  location?: string;
  condition?: string;
  barcode?: string;
  notes?: string;
  siteId: string;
};

type RadioPart = {
  id: string;
  name: string;
  compatibleModel?: string;
  quantity: number;
  minQuantity: number;
  location?: string;
  barcode?: string;
  notes?: string;
  siteId: string;
};

type TonerLink = {
  id: string;
  name: string;
  stock: number;
};

type SortMode = "name" | "stock";
type TabMode = "inventory" | "toners" | "radios";
type TonerSubTab = "toners" | "printers";
type RadioSubTab = "radios" | "parts";

// ACTIVITY: Stock status type for activity logging
type StockStatus = "OK" | "LOW" | "OUT";

const TONER_COLORS = ["Black", "Cyan", "Magenta", "Yellow", "Other"];

// FIX: Constants for undo timing
const UNDO_TIMEOUT_MS = 5000;
const UNDO_ANIMATION_MS = 180;

// ACTIVITY: Helper function to determine stock status based on quantity and minimum
// Returns "OUT" if qty <= 0, "LOW" if qty <= min, "OK" otherwise
function getStockStatus(qty: number, min: number): StockStatus {
  if (qty <= 0) return "OUT";
  if (qty <= min) return "LOW";
  return "OK";
}

// ACTIVITY: Helper function to log activity to the alertsLog collection
// This writes a comprehensive log entry for any inventory/toner/printer change
async function logActivity(params: {
  siteId: string;
  itemName: string;
  itemId: string;
  qty: number;
  min: number;
  prevState: StockStatus;
  nextState: StockStatus;
  action: string; // e.g., "added", "edited", "deleted", "deducted", "linked"
  itemType: "inventory" | "toner" | "printer";
}) {
  const { siteId, itemName, itemId, qty, min, prevState, nextState, action, itemType } = params;
  
  try {
    await addDoc(collection(db, "alertsLog"), {
      siteId,
      itemName,
      itemId,
      qty,
      min,
      prevState,
      nextState,
      status: nextState,
      action,
      itemType,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("Error logging activity:", err);
    // Don't throw - activity logging should not break main functionality
  }
}

// --- Live Toner Stock Badge ---
function TonerStockBadge({ tonerId, theme }: { tonerId: string; theme: any }) {
  const [stock, setStock] = useState<number | null>(null);
  const [name, setName] = useState<string>("");

  useEffect(() => {
    if (!tonerId) return;
    const unsub = onSnapshot(
      doc(db, "toners", tonerId),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as any;
          setStock(data.quantity ?? data.stock ?? 0);
          setName(data.model || data.name || "Toner");
        }
      },
      (err) => {
        console.error("TonerStockBadge error:", err);
      }
    );
    return () => unsub();
  }, [tonerId]);

  if (stock === null) return null;

  const color = stock <= 0 ? "#ef4444" : stock <= 2 ? "#f97316" : "#22c55e";

  return (
    <View style={[styles.stockBadge, { backgroundColor: color + "20", borderColor: color }]}>
      <Text style={[styles.stockText, { color }]}>
        {name}: {stock}
      </Text>
    </View>
  );
}

export default function IndexScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const { uid, profile, siteId, loading: profileLoading } = useUserProfile();
  const { addTonerBarcode } = useLocalSearchParams<{ addTonerBarcode?: string }>();

  // Tab state
  const [activeTab, setActiveTab] = useState<TabMode>("inventory");
  const [tonerSubTab, setTonerSubTab] = useState<TonerSubTab>("toners");
  const [radioSubTab, setRadioSubTab] = useState<RadioSubTab>("parts");

  // --- Radios state ---
  const [radios, setRadios] = useState<Radio[]>([]);
  const [radioParts, setRadioParts] = useState<RadioPart[]>([]);
  const [radioSearch, setRadioSearch] = useState("");
  const [radioPartSearch, setRadioPartSearch] = useState("");

  const [showRadioModal, setShowRadioModal] = useState(false);
  const [editingRadio, setEditingRadio] = useState<Radio | null>(null);
  const [radioForm, setRadioForm] = useState({ model: "", serialNumber: "", channel: "", assignedTo: "", location: "", condition: "Good", barcode: "", notes: "" });

  const [showRadioPartModal, setShowRadioPartModal] = useState(false);
  const [editingRadioPart, setEditingRadioPart] = useState<RadioPart | null>(null);
  const [radioPartForm, setRadioPartForm] = useState({ name: "", compatibleModel: "", quantity: "", minQuantity: "", location: "", barcode: "", notes: "" });

  // --- Inventory state ---
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("name");

  // --- Scanner modal state ---
  const [showScanModal, setShowScanModal] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanningEnabled, setScanningEnabled] = useState(true);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const lastScanRef = useRef<{ data: string; at: number } | null>(null);

  // --- Inventory item add modal state ---
  const [showInventoryModal, setShowInventoryModal] = useState(false);
  const [itemForm, setItemForm] = useState({
    name: "",
    currentQuantity: "",
    minQuantity: "",
    location: "",
    barcode: "",
    notes: "",
  });

  // --- DISPOSE: Disposal modal state ---
  const [showDisposeModal, setShowDisposeModal] = useState(false);
  const [disposingItem, setDisposingItem] = useState<Item | null>(null);
  const [disposeSaving, setDisposeSaving] = useState(false);
  const [disposeForm, setDisposeForm] = useState({
    itemName: "",
    model: "",
    amount: "",
    vendor: "",
    approxAmount: "",
    multipleAmount: "",
    approxAge: "",
    description: "",
    disposedBy: "",
  });

  // --- FIX: Inventory Undo delete state - using refs for timeouts and mounted tracking ---
  const [pendingDelete, setPendingDelete] = useState<{
    item: Item;
    backup: any;
  } | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const undoAnim = useRef(new Animated.Value(0)).current;
  const undoTimeoutRef = useRef<NodeJS.Timeout | null>(null); // FIX: Use ref for timeout
  const isMountedRef = useRef(true); // FIX: Track mounted state

  // --- Toner state ---
  const [toners, setToners] = useState<Toner[]>([]);
  const [tonersLoading, setTonersLoading] = useState(true);
  const [tonerSearch, setTonerSearch] = useState("");
  const [showTonerLowOnly, setShowTonerLowOnly] = useState(false);
  const [showTonerModal, setShowTonerModal] = useState(false);
  const [showPrinterPicker, setShowPrinterPicker] = useState(false);
  const [editingToner, setEditingToner] = useState<Toner | null>(null);
  const [tonerForm, setTonerForm] = useState({
    model: "",
    color: "Black",
    quantity: "",
    minQuantity: "",
    printer: "",
    notes: "",
    barcode: "",
  });

  // --- FIX: Toner Undo delete state - using refs for timeouts ---
  const [pendingTonerDelete, setPendingTonerDelete] = useState<{
    toner: Toner;
    backup: any;
  } | null>(null);
  const [hiddenTonerIds, setHiddenTonerIds] = useState<Set<string>>(new Set());
  const undoTonerAnim = useRef(new Animated.Value(0)).current;
  const undoTonerTimeoutRef = useRef<NodeJS.Timeout | null>(null); // FIX: Use ref for timeout

  // --- Printer state ---
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [printersLoading, setPrintersLoading] = useState(true);
  const [importingPrinters, setImportingPrinters] = useState(false);
  const [printerSearch, setPrinterSearch] = useState("");

  // Printer modal / edit state
  const [showPrinterModal, setShowPrinterModal] = useState(false);
  const [editingPrinter, setEditingPrinter] = useState<Printer | null>(null);
  const [printerForm, setPrinterForm] = useState({
    name: "",
    location: "",
    ipAddress: "",
    assetNumber: "",
    serial: "",
    tonerSeries: "",
    barcode: "",
    notes: "",
  });

  // --- Import state ---
  const [importingInventory, setImportingInventory] = useState(false);
  const [importingToners, setImportingToners] = useState(false);
  const [importingRadios, setImportingRadios] = useState(false);
  const [importingRadioParts, setImportingRadioParts] = useState(false);

  // --- Link Toner Modal state ---
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedPrinter, setSelectedPrinter] = useState<Printer | null>(null);
  const [tonerLinkSearch, setTonerLinkSearch] = useState("");
  const [tonerLinkList, setTonerLinkList] = useState<TonerLink[]>([]);

  // FIX: Track mounted state for cleanup
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // FIX: Cleanup timeouts on unmount
      if (undoTimeoutRef.current) {
        clearTimeout(undoTimeoutRef.current);
        undoTimeoutRef.current = null;
      }
      if (undoTonerTimeoutRef.current) {
        clearTimeout(undoTonerTimeoutRef.current);
        undoTonerTimeoutRef.current = null;
      }
    };
  }, []);

  // --- Inventory Logic ---
  useEffect(() => {
    if (!siteId) return;
    const q = query(collection(db, "items"), where("siteId", "==", siteId));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const newItems = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Item));
        setItems(newItems);
        setLoading(false);
      },
      (err) => {
        console.error("items onSnapshot error:", err);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [siteId]);

  // FIX: Helper function to dismiss inventory undo banner with proper cleanup
  const dismissUndoBanner = useCallback(() => {
    if (undoTimeoutRef.current) {
      clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
    }
    Animated.timing(undoAnim, {
      toValue: 0,
      duration: UNDO_ANIMATION_MS,
      useNativeDriver: true,
    }).start(() => {
      // Only update state after animation completes and component is still mounted
      if (isMountedRef.current) {
        setPendingDelete(null);
      }
    });
  }, [undoAnim]);

  // FIX: Refactored scheduleDelete with bulletproof timing and cleanup
  // ACTIVITY: Added activity logging for item deletion
  const scheduleDelete = useCallback(async (item: Item) => {
    // Step 1: If there's an existing pending delete, commit it immediately
    if (pendingDelete) {
      if (undoTimeoutRef.current) {
        clearTimeout(undoTimeoutRef.current);
        undoTimeoutRef.current = null;
      }
      try {
        await deleteDoc(doc(db, "items", pendingDelete.item.id));
        
        // ACTIVITY: Log the committed deletion
        const prevStatus = getStockStatus(pendingDelete.item.currentQuantity, pendingDelete.item.minQuantity);
        await logActivity({
          siteId: siteId || "default",
          itemName: pendingDelete.item.name,
          itemId: pendingDelete.item.id,
          qty: 0,
          min: pendingDelete.item.minQuantity,
          prevState: prevStatus,
          nextState: "OUT",
          action: "deleted",
          itemType: "inventory",
        });
      } catch (e) {
        console.error("Error committing previous delete:", e);
      }
      // Clean up previous hidden state
      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.delete(pendingDelete.item.id);
        return next;
      });
      // Reset animation immediately (no callback needed here)
      undoAnim.setValue(0);
      setPendingDelete(null);
    }

    // Step 2: Set up new pending delete
    const backup = { ...item };
    delete (backup as any).id;

    // Hide the item from the list
    setHiddenIds((prev) => new Set(prev).add(item.id));

    // Set pending delete state (without timeoutId in state)
    setPendingDelete({ item, backup });

    // Animate banner in
    Animated.timing(undoAnim, {
      toValue: 1,
      duration: UNDO_ANIMATION_MS,
      useNativeDriver: true,
    }).start();

    // FIX: Schedule the actual deletion with ref-based timeout
    undoTimeoutRef.current = setTimeout(async () => {
      if (!isMountedRef.current) return;
      
      try {
        await deleteDoc(doc(db, "items", item.id));
        
        // ACTIVITY: Log the deletion after timeout
        const prevStatus = getStockStatus(item.currentQuantity, item.minQuantity);
        await logActivity({
          siteId: siteId || "default",
          itemName: item.name,
          itemId: item.id,
          qty: 0,
          min: item.minQuantity,
          prevState: prevStatus,
          nextState: "OUT",
          action: "deleted",
          itemType: "inventory",
        });
      } catch (e) {
        console.error("Error during scheduled delete:", e);
        // On error, unhide the item
        if (isMountedRef.current) {
          setHiddenIds((prev) => {
            const next = new Set(prev);
            next.delete(item.id);
            return next;
          });
        }
      }
      
      // Always dismiss the banner after timeout
      if (isMountedRef.current) {
        dismissUndoBanner();
      }
    }, UNDO_TIMEOUT_MS);
  }, [pendingDelete, undoAnim, dismissUndoBanner, siteId]);

  // FIX: Refactored undoDelete with proper cleanup
  const undoDelete = useCallback(async () => {
    if (!pendingDelete) return;

    // Clear the scheduled deletion timeout
    if (undoTimeoutRef.current) {
      clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
    }

    const { item, backup } = pendingDelete;

    // Unhide the item immediately
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });

    // Restore the document (it was never actually deleted since we use delayed delete)
    try {
      await setDoc(doc(db, "items", item.id), backup, { merge: true });
    } catch (e) {
      console.error("Error restoring item:", e);
    }

    // Dismiss the banner
    dismissUndoBanner();
  }, [pendingDelete, dismissUndoBanner]);

  const openInventoryModal = useCallback(() => {
    setItemForm({ name: "", currentQuantity: "", minQuantity: "", location: "", barcode: "", notes: "" });
    setShowInventoryModal(true);
  }, []);

  // --- Scanner ---
  const openScanModal = useCallback(async () => {
    if (!cameraPermission?.granted) {
      const res = await requestCameraPermission();
      if (!res.granted) {
        Alert.alert("Camera permission needed", "Enable camera access to use the scanner.");
        return;
      }
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

      const itemSnap = await getDocs(query(collection(db, "items"), where("barcode", "==", clean)));
      if (!itemSnap.empty) {
        setShowScanModal(false);
        router.push({ pathname: "/item/[id]", params: { id: itemSnap.docs[0].id } });
        return;
      }

      const tonerSnap = await getDocs(query(collection(db, "toners"), where("barcode", "==", clean)));
      if (!tonerSnap.empty) {
        setShowScanModal(false);
        router.push({ pathname: "/toners/[id]" as any, params: { id: tonerSnap.docs[0].id } });
        return;
      }

      const radioSnap = await getDocs(query(collection(db, "radios"), where("barcode", "==", clean), where("siteId", "==", siteId)));
      if (!radioSnap.empty) {
        setShowScanModal(false);
        setActiveTab("radios");
        setRadioSubTab("radios");
        openRadioModal(({ id: radioSnap.docs[0].id, ...radioSnap.docs[0].data() } as Radio));
        return;
      }

      const radioPartSnap = await getDocs(query(collection(db, "radioParts"), where("barcode", "==", clean), where("siteId", "==", siteId)));
      if (!radioPartSnap.empty) {
        setShowScanModal(false);
        setActiveTab("radios");
        setRadioSubTab("parts");
        openRadioPartModal(({ id: radioPartSnap.docs[0].id, ...radioPartSnap.docs[0].data() } as RadioPart));
        return;
      }

      Alert.alert(
        "Barcode not found",
        `Where would you like to add "${clean}"?`,
        [
          {
            text: "Inventory",
            onPress: () => {
              setShowScanModal(false);
              setActiveTab("inventory");
              setItemForm({ name: "", currentQuantity: "", minQuantity: "", location: "", barcode: clean, notes: "" });
              setShowInventoryModal(true);
            },
          },
          {
            text: "Toner",
            onPress: () => {
              setShowScanModal(false);
              setActiveTab("toners");
              setEditingToner(null);
              setTonerForm({ model: "", color: "Black", quantity: "", minQuantity: "", printer: "", notes: "", barcode: "" });
              setShowTonerModal(true);
            },
          },
          {
            text: "Radio Parts",
            onPress: () => {
              setShowScanModal(false);
              setActiveTab("radios");
              setRadioSubTab("parts");
              setEditingRadioPart(null);
              setRadioPartForm({ name: "", compatibleModel: "", quantity: "", minQuantity: "", location: "", barcode: clean, notes: "" });
              setShowRadioPartModal(true);
            },
          },
          { text: "Scan Again", onPress: () => { setScanBusy(false); setScanningEnabled(true); } },
          { text: "Cancel", style: "cancel", onPress: () => setShowScanModal(false) },
        ]
      );
    } catch (e) {
      Alert.alert("Scan failed", "Could not look up that barcode. Try again.");
    } finally {
      setScanBusy(false);
    }
  }, [scanningEnabled, scanBusy, router, siteId, openRadioModal, openRadioPartModal]);

  // --- Save inventory item ---
  // Validates required fields and saves to Firestore
  const saveItem = useCallback(async () => {
    // Validate required fields
    if (!itemForm.name.trim()) {
      Alert.alert("Error", "Item name is required.");
      return;
    }
    if (!itemForm.currentQuantity.trim()) {
      Alert.alert("Error", "Quantity is required.");
      return;
    }

    const newQty = parseInt(itemForm.currentQuantity) || 0;
    const newMin = parseInt(itemForm.minQuantity) || 0;

    const data = {
      name: itemForm.name.trim(),
      currentQuantity: newQty,
      minQuantity: newMin,
      location: itemForm.location.trim(),
      barcode: itemForm.barcode.trim(),
      notes: itemForm.notes.trim(),
      siteId: siteId || "default",
    };

    try {
      const docRef = await addDoc(collection(db, "items"), data);

      const nextStatus = getStockStatus(newQty, newMin);
      await logActivity({
        siteId: siteId || "default",
        itemName: data.name,
        itemId: docRef.id,
        qty: newQty,
        min: newMin,
        prevState: "OK",
        nextState: nextStatus,
        action: "added",
        itemType: "inventory",
      });

      setShowInventoryModal(false);
    } catch (err) {
      console.error("Error saving item:", err);
      Alert.alert("Error", "Failed to save inventory item.");
    }
  }, [itemForm, siteId]);

  // --- DISPOSE: Open disposal modal and auto-populate fields from inventory item ---
  const openDisposeModal = useCallback((item: Item) => {
    setDisposingItem(item);
    setDisposeForm({
      itemName: item.name || "",
      model: "",
      amount: "",
      vendor: "",
      approxAmount: "",
      multipleAmount: "",
      approxAge: "",
      description: item.notes || "",
      disposedBy: "",
    });
    setShowDisposeModal(true);
  }, []);

  // --- DISPOSE: Confirm disposal - save to disposals collection, delete from inventory, log activity ---
  const confirmDispose = useCallback(async () => {
    if (!disposingItem) return;

    // Validate required fields
    if (!disposeForm.itemName.trim()) {
      Alert.alert("Error", "Item name is required.");
      return;
    }
    if (!disposeForm.disposedBy.trim()) {
      Alert.alert("Error", "Please enter who is disposing this item.");
      return;
    }

    setDisposeSaving(true);

    try {
      // 1. Save disposal record to 'disposals' collection
      const disposalData: Record<string, any> = {
        itemId: disposingItem.id,
        itemName: disposeForm.itemName.trim(),
        model: disposeForm.model.trim(),
        quantity: parseInt(disposeForm.amount) || 1,
        vendor: disposeForm.vendor.trim(),
        approxValue: disposeForm.approxAmount.trim(),
        totalValue: disposeForm.multipleAmount.trim(),
        approxAge: disposeForm.approxAge.trim(),
        notes: disposeForm.description.trim(),
        disposedBy: disposeForm.disposedBy.trim(),
        disposedByUid: uid || "",
        siteId: siteId || "default",
        reason: "other" as const,
        disposedAt: serverTimestamp(),
      };

      await addDoc(collection(db, "disposals"), disposalData);

      // 2. Subtract the disposed quantity from inventory (keep the item)
      const disposedQty = parseInt(disposeForm.amount) || 1;
      const newQty = Math.max(0, disposingItem.currentQuantity - disposedQty);
      await updateDoc(doc(db, "items", disposingItem.id), {
        currentQuantity: newQty,
      });

      // 3. Log activity for the disposal
      const prevStatus = getStockStatus(disposingItem.currentQuantity, disposingItem.minQuantity);
      const nextStatus = getStockStatus(newQty, disposingItem.minQuantity);
      await logActivity({
        siteId: siteId || "default",
        itemName: disposeForm.itemName.trim(),
        itemId: disposingItem.id,
        qty: newQty,
        min: disposingItem.minQuantity,
        prevState: prevStatus,
        nextState: nextStatus,
        action: "disposed",
        itemType: "inventory",
      });

      setShowDisposeModal(false);
      setDisposingItem(null);
      setDisposeSaving(false);
    } catch (err) {
      console.error("Error disposing item:", err);
      Alert.alert("Error", "Failed to dispose item. Please try again.");
      setDisposeSaving(false);
    }
  }, [disposingItem, disposeForm, uid, siteId]);

  const filteredItems = useMemo(() => {
    let list = items.filter((i) => !hiddenIds.has(i.id));
    if (searchQuery) {
      list = list.filter((i) => i.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    if (showLowOnly) {
      list = list.filter((i) => i.currentQuantity <= i.minQuantity);
    }
    return list.sort((a, b) => {
      if (sortMode === "name") return a.name.localeCompare(b.name);
      return a.currentQuantity - b.currentQuantity;
    });
  }, [items, searchQuery, showLowOnly, sortMode, hiddenIds]);

  const summaryStats = useMemo(() => {
    const visible = items.filter((i) => !hiddenIds.has(i.id));
    const totalItems = visible.length;
    const outOfStock = visible.filter((i) => i.currentQuantity <= 0).length;
    const lowStock = visible.filter(
      (i) => i.currentQuantity > 0 && i.minQuantity > 0 && i.currentQuantity <= i.minQuantity
    ).length;
    const totalToners = toners.filter((t) => !hiddenTonerIds.has(t.id)).length;
    return { totalItems, outOfStock, lowStock, totalToners };
  }, [items, toners, hiddenIds, hiddenTonerIds]);

  // --- Toner Logic ---
  useEffect(() => {
    if (!siteId) return;
    const q = query(collection(db, "toners"), where("siteId", "==", siteId));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const newToners = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Toner));
        setToners(newToners);
        setTonersLoading(false);
      },
      (err) => {
        console.error("toners onSnapshot error:", err);
        setTonersLoading(false);
      }
    );
    return () => unsubscribe();
  }, [siteId]);

  // Load toners for the link modal
  useEffect(() => {
    if (!showLinkModal || !siteId) return;
    const q = query(collection(db, "toners"), where("siteId", "==", siteId), orderBy("model", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: data.model || data.name || "Unknown",
            stock: data.quantity ?? data.stock ?? 0,
          } as TonerLink;
        });
        setTonerLinkList(list);
      },
      (err) => {
        console.error("tonerLinkList onSnapshot error:", err);
      }
    );
    return () => unsub();
  }, [showLinkModal, siteId]);

  // FIX: Helper function to dismiss toner undo banner with proper cleanup
  const dismissTonerUndoBanner = useCallback(() => {
    if (undoTonerTimeoutRef.current) {
      clearTimeout(undoTonerTimeoutRef.current);
      undoTonerTimeoutRef.current = null;
    }
    Animated.timing(undoTonerAnim, {
      toValue: 0,
      duration: UNDO_ANIMATION_MS,
      useNativeDriver: true,
    }).start(() => {
      // Only update state after animation completes and component is still mounted
      if (isMountedRef.current) {
        setPendingTonerDelete(null);
      }
    });
  }, [undoTonerAnim]);

  // FIX: Refactored scheduleTonerDelete with bulletproof timing and cleanup
  // ACTIVITY: Added activity logging for toner deletion
  const scheduleTonerDelete = useCallback(async (toner: Toner) => {
    // Step 1: If there's an existing pending toner delete, commit it immediately
    if (pendingTonerDelete) {
      if (undoTonerTimeoutRef.current) {
        clearTimeout(undoTonerTimeoutRef.current);
        undoTonerTimeoutRef.current = null;
      }
      try {
        await deleteDoc(doc(db, "toners", pendingTonerDelete.toner.id));
        
        // ACTIVITY: Log the committed deletion
        const prevStatus = getStockStatus(pendingTonerDelete.toner.quantity, pendingTonerDelete.toner.minQuantity);
        await logActivity({
          siteId: siteId || "default",
          itemName: pendingTonerDelete.toner.model,
          itemId: pendingTonerDelete.toner.id,
          qty: 0,
          min: pendingTonerDelete.toner.minQuantity,
          prevState: prevStatus,
          nextState: "OUT",
          action: "deleted",
          itemType: "toner",
        });
      } catch (e) {
        console.error("Error committing previous toner delete:", e);
      }
      setHiddenTonerIds((prev) => {
        const next = new Set(prev);
        next.delete(pendingTonerDelete.toner.id);
        return next;
      });
      undoTonerAnim.setValue(0);
      setPendingTonerDelete(null);
    }

    // Step 2: Set up new pending delete
    const backup = { ...toner };
    delete (backup as any).id;

    setHiddenTonerIds((prev) => new Set(prev).add(toner.id));
    setPendingTonerDelete({ toner, backup });

    Animated.timing(undoTonerAnim, {
      toValue: 1,
      duration: UNDO_ANIMATION_MS,
      useNativeDriver: true,
    }).start();

    // FIX: Schedule the actual deletion with ref-based timeout
    undoTonerTimeoutRef.current = setTimeout(async () => {
      if (!isMountedRef.current) return;
      
      try {
        await deleteDoc(doc(db, "toners", toner.id));
        
        // ACTIVITY: Log the deletion after timeout
        const prevStatus = getStockStatus(toner.quantity, toner.minQuantity);
        await logActivity({
          siteId: siteId || "default",
          itemName: toner.model,
          itemId: toner.id,
          qty: 0,
          min: toner.minQuantity,
          prevState: prevStatus,
          nextState: "OUT",
          action: "deleted",
          itemType: "toner",
        });
      } catch (e) {
        console.error("Error during scheduled toner delete:", e);
        if (isMountedRef.current) {
          setHiddenTonerIds((prev) => {
            const next = new Set(prev);
            next.delete(toner.id);
            return next;
          });
        }
      }
      
      if (isMountedRef.current) {
        dismissTonerUndoBanner();
      }
    }, UNDO_TIMEOUT_MS);
  }, [pendingTonerDelete, undoTonerAnim, dismissTonerUndoBanner, siteId]);

  // FIX: Refactored undoTonerDelete with proper cleanup
  const undoTonerDelete = useCallback(async () => {
    if (!pendingTonerDelete) return;

    if (undoTonerTimeoutRef.current) {
      clearTimeout(undoTonerTimeoutRef.current);
      undoTonerTimeoutRef.current = null;
    }

    const { toner, backup } = pendingTonerDelete;

    setHiddenTonerIds((prev) => {
      const next = new Set(prev);
      next.delete(toner.id);
      return next;
    });

    try {
      await setDoc(doc(db, "toners", toner.id), backup, { merge: true });
    } catch (e) {
      console.error("Error restoring toner:", e);
    }

    dismissTonerUndoBanner();
  }, [pendingTonerDelete, dismissTonerUndoBanner]);

  const filteredToners = useMemo(() => {
    let list = toners.filter((t) => !hiddenTonerIds.has(t.id));
    if (tonerSearch) {
      const q = tonerSearch.toLowerCase();
      list = list.filter((t) => t.model.toLowerCase().includes(q) || t.printer?.toLowerCase().includes(q));
    }
    if (showTonerLowOnly) {
      list = list.filter((t) => t.quantity <= t.minQuantity);
    }
    return list.sort((a, b) => a.model.localeCompare(b.model));
  }, [toners, tonerSearch, showTonerLowOnly, hiddenTonerIds]);

  // --- Printer Logic ---
  useEffect(() => {
    if (!siteId) return;
    const q = query(collection(db, "printers"), where("siteId", "==", siteId));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const newPrinters = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Printer));
        setPrinters(newPrinters);
        setPrintersLoading(false);
      },
      (err) => {
        console.error("printers onSnapshot error:", err);
        setPrintersLoading(false);
      }
    );
    return () => unsubscribe();
  }, [siteId]);

  const filteredPrinters = useMemo(() => {
    if (!printerSearch) return printers.sort((a, b) => a.name.localeCompare(b.name));
    const q = printerSearch.toLowerCase();
    return printers
      .filter((p) => p.name.toLowerCase().includes(q) || p.location?.toLowerCase().includes(q) || p.ipAddress?.includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [printers, printerSearch]);

  // --- Radio Logic ---
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

  const filteredTonerLinkList = useMemo(() => {
    if (!tonerLinkSearch) return tonerLinkList;
    return tonerLinkList.filter((t) => t.name.toLowerCase().includes(tonerLinkSearch.toLowerCase()));
  }, [tonerLinkList, tonerLinkSearch]);

  // ACTIVITY: Updated handleLinkToner to log activity when toner is linked to printer
  const handleLinkToner = async (toner: TonerLink) => {
    if (!selectedPrinter) return;
    try {
      await updateDoc(doc(db, "printers", selectedPrinter.id), { tonerId: toner.id });
      
      // ACTIVITY: Log the toner link activity
      await logActivity({
        siteId: siteId || "default",
        itemName: `${toner.name} → ${selectedPrinter.name}`,
        itemId: selectedPrinter.id,
        qty: toner.stock,
        min: 0,
        prevState: "OK",
        nextState: "OK",
        action: "linked",
        itemType: "printer",
      });
      
      setShowLinkModal(false);
      setSelectedPrinter(null);
      Alert.alert("Linked!", `${toner.name} linked to ${selectedPrinter.name}.`);
    } catch {
      Alert.alert("Error", "Failed to link toner.");
    }
  };

  // UNLINK: Handle unlinking a toner from a printer
  const handleUnlinkToner = async (printer: Printer) => {
    if (!printer.tonerId) return;
    const linkedToner = toners.find(t => t.id === printer.tonerId);
    Alert.alert(
      "Unlink Toner",
      `Remove ${linkedToner?.model || "toner"} from ${printer.name}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unlink",
          style: "destructive",
          onPress: async () => {
            try {
              await updateDoc(doc(db, "printers", printer.id), { tonerId: deleteField() });

              // ACTIVITY: Log the toner unlink activity
              await logActivity({
                siteId: siteId || "default",
                itemName: `${linkedToner?.model || "Unknown Toner"} ✕ ${printer.name}`,
                itemId: printer.id,
                qty: linkedToner?.quantity ?? 0,
                min: linkedToner?.minQuantity ?? 0,
                prevState: "OK",
                nextState: "OK",
                action: "unlinked",
                itemType: "printer",
              });

              Alert.alert("Unlinked!", `Toner removed from ${printer.name}.`);
            } catch {
              Alert.alert("Error", "Failed to unlink toner.");
            }
          },
        },
      ]
    );
  };

  // ACTIVITY: Updated handleDeductToner to log activity when toner quantity is deducted
  const handleDeductToner = async (printer: Printer) => {
    if (!printer.tonerId) return;
    
    // Find the toner to get its current quantity and minQuantity
    const linkedToner = toners.find(t => t.id === printer.tonerId);
    
    Alert.alert("Deduct Toner", `Use 1 toner for ${printer.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Deduct 1",
        onPress: async () => {
          try {
            const prevQty = linkedToner?.quantity ?? 1;
            const minQty = linkedToner?.minQuantity ?? 0;
            const newQty = Math.max(0, prevQty - 1);
            
            const prevStatus = getStockStatus(prevQty, minQty);
            const nextStatus = getStockStatus(newQty, minQty);
            
            await updateDoc(doc(db, "toners", printer.tonerId!), { quantity: increment(-1) });
            
            // ACTIVITY: Log the toner deduction activity
            await logActivity({
              siteId: siteId || "default",
              itemName: linkedToner?.model || "Unknown Toner",
              itemId: printer.tonerId!,
              qty: newQty,
              min: minQty,
              prevState: prevStatus,
              nextState: nextStatus,
              action: "deducted",
              itemType: "toner",
            });
          } catch {
            Alert.alert("Error", "Failed to update stock.");
          }
        },
      },
    ]);
  };

  const openTonerModal = (toner?: Toner) => {
    if (toner) {
      setEditingToner(toner);
      setTonerForm({
        model: toner.model,
        color: toner.color,
        quantity: String(toner.quantity),
        minQuantity: String(toner.minQuantity),
        printer: toner.printer || "",
        notes: toner.notes || "",
        barcode: toner.barcode || "",
      });
    } else {
      setEditingToner(null);
      setTonerForm({ model: "", color: "Black", quantity: "", minQuantity: "", printer: "", notes: "", barcode: "" });
    }
    setShowTonerModal(true);
  };

  // ACTIVITY: Updated saveToner to log activity when toners are added/edited
  const saveToner = async () => {
    if (!tonerForm.model || !tonerForm.quantity) {
      Alert.alert("Error", "Model and Quantity are required.");
      return;
    }
    
    const newQty = parseInt(tonerForm.quantity) || 0;
    const newMin = parseInt(tonerForm.minQuantity) || 0;
    
    const data = {
      ...tonerForm,
      quantity: newQty,
      minQuantity: newMin,
      siteId,
    };
    
    try {
      if (editingToner) {
        // ACTIVITY: Calculate previous and new status for editing
        const prevStatus = getStockStatus(editingToner.quantity, editingToner.minQuantity);
        const nextStatus = getStockStatus(newQty, newMin);
        
        await setDoc(doc(db, "toners", editingToner.id), data, { merge: true });
        
        // ACTIVITY: Log the edit activity
        await logActivity({
          siteId: siteId || "default",
          itemName: data.model,
          itemId: editingToner.id,
          qty: newQty,
          min: newMin,
          prevState: prevStatus,
          nextState: nextStatus,
          action: "edited",
          itemType: "toner",
        });
      } else {
        // Create new toner
        const docRef = await addDoc(collection(db, "toners"), data);
        
        // ACTIVITY: Log the add activity
        const nextStatus = getStockStatus(newQty, newMin);
        await logActivity({
          siteId: siteId || "default",
          itemName: data.model,
          itemId: docRef.id,
          qty: newQty,
          min: newMin,
          prevState: "OK", // New toners start from "OK" conceptually
          nextState: nextStatus,
          action: "added",
          itemType: "toner",
        });
      }
      setShowTonerModal(false);
    } catch (err) {
      Alert.alert("Error", "Failed to save toner.");
    }
  };

  // --- CSV Import Helpers ---
  const normalizeCell = (val: string): string => {
    if (!val) return "";
    const trimmed = val.trim();
    if (["nan", "none", "null", "-", "n/a"].includes(trimmed.toLowerCase())) return "";
    return trimmed;
  };

  const parseCSV = (content: string): string[][] => {
    const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length === 0) return [];
    const firstLine = lines[0];
    const delimiter = firstLine.includes("|") ? "|" : firstLine.includes(";") ? ";" : ",";
    return lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
  };

  // --- Import Inventory from CSV ---
  const importInventoryFromCSV = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "text/plain"],
      });
      if (result.canceled) return;

      setImportingInventory(true);
      const fileUri = result.assets[0].uri;
      const content = await FileSystem.readAsStringAsync(fileUri);
      const rows = parseCSV(content);

      if (rows.length < 2) {
        Alert.alert("Empty File", "No data rows found in the CSV.");
        return;
      }

      const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, ""));
      const col = (names: string[]) => {
        for (const n of names) {
          const idx = headers.findIndex((h) => h.includes(n));
          if (idx !== -1) return idx;
        }
        return -1;
      };

      const iName     = col(["name", "item", "description"]);
      const iQty      = col(["qty", "quantity", "amount", "stock"]);
      const iMinQty   = col(["min", "minimum", "minqty", "minstock"]);
      const iLocation = col(["location", "loc", "shelf", "room"]);
      const iBarcode  = col(["barcode", "sku", "upc"]);
      const iNotes    = col(["notes", "note", "desc"]);

      if (iName === -1) {
        Alert.alert("Import Failed", "Could not find a 'Name' or 'Item' column.");
        return;
      }

      const dataRows = rows.slice(1).filter((row) => normalizeCell(row[iName] ?? "") !== "");
      let count = 0;

      for (let i = 0; i < dataRows.length; i += 499) {
        const chunk = dataRows.slice(i, i + 499);
        const batch = writeBatch(db);
        for (const row of chunk) {
          const name = normalizeCell(row[iName] ?? "");
          if (!name) continue;

          const stableId = `${siteId}_${name}`
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "_")
            .replace(/_+/g, "_")
            .slice(0, 100);

          const docRef = doc(db, "items", stableId);
          batch.set(docRef, {
            name,
            currentQuantity: parseInt(normalizeCell(row[iQty] ?? "")) || 0,
            minQuantity:     parseInt(normalizeCell(row[iMinQty] ?? "")) || 0,
            location:        normalizeCell(row[iLocation] ?? ""),
            barcode:         normalizeCell(row[iBarcode] ?? ""),
            notes:           normalizeCell(row[iNotes] ?? ""),
            siteId:          siteId || "default",
            importedAt:      new Date().toISOString(),
          }, { merge: true });
          count++;
        }
        await batch.commit();
      }
      Alert.alert("Import Complete", `${count} inventory item${count !== 1 ? "s" : ""} imported/updated.`);
    } catch (err: any) {
      console.error("Inventory import error:", err);
      Alert.alert("Import Failed", err.message || "An unexpected error occurred.");
    } finally {
      setImportingInventory(false);
    }
  };

  // --- Import Toners from CSV ---
  const importTonersFromCSV = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "text/plain"],
      });
      if (result.canceled) return;

      setImportingToners(true);
      const fileUri = result.assets[0].uri;
      const content = await FileSystem.readAsStringAsync(fileUri);
      const rows = parseCSV(content);

      if (rows.length < 2) {
        Alert.alert("Empty File", "No data rows found in the CSV.");
        return;
      }

      const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, ""));
      const col = (names: string[]) => {
        for (const n of names) {
          const idx = headers.findIndex((h) => h.includes(n));
          if (idx !== -1) return idx;
        }
        return -1;
      };

      const iModel    = col(["model", "name", "toner"]);
      const iPart     = col(["part", "partnumber", "sku"]);
      const iColor    = col(["color", "colour", "type"]);
      const iQty      = col(["qty", "quantity", "amount", "stock"]);
      const iMinQty   = col(["min", "minimum", "minqty"]);
      const iPrinter  = col(["printer", "compatible", "machine"]);
      const iSupplier = col(["supplier", "vendor"]);
      const iNotes    = col(["notes", "note"]);

      if (iModel === -1) {
        Alert.alert("Import Failed", "Could not find a 'Model' or 'Name' column.");
        return;
      }

      const dataRows = rows.slice(1).filter((row) => normalizeCell(row[iModel] ?? "") !== "");
      let count = 0;

      for (let i = 0; i < dataRows.length; i += 499) {
        const chunk = dataRows.slice(i, i + 499);
        const batch = writeBatch(db);
        for (const row of chunk) {
          const model = normalizeCell(row[iModel] ?? "");
          if (!model) continue;

          const rawColor = normalizeCell(row[iColor] ?? "Black");
          const color = TONER_COLORS.find(
            (c) => c.toLowerCase() === rawColor.toLowerCase()
          ) || "Other";

          const stableId = `${siteId}_${model}_${color}`
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "_")
            .replace(/_+/g, "_")
            .slice(0, 100);

          const docRef = doc(db, "toners", stableId);
          batch.set(docRef, {
            model,
            partNumber:  normalizeCell(row[iPart] ?? ""),
            color,
            quantity:    parseInt(normalizeCell(row[iQty] ?? "")) || 0,
            minQuantity: parseInt(normalizeCell(row[iMinQty] ?? "")) || 0,
            printer:     normalizeCell(row[iPrinter] ?? ""),
            supplier:    normalizeCell(row[iSupplier] ?? ""),
            notes:       normalizeCell(row[iNotes] ?? ""),
            siteId:      siteId || "default",
            importedAt:  new Date().toISOString(),
          }, { merge: true });
          count++;
        }
        await batch.commit();
      }
      Alert.alert("Import Complete", `${count} toner${count !== 1 ? "s" : ""} imported/updated.`);
    } catch (err: any) {
      console.error("Toner import error:", err);
      Alert.alert("Import Failed", err.message || "An unexpected error occurred.");
    } finally {
      setImportingToners(false);
    }
  };

  // --- Import Printers from CSV ---
  const importPrintersFromCSV = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "text/plain"],
      });
      if (result.canceled) return;

      setImportingPrinters(true);
      const fileUri = result.assets[0].uri;
      const content = await FileSystem.readAsStringAsync(fileUri);
      const rows = parseCSV(content);

      if (rows.length < 2) {
        Alert.alert("Empty File", "No data rows found in the CSV.");
        return;
      }

      const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, ""));
      const col = (names: string[]) => {
        for (const n of names) {
          const idx = headers.findIndex((h) => h.includes(n));
          if (idx !== -1) return idx;
        }
        return -1;
      };

      const iName = col(["name", "printer"]);
      const iLocation = col(["location", "loc"]);
      const iIp = col(["ip", "ipaddress", "ip_address"]);
      const iAsset = col(["asset", "assetnumber"]);
      const iSerial = col(["serial", "sn"]);
      const iTonerSeries = col(["toner", "tonerseries"]);
      const iBarcode = col(["barcode", "sku", "upc"]);
      const iNotes = col(["notes", "note"]);

      if (iName === -1) {
        Alert.alert("Import Failed", "Could not find a 'Name' column.");
        return;
      }

      const dataRows = rows.slice(1).filter((row) => normalizeCell(row[iName] ?? "") !== "");
      let count = 0;

      for (let i = 0; i < dataRows.length; i += 499) {
        const chunk = dataRows.slice(i, i + 499);
        const batch = writeBatch(db);
        for (const row of chunk) {
          const name = normalizeCell(row[iName] ?? "");
          if (!name) continue;

          const stableId = `${siteId}_${name}`
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "_")
            .replace(/_+/g, "_")
            .slice(0, 100);

          const docRef = doc(db, "printers", stableId);
          batch.set(docRef, {
            name,
            location:    normalizeCell(row[iLocation] ?? ""),
            ipAddress:   normalizeCell(row[iIp] ?? ""),
            assetNumber: normalizeCell(row[iAsset] ?? ""),
            serial:      normalizeCell(row[iSerial] ?? ""),
            tonerSeries: normalizeCell(row[iTonerSeries] ?? ""),
            barcode:     normalizeCell(row[iBarcode] ?? ""),
            notes:       normalizeCell(row[iNotes] ?? ""),
            siteId:      siteId || "default",
            importedAt:  new Date().toISOString(),
          }, { merge: true });
          count++;
        }
        await batch.commit();
      }
      Alert.alert("Import Complete", `${count} printer${count !== 1 ? "s" : ""} imported/updated.`);
    } catch (err: any) {
      console.error("Printer import error:", err);
      Alert.alert("Import Failed", err.message || "An unexpected error occurred.");
    } finally {
      setImportingPrinters(false);
    }
  };

  // --- Import Radios from CSV ---
  const importRadiosFromCSV = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "text/plain"],
      });
      if (result.canceled) return;

      setImportingRadios(true);
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const rows = parseCSV(content);

      if (rows.length < 2) { Alert.alert("Empty File", "No data rows found in the CSV."); return; }

      const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, ""));
      const col = (names: string[]) => {
        for (const n of names) { const idx = headers.findIndex((h) => h.includes(n)); if (idx !== -1) return idx; }
        return -1;
      };

      const iModel    = col(["model", "name", "radio"]);
      const iSerial   = col(["serial", "serialnumber", "sn"]);
      const iChannel  = col(["channel", "chan"]);
      const iAssigned = col(["assigned", "assignedto", "user", "person"]);
      const iLocation = col(["location", "loc"]);
      const iCondition = col(["condition", "status", "state"]);
      const iNotes    = col(["notes", "note"]);

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
          batch.set(docRef, {
            model,
            serialNumber: normalizeCell(row[iSerial] ?? ""),
            channel:      normalizeCell(row[iChannel] ?? ""),
            assignedTo:   normalizeCell(row[iAssigned] ?? ""),
            location:     normalizeCell(row[iLocation] ?? ""),
            condition,
            notes:        normalizeCell(row[iNotes] ?? ""),
            siteId:       siteId || "default",
            importedAt:   new Date().toISOString(),
          }, { merge: true });
          count++;
        }
        await batch.commit();
      }
      Alert.alert("Import Complete", `${count} radio${count !== 1 ? "s" : ""} imported/updated.`);
    } catch (err: any) {
      console.error("Radio import error:", err);
      Alert.alert("Import Failed", err.message || "An unexpected error occurred.");
    } finally {
      setImportingRadios(false);
    }
  };

  // --- Import Radio Parts from CSV ---
  const importRadioPartsFromCSV = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "text/plain"],
      });
      if (result.canceled) return;

      setImportingRadioParts(true);
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const rows = parseCSV(content);

      if (rows.length < 2) { Alert.alert("Empty File", "No data rows found in the CSV."); return; }

      const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, ""));
      const col = (names: string[]) => {
        for (const n of names) { const idx = headers.findIndex((h) => h.includes(n)); if (idx !== -1) return idx; }
        return -1;
      };

      const iName     = col(["name", "part", "item"]);
      const iCompat   = col(["compatible", "model", "compatiblemodel"]);
      const iQty      = col(["qty", "quantity", "amount", "stock"]);
      const iMin      = col(["min", "minimum", "minqty"]);
      const iLocation = col(["location", "loc"]);
      const iNotes    = col(["notes", "note"]);

      if (iName === -1) { Alert.alert("Import Failed", "Could not find a 'Name' or 'Part' column."); return; }

      const dataRows = rows.slice(1).filter((row) => normalizeCell(row[iName] ?? "") !== "");
      let count = 0;

      for (let i = 0; i < dataRows.length; i += 499) {
        const chunk = dataRows.slice(i, i + 499);
        const batch = writeBatch(db);
        for (const row of chunk) {
          const name = normalizeCell(row[iName] ?? "");
          if (!name) continue;
          const docRef = doc(db, "radioParts", `${siteId}_${name}`
            .toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 100));
          batch.set(docRef, {
            name,
            compatibleModel: normalizeCell(row[iCompat] ?? ""),
            quantity:        parseInt(normalizeCell(row[iQty] ?? "")) || 0,
            minQuantity:     parseInt(normalizeCell(row[iMin] ?? "")) || 0,
            location:        normalizeCell(row[iLocation] ?? ""),
            notes:           normalizeCell(row[iNotes] ?? ""),
            siteId:          siteId || "default",
            importedAt:      new Date().toISOString(),
          }, { merge: true });
          count++;
        }
        await batch.commit();
      }
      Alert.alert("Import Complete", `${count} part${count !== 1 ? "s" : ""} imported/updated.`);
    } catch (err: any) {
      console.error("Radio parts import error:", err);
      Alert.alert("Import Failed", err.message || "An unexpected error occurred.");
    } finally {
      setImportingRadioParts(false);
    }
  };

  // --- Export Radios to CSV ---
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
    } catch (err: any) {
      Alert.alert("Export Failed", err.message || "An unexpected error occurred.");
    }
  };

  // --- Export Radio Parts to CSV ---
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
    } catch (err: any) {
      Alert.alert("Export Failed", err.message || "An unexpected error occurred.");
    }
  };

  // --- CSV Templates ---
  const downloadInventoryTemplate = async () => {
    try {
      const content = [
        "Name,Current Quantity,Min Quantity,Location,Barcode,Notes",
        '"AA Batteries",24,10,"Storage Room A, Shelf 3","012345678901","Check expiry dates"',
        '"Copy Paper (Ream)",15,5,"Supply Closet","","Letter size 8.5x11"',
      ].join("\n");
      const uri = FileSystem.cacheDirectory + "inventory_template.csv";
      await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Inventory CSV Template" });
    } catch (err: any) { Alert.alert("Error", err.message || "Could not generate template."); }
  };

  const downloadTonerTemplate = async () => {
    try {
      const content = [
        "Model,Color,Quantity,Min Qty,Printer",
        '"CF217A",Black,3,1,"HP LaserJet Pro M102"',
        '"202X",Cyan,2,1,"HP Color LaserJet M479"',
      ].join("\n");
      const uri = FileSystem.cacheDirectory + "toner_template.csv";
      await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Toner CSV Template" });
    } catch (err: any) { Alert.alert("Error", err.message || "Could not generate template."); }
  };

  const downloadPrinterTemplate = async () => {
    try {
      const content = [
        "Name,Location,IP Address,Asset Number,Serial,Toner Series,Barcode,Notes",
        '"HP LaserJet Pro M404","Front Office","192.168.1.50","AST-001","VNC3W12345","CF217A-series","","Main office printer"',
        '"Canon PIXMA G3260","Break Room","192.168.1.51","AST-002","","","","Color printer"',
      ].join("\n");
      const uri = FileSystem.cacheDirectory + "printer_template.csv";
      await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Printer CSV Template" });
    } catch (err: any) { Alert.alert("Error", err.message || "Could not generate template."); }
  };

  const downloadRadioTemplate = async () => {
    try {
      const content = [
        "Model,Serial Number,Channel,Assigned To,Location,Condition,Notes",
        '"Motorola RDU2020","ABC123","Ch 3","John Smith","Security Desk","Good",""',
        '"Kenwood TK-2400","XYZ456","Ch 1","Jane Doe","Front Desk","Good",""',
      ].join("\n");
      const uri = FileSystem.cacheDirectory + "radio_template.csv";
      await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Radio CSV Template" });
    } catch (err: any) { Alert.alert("Error", err.message || "Could not generate template."); }
  };

  const downloadRadioPartTemplate = async () => {
    try {
      const content = [
        "Name,Compatible Model,Quantity,Min Quantity,Location,Barcode,Notes",
        '"Belt Clip","Motorola RDU2020",5,2,"Storage Room B","","Standard clip"',
        '"Battery Pack","Kenwood TK-2400",3,1,"Storage Room B","012345678902",""',
      ].join("\n");
      const uri = FileSystem.cacheDirectory + "radio_parts_template.csv";
      await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Radio Parts CSV Template" });
    } catch (err: any) { Alert.alert("Error", err.message || "Could not generate template."); }
  };

  const downloadDisposalTemplate = async () => {
    try {
      const content = [
        "Item Name,Model,Quantity,Unit Value ($),Vendor,Total Value ($),Approx Age,Description,Disposed By",
        '"HP LaserJet Pro","M404",1,150.00,"HP Direct",150.00,"4 years","End of life - replaced with newer model","John Smith"',
        '"Office Chair","",3,25.00,"",75.00,"6 years","Broken - unrepairable","Jane Doe"',
      ].join("\n");
      const uri = FileSystem.cacheDirectory + "disposal_template.csv";
      await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Asset Disposal CSV Template" });
    } catch (err: any) { Alert.alert("Error", err.message || "Could not generate template."); }
  };

  // ACTIVITY: Updated savePrinter to log activity when printers are added/edited
  const savePrinter = async () => {
    if (!printerForm.name) {
      Alert.alert("Error", "Name is required.");
      return;
    }
    const data = { ...printerForm, siteId };
    try {
      if (editingPrinter) {
        await setDoc(doc(db, "printers", editingPrinter.id), data, { merge: true });
        
        // ACTIVITY: Log the edit activity for printer
        await logActivity({
          siteId: siteId || "default",
          itemName: data.name,
          itemId: editingPrinter.id,
          qty: 0, // Printers don't have quantity
          min: 0,
          prevState: "OK",
          nextState: "OK",
          action: "edited",
          itemType: "printer",
        });
      } else {
        // Create new printer
        const docRef = await addDoc(collection(db, "printers"), data);
        
        // ACTIVITY: Log the add activity for printer
        await logActivity({
          siteId: siteId || "default",
          itemName: data.name,
          itemId: docRef.id,
          qty: 0, // Printers don't have quantity
          min: 0,
          prevState: "OK",
          nextState: "OK",
          action: "added",
          itemType: "printer",
        });
      }
      setShowPrinterModal(false);
    } catch (err) {
      Alert.alert("Error", "Failed to save printer.");
    }
  };

  const deletePrinter = (printer: Printer) => {
    Alert.alert("Delete Printer", `Remove ${printer.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          try {
            await deleteDoc(doc(db, "printers", printer.id));
            setShowPrinterModal(false);
            setEditingPrinter(null);
          } catch (err: any) { Alert.alert("Error", err.message || "Failed to delete printer."); }
        },
      },
    ]);
  };

  const renderToner = ({ item }: { item: Toner }) => (
    <Pressable onPress={() => openTonerModal(item)}>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.itemName, { color: theme.text }]}>{item.model}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
            <Ionicons name="print-outline" size={14} color={theme.mutedText} style={{ marginRight: 4 }} />
            <Text style={{ color: theme.mutedText, fontSize: 12 }}>{item.printer || "Universal"}</Text>
          </View>
          {item.partNumber ? (
            <Text style={{ color: theme.mutedText, fontSize: 11, marginTop: 2 }}>Part: {item.partNumber}</Text>
          ) : null}
        </View>
        <View style={styles.rightControls}>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ color: item.quantity <= item.minQuantity ? "#ef4444" : theme.text, fontWeight: "800", fontSize: 18 }}>
              {item.quantity}
            </Text>
            <Text style={{ color: theme.mutedText, fontSize: 10 }}>{item.color.toUpperCase()}</Text>
            {item.quantity <= item.minQuantity && (
              <Text style={{ color: "#ef4444", fontSize: 10, fontWeight: "700" }}>LOW</Text>
            )}
          </View>
          <Pressable onPress={() => scheduleTonerDelete(item)} style={{ padding: 4 }}>
            <Ionicons name="trash-outline" size={20} color="#ef4444" />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );

  // FIX: Removed outer Pressable wrapper to avoid nested Pressable touch conflicts.
  // The printer info area is now its own Pressable for editing, while LINK TONER / DEDUCT
  // buttons are sibling Pressable components that don't interfere with each other.
  const renderPrinter = ({ item }: { item: Printer }) => (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Pressable
        style={{ flex: 1 }}
        onPress={() => {
          setEditingPrinter(item);
          setPrinterForm({
            name: item.name || "",
            location: item.location || "",
            ipAddress: item.ipAddress || "",
            assetNumber: item.assetNumber || "",
            serial: item.serial || "",
            tonerSeries: item.tonerSeries || "",
            barcode: item.barcode || "",
            notes: item.notes || "",
          });
          setShowPrinterModal(true);
        }}
      >
        <Text style={[styles.itemName, { color: theme.text }]}>{item.name}</Text>
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
        {/* Live Toner Stock Badge */}
        {item.tonerId && (
          <View style={{ marginTop: 6 }}>
            <TonerStockBadge tonerId={item.tonerId} theme={theme} />
          </View>
        )}
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
            <Pressable
              hitSlop={8}
              style={[styles.actionButton, { backgroundColor: "#ef4444" }]}
              onPress={() => handleDeductToner(item)}
            >
              <Text style={styles.actionButtonText}>DEDUCT 1</Text>
            </Pressable>
            <Pressable
              hitSlop={8}
              style={[styles.actionButton, { backgroundColor: "#f59e0b" }]}
              onPress={() => handleUnlinkToner(item)}
            >
              <Text style={styles.actionButtonText}>UNLINK</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            hitSlop={8}
            style={[styles.actionButton, { backgroundColor: "#2563eb" }]}
            onPress={() => {
              setSelectedPrinter(item);
              setTonerLinkSearch("");
              setShowLinkModal(true);
            }}
          >
            <Text style={styles.actionButtonText}>LINK TONER</Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  // --- NEW: Render inventory item with tap-to-edit functionality ---
  // FIX: Removed outer Pressable wrapper to avoid nested Pressable touch conflicts.
  const CONDITION_COLOR: Record<string, string> = { Good: "#22c55e", Fair: "#f59e0b", Poor: "#ef4444", "Out of Service": "#6b7280" };

  const renderRadio = ({ item }: { item: Radio }) => (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Pressable onPress={() => openRadioModal(item)} style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
          <Text style={[styles.itemName, { color: theme.text }]}>{item.model}</Text>
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
  );

  const renderRadioPart = ({ item }: { item: RadioPart }) => (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Pressable onPress={() => openRadioPartModal(item)} style={{ flex: 1 }}>
        <Text style={[styles.itemName, { color: theme.text }]}>{item.name}</Text>
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
  );

  // The item info area is now its own Pressable for editing, while dispose/delete buttons
  // are sibling Pressable components that don't interfere with each other.
  const renderInventoryItem = ({ item }: { item: Item }) => (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Pressable onPress={() => router.push(`/item/${item.id}`)} style={{ flex: 1 }}>
        <Text style={[styles.itemName, { color: theme.text }]}>{item.name}</Text>
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
        {item.notes ? (
          <Text style={{ color: theme.mutedText, fontSize: 11, marginTop: 4, fontStyle: "italic" }} numberOfLines={2}>
            {item.notes}
          </Text>
        ) : null}
      </Pressable>
      <View style={styles.rightControls}>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: item.currentQuantity <= item.minQuantity ? "#ef4444" : theme.text, fontWeight: "800", fontSize: 18 }}>
            {item.currentQuantity}
          </Text>
          <Text style={{ color: theme.mutedText, fontSize: 10 }}>STOCK</Text>
          {item.currentQuantity <= item.minQuantity && (
            <Text style={{ color: "#ef4444", fontSize: 10, fontWeight: "700" }}>LOW</Text>
          )}
        </View>
        {/* DISPOSE: Dispose button to open disposal modal */}
        <Pressable
          onPress={() => openDisposeModal(item)}
          hitSlop={8}
          style={{ padding: 6 }}
        >
          <Ionicons name="archive-outline" size={20} color="#f97316" />
        </Pressable>
        {/* Delete button */}
        <Pressable
          onPress={() => scheduleDelete(item)}
          hitSlop={8}
          style={{ padding: 6 }}
        >
          <Ionicons name="trash-outline" size={20} color="#ef4444" />
        </Pressable>
      </View>
    </View>
  );

  if (profileLoading || loading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background, justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={theme.tint} />
      </View>
    );
  }

  // FIX: Compute pointerEvents based on state to prevent touch blocking
  const inventoryUndoPointerEvents = pendingDelete ? "auto" : "none";
  const tonerUndoPointerEvents = pendingTonerDelete ? "auto" : "none";

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Control Deck</Text>
        <View style={[styles.tabBar, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Pressable
            onPress={() => setActiveTab("inventory")}
            style={[styles.tab, activeTab === "inventory" && { backgroundColor: theme.background, borderColor: theme.border }]}
          >
            <Text style={[styles.tabText, { color: activeTab === "inventory" ? theme.text : theme.mutedText }]}>Inventory</Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab("toners")}
            style={[styles.tab, activeTab === "toners" && { backgroundColor: theme.background, borderColor: theme.border }]}
          >
            <Text style={[styles.tabText, { color: activeTab === "toners" ? theme.text : theme.mutedText }]}>Toners & Printers</Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab("radios")}
            style={[styles.tab, activeTab === "radios" && { backgroundColor: theme.background, borderColor: theme.border }]}
          >
            <Text style={[styles.tabText, { color: activeTab === "radios" ? theme.text : theme.mutedText }]}>Radios</Text>
          </Pressable>
        </View>
      </View>

      {activeTab === "inventory" ? (
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => item.id}
          // NEW: Use renderInventoryItem function with tap-to-edit support
          renderItem={renderInventoryItem}
          contentContainerStyle={{ padding: 16 }}
          ListHeaderComponent={
            <>
              {/* Dashboard Summary */}
              <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
                <View style={[styles.statCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <Text style={[styles.statValue, { color: theme.text }]}>{summaryStats.totalItems}</Text>
                  <Text style={[styles.statLabel, { color: theme.mutedText }]}>Items</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: theme.card, borderColor: summaryStats.lowStock > 0 ? "#f9731640" : theme.border }]}>
                  <Text style={[styles.statValue, { color: summaryStats.lowStock > 0 ? "#f97316" : theme.text }]}>{summaryStats.lowStock}</Text>
                  <Text style={[styles.statLabel, { color: theme.mutedText }]}>Low</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: theme.card, borderColor: summaryStats.outOfStock > 0 ? "#ef444440" : theme.border }]}>
                  <Text style={[styles.statValue, { color: summaryStats.outOfStock > 0 ? "#ef4444" : theme.text }]}>{summaryStats.outOfStock}</Text>
                  <Text style={[styles.statLabel, { color: theme.mutedText }]}>Out</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <Text style={[styles.statValue, { color: "#8b5cf6" }]}>{summaryStats.totalToners}</Text>
                  <Text style={[styles.statLabel, { color: theme.mutedText }]}>Toners</Text>
                </View>
              </View>

              {/* NEW: Add button row with Import CSV and Add Item buttons */}
              <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
                <Pressable
                  onPress={importInventoryFromCSV}
                  disabled={importingInventory}
                  style={[styles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, flex: 1, marginBottom: 0 }]}
                >
                  {importingInventory
                    ? <ActivityIndicator size="small" color={theme.text} />
                    : <><Ionicons name="cloud-upload-outline" size={16} color={theme.text} style={{ marginRight: 6 }} /><Text style={[styles.importBtnText, { color: theme.text }]}>Import CSV</Text></>
                  }
                </Pressable>
                <Pressable
                  onPress={downloadInventoryTemplate}
                  style={[styles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12, marginBottom: 0 }]}
                >
                  <Ionicons name="document-outline" size={18} color={theme.text} />
                </Pressable>
                <Pressable
                  onPress={openScanModal}
                  style={[styles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12, marginBottom: 0 }]}
                >
                  <Ionicons name="barcode-outline" size={18} color={theme.text} />
                </Pressable>
                <Pressable
                  onPress={() => openInventoryModal()}
                  style={[styles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12, marginBottom: 0 }]}
                >
                  <Ionicons name="add" size={18} color={theme.text} />
                </Pressable>
              </View>
              <TextInput
                style={[styles.searchInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
                placeholder="Search inventory..."
                placeholderTextColor={theme.mutedText}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              <View style={styles.filterRow}>
                <View style={styles.sortGroup}>
                  <Pressable
                    onPress={() => setSortMode("name")}
                    style={[styles.chipSmall, { backgroundColor: sortMode === "name" ? theme.text : "transparent", borderColor: theme.border }]}
                  >
                    <Text style={[styles.chipTextSmall, { color: sortMode === "name" ? theme.background : theme.mutedText }]}>A-Z</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setSortMode("stock")}
                    style={[styles.chipSmall, { backgroundColor: sortMode === "stock" ? theme.text : "transparent", borderColor: theme.border }]}
                  >
                    <Text style={[styles.chipTextSmall, { color: sortMode === "stock" ? theme.background : theme.mutedText }]}>Stock</Text>
                  </Pressable>
                </View>
                <Pressable
                  onPress={() => setShowLowOnly(!showLowOnly)}
                  style={[styles.chipSmall, { backgroundColor: showLowOnly ? "#ef4444" : "transparent", borderColor: showLowOnly ? "#ef4444" : theme.border }]}
                >
                  <Text style={[styles.chipTextSmall, { color: showLowOnly ? "#fff" : theme.mutedText }]}>Low Stock</Text>
                </Pressable>
              </View>
            </>
          }
        />
      ) : activeTab === "toners" ? (
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", paddingHorizontal: 16, marginBottom: 12, gap: 12 }}>
            <Pressable
              onPress={() => setTonerSubTab("toners")}
              style={{ flex: 1, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: tonerSubTab === "toners" ? theme.text : "transparent" }}
            >
              <Text style={{ textAlign: "center", color: tonerSubTab === "toners" ? theme.text : theme.mutedText, fontWeight: "700" }}>
                Toner Inventory
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setTonerSubTab("printers")}
              style={{ flex: 1, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: tonerSubTab === "printers" ? theme.text : "transparent" }}
            >
              <Text style={{ textAlign: "center", color: tonerSubTab === "printers" ? theme.text : theme.mutedText, fontWeight: "700" }}>
                Printers ({printers.length})
              </Text>
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
                    <Pressable
                      onPress={importTonersFromCSV}
                      disabled={importingToners}
                      style={[styles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, flex: 1, marginBottom: 0 }]}
                    >
                      {importingToners
                        ? <ActivityIndicator size="small" color={theme.text} />
                        : <><Ionicons name="cloud-upload-outline" size={16} color={theme.text} style={{ marginRight: 6 }} /><Text style={[styles.importBtnText, { color: theme.text }]}>Import CSV</Text></>
                      }
                    </Pressable>
                    <Pressable
                      onPress={downloadTonerTemplate}
                      style={[styles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12, marginBottom: 0 }]}
                    >
                      <Ionicons name="document-outline" size={18} color={theme.text} />
                    </Pressable>
                  </View>
                  <View style={styles.tonerHeaderRow}>
                    <TextInput
                      style={[styles.searchInput, { flex: 1, backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
                      placeholder="Search toners..."
                      placeholderTextColor={theme.mutedText}
                      value={tonerSearch}
                      onChangeText={setTonerSearch}
                    />
                    <Pressable
                      onPress={() => setShowTonerLowOnly(!showTonerLowOnly)}
                      style={[styles.chipSmall, { height: 38, justifyContent: "center", backgroundColor: showTonerLowOnly ? "#ef4444" : "transparent", borderColor: showTonerLowOnly ? "#ef4444" : theme.border }]}
                    >
                      <Text style={[styles.chipTextSmall, { color: showTonerLowOnly ? "#fff" : theme.mutedText }]}>Low</Text>
                    </Pressable>
                    <Pressable onPress={() => openTonerModal()} style={[styles.addTonerBtn, { backgroundColor: theme.text }]}>
                      <Ionicons name="add" size={24} color={theme.background} />
                    </Pressable>
                  </View>
                </>
              }
            />
          ) : (
            <FlatList
              data={filteredPrinters}
              keyExtractor={(item) => item.id}
              renderItem={renderPrinter}
              contentContainerStyle={{ padding: 16 }}
              ListHeaderComponent={
                <>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <Pressable
                    onPress={importPrintersFromCSV}
                    disabled={importingPrinters}
                    style={[styles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, flex: 1 }]}
                  >
                    {importingPrinters
                      ? <ActivityIndicator size="small" color={theme.text} />
                      : <><Ionicons name="cloud-upload-outline" size={16} color={theme.text} style={{ marginRight: 6 }} /><Text style={[styles.importBtnText, { color: theme.text }]}>Import CSV</Text></>
                    }
                  </Pressable>
                  <Pressable
                    onPress={downloadPrinterTemplate}
                    style={[styles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12 }]}
                  >
                    <Ionicons name="document-outline" size={18} color={theme.text} />
                  </Pressable>
                  <Pressable
                    onPress={() => { setEditingPrinter(null); setPrinterForm({ name: '', location: '', ipAddress: '', assetNumber: '', serial: '', tonerSeries: '', barcode: '', notes: '' }); setShowPrinterModal(true); }}
                    style={[styles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12 }]}
                  >
                    <Ionicons name="add" size={18} color={theme.text} />
                  </Pressable>
                </View>
                <TextInput
                  style={[styles.searchInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
                  placeholder="Search printers..."
                  placeholderTextColor={theme.mutedText}
                  value={printerSearch}
                  onChangeText={setPrinterSearch}
                />
              </>
              }
            />
          )}
        </View>
      ) : activeTab === "radios" ? (
        <View style={{ flex: 1 }}>
          {/* Radios sub-tab bar */}
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
                      style={[styles.searchInput, { flex: 1, backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
                      placeholder="Search radios..."
                      placeholderTextColor={theme.mutedText}
                      value={radioSearch}
                      onChangeText={setRadioSearch}
                    />
                    <Pressable onPress={() => openRadioModal()} style={[styles.addTonerBtn, { backgroundColor: theme.text }]}>
                      <Ionicons name="add" size={24} color={theme.background} />
                    </Pressable>
                  </View>
                  <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
                    <Pressable
                      onPress={importRadiosFromCSV}
                      disabled={importingRadios}
                      style={[styles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, flex: 1, marginBottom: 0 }]}
                    >
                      {importingRadios
                        ? <ActivityIndicator size="small" color={theme.text} />
                        : <><Ionicons name="cloud-upload-outline" size={16} color={theme.text} style={{ marginRight: 6 }} /><Text style={[styles.importBtnText, { color: theme.text }]}>Import CSV</Text></>
                      }
                    </Pressable>
                    <Pressable
                      onPress={exportRadiosToCSV}
                      style={[styles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, flex: 1, marginBottom: 0 }]}
                    >
                      <Ionicons name="cloud-download-outline" size={16} color={theme.text} style={{ marginRight: 6 }} />
                      <Text style={[styles.importBtnText, { color: theme.text }]}>Export CSV</Text>
                    </Pressable>
                    <Pressable
                      onPress={downloadRadioTemplate}
                      style={[styles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12, marginBottom: 0 }]}
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
                      style={[styles.searchInput, { flex: 1, backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
                      placeholder="Search parts..."
                      placeholderTextColor={theme.mutedText}
                      value={radioPartSearch}
                      onChangeText={setRadioPartSearch}
                    />
                    <Pressable onPress={() => openRadioPartModal()} style={[styles.addTonerBtn, { backgroundColor: theme.text }]}>
                      <Ionicons name="add" size={24} color={theme.background} />
                    </Pressable>
                  </View>
                  <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
                    <Pressable
                      onPress={importRadioPartsFromCSV}
                      disabled={importingRadioParts}
                      style={[styles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, flex: 1, marginBottom: 0 }]}
                    >
                      {importingRadioParts
                        ? <ActivityIndicator size="small" color={theme.text} />
                        : <><Ionicons name="cloud-upload-outline" size={16} color={theme.text} style={{ marginRight: 6 }} /><Text style={[styles.importBtnText, { color: theme.text }]}>Import CSV</Text></>
                      }
                    </Pressable>
                    <Pressable
                      onPress={exportRadioPartsToCSV}
                      style={[styles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, flex: 1, marginBottom: 0 }]}
                    >
                      <Ionicons name="cloud-download-outline" size={16} color={theme.text} style={{ marginRight: 6 }} />
                      <Text style={[styles.importBtnText, { color: theme.text }]}>Export CSV</Text>
                    </Pressable>
                    <Pressable
                      onPress={downloadRadioPartTemplate}
                      style={[styles.importBtn, { borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12, marginBottom: 0 }]}
                    >
                      <Ionicons name="document-outline" size={18} color={theme.text} />
                    </Pressable>
                  </View>
                </>
              }
              ListEmptyComponent={<Text style={{ color: theme.mutedText, textAlign: "center", marginTop: 40 }}>No parts yet. Tap + to add one.</Text>}
            />
          )}
        </View>
      ) : null}

      {/* FIX: Inventory Undo Bar - Always rendered, visibility controlled by animation + pointerEvents */}
      <Animated.View
        pointerEvents={inventoryUndoPointerEvents}
        style={[
          styles.undoBar,
          {
            backgroundColor: theme.card,
            borderColor: theme.border,
            bottom: 16,
            opacity: undoAnim,
            zIndex: 1000,
            transform: [{ translateY: undoAnim.interpolate({ inputRange: [0, 1], outputRange: [120, 0] }) }],
          },
        ]}
      >
        <Text style={{ color: theme.text, fontWeight: "700" }}>Item deleted</Text>
        <Pressable
          onPress={undoDelete}
          style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#fff", borderRadius: 8 }}
        >
          <Text style={{ color: "#000", fontWeight: "800" }}>UNDO</Text>
        </Pressable>
      </Animated.View>

      {/* FIX: Toner Undo Bar - Always rendered, visibility controlled by animation + pointerEvents */}
      <Animated.View
        pointerEvents={tonerUndoPointerEvents}
        style={[
          styles.undoBar,
          {
            backgroundColor: theme.card,
            borderColor: theme.border,
            bottom: 80, // FIX: Offset to avoid overlap with inventory undo bar
            opacity: undoTonerAnim,
            zIndex: 1001, // FIX: Higher z-index for toner bar
            transform: [{ translateY: undoTonerAnim.interpolate({ inputRange: [0, 1], outputRange: [120, 0] }) }],
          },
        ]}
      >
        <Text style={{ color: theme.text, fontWeight: "700" }}>Toner deleted</Text>
        <Pressable
          onPress={undoTonerDelete}
          style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#fff", borderRadius: 8 }}
        >
          <Text style={{ color: "#000", fontWeight: "800" }}>UNDO</Text>
        </Pressable>
      </Animated.View>

      {/* NEW: Inventory Item Edit Modal */}
      {/* Radio Modal */}
      <Modal visible={showRadioModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowRadioModal(false)}>
        <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{editingRadio ? "Edit Radio" : "Add Radio"}</Text>
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
                <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>{label}</Text>
                <TextInput
                  style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                  placeholder={placeholder}
                  placeholderTextColor={theme.mutedText}
                  value={(radioForm as any)[key]}
                  onChangeText={(v) => setRadioForm((p) => ({ ...p, [key]: v }))}
                />
              </View>
            ))}
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Condition</Text>
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
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Notes</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, height: 80, textAlignVertical: "top" }]}
              placeholder="Additional notes..."
              placeholderTextColor={theme.mutedText}
              multiline
              value={radioForm.notes}
              onChangeText={(v) => setRadioForm((p) => ({ ...p, notes: v }))}
            />
            <Pressable style={[styles.saveBtn, { backgroundColor: theme.tint }]} onPress={saveRadio}>
              <Text style={{ color: "#000", fontWeight: "800", fontSize: 16 }}>{editingRadio ? "Save Changes" : "Add Radio"}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {/* Radio Part Modal */}
      <Modal visible={showRadioPartModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowRadioPartModal(false)}>
        <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{editingRadioPart ? "Edit Part" : "Add Radio Part"}</Text>
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
                <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>{label}</Text>
                <TextInput
                  style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                  placeholder={placeholder}
                  placeholderTextColor={theme.mutedText}
                  value={(radioPartForm as any)[key]}
                  onChangeText={(v) => setRadioPartForm((p) => ({ ...p, [key]: v }))}
                />
              </View>
            ))}
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Quantity</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="0"
              placeholderTextColor={theme.mutedText}
              keyboardType="numeric"
              value={radioPartForm.quantity}
              onChangeText={(v) => setRadioPartForm((p) => ({ ...p, quantity: v }))}
            />
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Min Quantity</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="0"
              placeholderTextColor={theme.mutedText}
              keyboardType="numeric"
              value={radioPartForm.minQuantity}
              onChangeText={(v) => setRadioPartForm((p) => ({ ...p, minQuantity: v }))}
            />
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Notes</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, height: 80, textAlignVertical: "top" }]}
              placeholder="Additional notes..."
              placeholderTextColor={theme.mutedText}
              multiline
              value={radioPartForm.notes}
              onChangeText={(v) => setRadioPartForm((p) => ({ ...p, notes: v }))}
            />
            <Pressable style={[styles.saveBtn, { backgroundColor: theme.tint }]} onPress={saveRadioPart}>
              <Text style={{ color: "#000", fontWeight: "800", fontSize: 16 }}>{editingRadioPart ? "Save Changes" : "Add Part"}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {/* Scanner Modal */}
      <Modal visible={showScanModal} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setShowScanModal(false)}>
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            onBarcodeScanned={scanningEnabled ? handleBarcodeScanned : undefined}
          />
          <View style={{ position: "absolute", left: 16, right: 16, bottom: 48, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 16, padding: 16 }}>
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16, marginBottom: 12 }}>
              {scanBusy ? "Looking up barcode…" : scanningEnabled ? "Point at a barcode" : "Paused"}
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => { setScanBusy(false); setScanningEnabled(true); }}
                style={{ flex: 1, backgroundColor: theme.tint, paddingVertical: 10, borderRadius: 999, alignItems: "center" }}
              >
                <Text style={{ color: "#000", fontWeight: "800" }}>Scan again</Text>
              </Pressable>
              <Pressable
                onPress={() => setShowScanModal(false)}
                style={{ flex: 1, backgroundColor: "#374151", paddingVertical: 10, borderRadius: 999, alignItems: "center" }}
              >
                <Text style={{ color: "#fff", fontWeight: "800" }}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* This modal allows users to view and edit all inventory item fields */}
      <Modal visible={showInventoryModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowInventoryModal(false)}>
        <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Add New Item</Text>
            <Pressable onPress={() => setShowInventoryModal(false)}>
              <Ionicons name="close" size={24} color={theme.text} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Item Name Field */}
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Item Name *</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="e.g. AA Batteries"
              placeholderTextColor={theme.mutedText}
              value={itemForm.name}
              onChangeText={(v) => setItemForm((p) => ({ ...p, name: v }))}
            />
            
            {/* Quantity Fields Row */}
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Current Quantity *</Text>
                <TextInput
                  style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={theme.mutedText}
                  value={itemForm.currentQuantity}
                  onChangeText={(v) => setItemForm((p) => ({ ...p, currentQuantity: v }))}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Min Quantity</Text>
                <TextInput
                  style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={theme.mutedText}
                  value={itemForm.minQuantity}
                  onChangeText={(v) => setItemForm((p) => ({ ...p, minQuantity: v }))}
                />
              </View>
            </View>

            {/* Location Field */}
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Location</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="e.g. Storage Room A, Shelf 3"
              placeholderTextColor={theme.mutedText}
              value={itemForm.location}
              onChangeText={(v) => setItemForm((p) => ({ ...p, location: v }))}
            />

            {/* Barcode Field */}
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Barcode / SKU</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="e.g. 123456789012"
              placeholderTextColor={theme.mutedText}
              value={itemForm.barcode}
              onChangeText={(v) => setItemForm((p) => ({ ...p, barcode: v }))}
            />

            {/* Notes Field */}
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Notes</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, height: 100, textAlignVertical: "top" }]}
              placeholder="Additional notes about this item..."
              placeholderTextColor={theme.mutedText}
              multiline
              value={itemForm.notes}
              onChangeText={(v) => setItemForm((p) => ({ ...p, notes: v }))}
            />

            {/* Save Button */}
            <Pressable style={[styles.saveBtn, { backgroundColor: "#2563eb" }]} onPress={saveItem}>
              <Text style={styles.saveBtnText}>Add Item</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {/* DISPOSE: Disposal Confirmation Modal */}
      <Modal visible={showDisposeModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (!disposeSaving) { setShowDisposeModal(false); setDisposingItem(null); } }}>
        <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Dispose Item</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Pressable onPress={downloadDisposalTemplate} hitSlop={8}>
                <Ionicons name="document-outline" size={22} color={theme.mutedText} />
              </Pressable>
              <Pressable onPress={() => { if (!disposeSaving) { setShowDisposeModal(false); setDisposingItem(null); } }}>
                <Ionicons name="close" size={24} color={theme.text} />
              </Pressable>
            </View>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Item Name */}
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Item *</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="Item name"
              placeholderTextColor={theme.mutedText}
              value={disposeForm.itemName}
              onChangeText={(v) => setDisposeForm((p) => ({ ...p, itemName: v }))}
            />

            {/* Model */}
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Model</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="e.g. HP LaserJet Pro"
              placeholderTextColor={theme.mutedText}
              value={disposeForm.model}
              onChangeText={(v) => setDisposeForm((p) => ({ ...p, model: v }))}
            />

            {/* Amount and Approx Amount Row */}
            {disposingItem && (
              <Text style={{ color: theme.mutedText, fontSize: 12, marginBottom: 8 }}>
                Current stock: {disposingItem.currentQuantity}
              </Text>
            )}
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Amount</Text>
                <TextInput
                  style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                  keyboardType="numeric"
                  placeholder="Qty"
                  placeholderTextColor={theme.mutedText}
                  value={disposeForm.amount}
                  onChangeText={(v) => setDisposeForm((p) => ({ ...p, amount: v }))}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Approx Amount ($)</Text>
                <TextInput
                  style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                  keyboardType="numeric"
                  placeholder="Unit value"
                  placeholderTextColor={theme.mutedText}
                  value={disposeForm.approxAmount}
                  onChangeText={(v) => setDisposeForm((p) => ({ ...p, approxAmount: v }))}
                />
              </View>
            </View>

            {/* Vendor */}
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Vendor</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="e.g. Amazon, Staples"
              placeholderTextColor={theme.mutedText}
              value={disposeForm.vendor}
              onChangeText={(v) => setDisposeForm((p) => ({ ...p, vendor: v }))}
            />

            {/* Multiple Amount and Approx Age Row */}
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Multiple Amount ($)</Text>
                <TextInput
                  style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                  keyboardType="numeric"
                  placeholder="Total value"
                  placeholderTextColor={theme.mutedText}
                  value={disposeForm.multipleAmount}
                  onChangeText={(v) => setDisposeForm((p) => ({ ...p, multipleAmount: v }))}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Approx Age</Text>
                <TextInput
                  style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                  placeholder="e.g. 2 years"
                  placeholderTextColor={theme.mutedText}
                  value={disposeForm.approxAge}
                  onChangeText={(v) => setDisposeForm((p) => ({ ...p, approxAge: v }))}
                />
              </View>
            </View>

            {/* Description */}
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Description</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, height: 80, textAlignVertical: "top" }]}
              placeholder="Reason for disposal, condition, etc."
              placeholderTextColor={theme.mutedText}
              multiline
              value={disposeForm.description}
              onChangeText={(v) => setDisposeForm((p) => ({ ...p, description: v }))}
            />

            {/* Who is disposing it */}
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Who is disposing it? *</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="Your name"
              placeholderTextColor={theme.mutedText}
              value={disposeForm.disposedBy}
              onChangeText={(v) => setDisposeForm((p) => ({ ...p, disposedBy: v }))}
            />

            {/* Confirm Dispose Button */}
            <Pressable
              style={[styles.saveBtn, { backgroundColor: "#ef4444", opacity: disposeSaving ? 0.6 : 1 }]}
              onPress={confirmDispose}
              disabled={disposeSaving}
            >
              {disposeSaving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.saveBtnText}>Confirm Disposal</Text>
              )}
            </Pressable>

            {/* Cancel Button */}
            <Pressable
              style={[styles.saveBtn, { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.border, marginTop: 10 }]}
              onPress={() => { if (!disposeSaving) { setShowDisposeModal(false); setDisposingItem(null); } }}
              disabled={disposeSaving}
            >
              <Text style={[styles.saveBtnText, { color: theme.text }]}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {/* Toner Modal */}
      <Modal visible={showTonerModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setShowTonerModal(false); setEditingToner(null); }}>
        <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{editingToner ? "Edit Toner" : "Add New Toner"}</Text>
            <Pressable onPress={() => { setShowTonerModal(false); setEditingToner(null); }}>
              <Ionicons name="close" size={24} color={theme.text} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Model Name *</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="e.g. 202X"
              placeholderTextColor={theme.mutedText}
              value={tonerForm.model}
              onChangeText={(v) => setTonerForm((p) => ({ ...p, model: v }))}
            />
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Color</Text>
            <View style={styles.colorRow}>
              {TONER_COLORS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setTonerForm((p) => ({ ...p, color: c }))}
                  style={[styles.colorChip, { borderColor: tonerForm.color === c ? theme.text : theme.border, backgroundColor: tonerForm.color === c ? theme.text : "transparent" }]}
                >
                  <Text style={[styles.chipTextSmall, { color: tonerForm.color === c ? theme.background : theme.mutedText }]}>{c}</Text>
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Quantity *</Text>
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
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Compatible Printer</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="e.g. HP LaserJet M404"
              placeholderTextColor={theme.mutedText}
              value={tonerForm.printer}
              onChangeText={(v) => setTonerForm((p) => ({ ...p, printer: v }))}
            />
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Barcode / SKU</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="e.g. 123456789012"
              placeholderTextColor={theme.mutedText}
              value={tonerForm.barcode}
              onChangeText={(v) => setTonerForm((p) => ({ ...p, barcode: v }))}
            />
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Notes</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, height: 80, textAlignVertical: "top" }]}
              placeholder="Additional notes..."
              placeholderTextColor={theme.mutedText}
              multiline
              value={tonerForm.notes}
              onChangeText={(v) => setTonerForm((p) => ({ ...p, notes: v }))}
            />
            <Pressable style={[styles.saveBtn, { backgroundColor: "#2563eb" }]} onPress={saveToner}>
              <Text style={styles.saveBtnText}>{editingToner ? "Update Toner" : "Add Toner"}</Text>
            </Pressable>
            {editingToner && (
              <Pressable
                style={[styles.saveBtn, { backgroundColor: "transparent", borderWidth: 1, borderColor: "#ef4444", marginTop: 8 }]}
                onPress={() => { setShowTonerModal(false); scheduleTonerDelete(editingToner); setEditingToner(null); }}
              >
                <Text style={[styles.saveBtnText, { color: "#ef4444" }]}>Delete Toner</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Printer Modal */}
      <Modal visible={showPrinterModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPrinterModal(false)}>
        <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{editingPrinter ? "Edit Printer" : "Add Printer"}</Text>
            <Pressable onPress={() => setShowPrinterModal(false)}>
              <Ionicons name="close" size={24} color={theme.text} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Name *</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="Printer name"
              placeholderTextColor={theme.mutedText}
              value={printerForm.name}
              onChangeText={(v) => setPrinterForm((p) => ({ ...p, name: v }))}
            />
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Location</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="Location"
              placeholderTextColor={theme.mutedText}
              value={printerForm.location}
              onChangeText={(v) => setPrinterForm((p) => ({ ...p, location: v }))}
            />
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>IP Address</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="192.168.x.x"
              placeholderTextColor={theme.mutedText}
              value={printerForm.ipAddress}
              onChangeText={(v) => setPrinterForm((p) => ({ ...p, ipAddress: v }))}
            />
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Asset Number</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="Asset #"
              placeholderTextColor={theme.mutedText}
              value={printerForm.assetNumber}
              onChangeText={(v) => setPrinterForm((p) => ({ ...p, assetNumber: v }))}
            />
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Serial</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="Serial #"
              placeholderTextColor={theme.mutedText}
              value={printerForm.serial}
              onChangeText={(v) => setPrinterForm((p) => ({ ...p, serial: v }))}
            />
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Toner Series</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="e.g. 1234-series"
              placeholderTextColor={theme.mutedText}
              value={printerForm.tonerSeries}
              onChangeText={(v) => setPrinterForm((p) => ({ ...p, tonerSeries: v }))}
            />
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Barcode</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="Barcode"
              placeholderTextColor={theme.mutedText}
              value={printerForm.barcode}
              onChangeText={(v) => setPrinterForm((p) => ({ ...p, barcode: v }))}
            />
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Notes</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, height: 100 }]}
              placeholder="Notes"
              placeholderTextColor={theme.mutedText}
              multiline
              value={printerForm.notes}
              onChangeText={(v) => setPrinterForm((p) => ({ ...p, notes: v }))}
            />
            <Pressable style={[styles.saveBtn, { backgroundColor: "#2563eb" }]} onPress={savePrinter}>
              <Text style={styles.saveBtnText}>{editingPrinter ? "Update Printer" : "Add Printer"}</Text>
            </Pressable>
            {editingPrinter && (
              <Pressable
                style={[styles.saveBtn, { backgroundColor: "transparent", borderWidth: 1, borderColor: "#ef4444", marginTop: 8 }]}
                onPress={() => deletePrinter(editingPrinter)}
              >
                <Text style={[styles.saveBtnText, { color: "#ef4444" }]}>Delete Printer</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Link Toner Modal */}
      <Modal visible={showLinkModal} animationType="slide" transparent={true} onRequestClose={() => setShowLinkModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.linkModalContent, { backgroundColor: theme.card }]}>
            <Text style={[styles.modalTitle, { color: theme.text, marginBottom: 12 }]}>
              Link Toner to {selectedPrinter?.name}
            </Text>
            <TextInput
              style={[styles.searchInput, { backgroundColor: theme.background, color: theme.text, borderColor: theme.border }]}
              placeholder="Search toners..."
              placeholderTextColor={theme.mutedText}
              value={tonerLinkSearch}
              onChangeText={setTonerLinkSearch}
            />
            <ScrollView style={{ maxHeight: 380 }}>
              {filteredTonerLinkList.map((t) => (
                <Pressable
                  key={t.id}
                  style={[styles.linkItem, { borderBottomColor: theme.border }]}
                  onPress={() => handleLinkToner(t)}
                >
                  <Text style={{ color: theme.text, fontWeight: "700", fontSize: 15 }}>{t.name}</Text>
                  <Text style={{ color: theme.mutedText, fontSize: 12, marginTop: 2 }}>Stock: {t.stock}</Text>
                </Pressable>
              ))}
              {filteredTonerLinkList.length === 0 && (
                <Text style={{ color: theme.mutedText, textAlign: "center", marginTop: 24 }}>No toners found.</Text>
              )}
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 60, paddingBottom: 16 },
  title: { fontSize: 28, fontWeight: "900", marginBottom: 16, letterSpacing: -0.5 },
  tabBar: { flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 4 },
  tab: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 8, borderWidth: 1, borderColor: "transparent" },
  tabText: { fontSize: 13, fontWeight: "600" },
  searchInput: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, fontSize: 14, marginBottom: 10 },
  filterRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  chipSmall: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  chipTextSmall: { fontSize: 12, fontWeight: "600" },
  statCard: { flex: 1, borderRadius: 12, padding: 12, borderWidth: 1, alignItems: "center" },
  statValue: { fontSize: 22, fontWeight: "900" },
  statLabel: { fontSize: 11, fontWeight: "600", marginTop: 2 },
  sortGroup: { flexDirection: "row", gap: 6 },
  card: { borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 10, flexDirection: "row", alignItems: "center", borderWidth: 1 },
  itemName: { fontSize: 16, fontWeight: "800" },
  rightControls: { flexDirection: "row", gap: 12, alignItems: "center", marginLeft: 12 },
  undoBar: { position: "absolute", left: 16, right: 16, borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", zIndex: 1000, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 8, elevation: 8 },
  tonerHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 0 },
  addTonerBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  colorRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  colorChip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  modalContainer: { flex: 1, padding: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: "800" },
  fieldLabel: { fontSize: 13, fontWeight: "600", marginBottom: 6, marginTop: 14 },
  fieldInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  saveBtn: { marginTop: 24, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  saveBtnText: { color: "#ffffff", fontSize: 16, fontWeight: "800" },
  stockBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, alignSelf: "flex-start" },
  stockText: { fontSize: 11, fontWeight: "800" },
  actionButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  actionButtonText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  importBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", marginBottom: 16 },
  importBtnText: { fontSize: 14, fontWeight: "700" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 20 },
  linkModalContent: { borderRadius: 20, padding: 20 },
  linkItem: { paddingVertical: 14, borderBottomWidth: 1 },
});
