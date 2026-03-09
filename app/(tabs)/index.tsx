// app/(tabs)/index.tsx
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where
} from "firebase/firestore";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
  partNumber?: string;
  color: string;
  quantity: number;
  minQuantity: number;
  printer?: string;
  supplier?: string;
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
  siteId: string;
  tonerId?: string; // ← NEW: link to toners collection
};

type TonerLink = {
  id: string;
  name: string;
  stock: number;
};

type SortMode = "name" | "stock";
type TabMode = "inventory" | "toners";
type TonerSubTab = "toners" | "printers";

const TONER_COLORS = ["Black", "Cyan", "Magenta", "Yellow", "Other"];

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
          const data = snap.data();
          setStock(data.quantity ?? data.stock ?? 0);
          setName(data.model || data.name || "Toner");
        }
      },
      (err) => console.error("TonerStockBadge error:", err)
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

  // --- Inventory state ---
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("name");

  // --- Inventory Undo delete state ---
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
  const [showPrinterPicker, setShowPrinterPicker] = useState(false);
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
    barcode: "",
  });

  // --- Toner Undo delete state ---
  const [pendingTonerDelete, setPendingTonerDelete] = useState<{
    toner: Toner;
    backup: any;
    timeoutId: any;
  } | null>(null);
  const [hiddenTonerIds, setHiddenTonerIds] = useState<Set<string>>(new Set());
  const undoTonerAnim = useRef(new Animated.Value(0)).current;

  // --- Printer state ---
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [printersLoading, setPrintersLoading] = useState(true);
  const [importingPrinters, setImportingPrinters] = useState(false);
  const [printerSearch, setPrinterSearch] = useState("");

  // --- Link Toner Modal state ---
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedPrinter, setSelectedPrinter] = useState<Printer | null>(null);
  const [tonerLinkSearch, setTonerLinkSearch] = useState("");
  const [tonerLinkList, setTonerLinkList] = useState<TonerLink[]>([]);

  // --- Inventory Logic ---
  useEffect(() => {
    if (!siteId) return;
    const q = query(collection(db, "inventory"), where("siteId", "==", siteId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newItems = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Item));
      setItems(newItems);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [siteId]);

  const scheduleDelete = async (item: Item) => {
    if (pendingDelete?.timeoutId) {
      clearTimeout(pendingDelete.timeoutId);
      try { await deleteDoc(doc(db, "inventory", pendingDelete.item.id)); } catch {}
      setPendingDelete(null);
      setHiddenIds((p) => { const n = new Set(p); n.delete(pendingDelete.item.id); return n; });
      Animated.timing(undoAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start();
    }
    const backup = { ...item };
    delete (backup as any).id;
    setHiddenIds((p) => new Set(p).add(item.id));
    Animated.timing(undoAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    const timeoutId = setTimeout(async () => {
      try { await deleteDoc(doc(db, "inventory", item.id)); } catch {
        setHiddenIds((p) => { const n = new Set(p); n.delete(item.id); return n; });
      } finally {
        Animated.timing(undoAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start();
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
      await setDoc(doc(db, "inventory", pendingDelete.item.id), pendingDelete.backup, { merge: true });
    } catch {} finally {
      Animated.timing(undoAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start();
      setPendingDelete(null);
    }
  };

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

  // --- Toner Logic ---
  useEffect(() => {
    if (!siteId) return;
    const q = query(collection(db, "toners"), where("siteId", "==", siteId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newToners = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Toner));
      setToners(newToners);
      setTonersLoading(false);
    });
    return () => unsubscribe();
  }, [siteId]);

  // Load toners for the link modal
  useEffect(() => {
    if (!showLinkModal || !siteId) return;
    const q = query(collection(db, "toners"), where("siteId", "==", siteId), orderBy("model", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: data.model || data.name || "Unknown",
          stock: data.quantity ?? data.stock ?? 0,
        } as TonerLink;
      });
      setTonerLinkList(list);
    });
    return () => unsub();
  }, [showLinkModal, siteId]);

  const scheduleTonerDelete = async (toner: Toner) => {
    if (pendingTonerDelete?.timeoutId) {
      clearTimeout(pendingTonerDelete.timeoutId);
      try { await deleteDoc(doc(db, "toners", pendingTonerDelete.toner.id)); } catch {}
      setPendingTonerDelete(null);
      setHiddenTonerIds((p) => { const n = new Set(p); n.delete(pendingTonerDelete.toner.id); return n; });
      Animated.timing(undoTonerAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start();
    }
    const backup = { ...toner };
    delete (backup as any).id;
    setHiddenTonerIds((p) => new Set(p).add(toner.id));
    Animated.timing(undoTonerAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    const timeoutId = setTimeout(async () => {
      try { await deleteDoc(doc(db, "toners", toner.id)); } catch {
        setHiddenTonerIds((p) => { const n = new Set(p); n.delete(toner.id); return n; });
      } finally {
        Animated.timing(undoTonerAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start();
        setPendingTonerDelete(null);
      }
    }, 5000);
    setPendingTonerDelete({ toner, backup, timeoutId });
  };

  const undoTonerDelete = async () => {
    if (!pendingTonerDelete) return;
    clearTimeout(pendingTonerDelete.timeoutId);
    setHiddenTonerIds((p) => { const n = new Set(p); n.delete(pendingTonerDelete.toner.id); return n; });
    try {
      await setDoc(doc(db, "toners", pendingTonerDelete.toner.id), pendingTonerDelete.backup, { merge: true });
    } catch {} finally {
      Animated.timing(undoTonerAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start();
      setPendingTonerDelete(null);
    }
  };

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
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newPrinters = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Printer));
      setPrinters(newPrinters);
      setPrintersLoading(false);
    });
    return () => unsubscribe();
  }, [siteId]);

  const filteredPrinters = useMemo(() => {
    if (!printerSearch) return printers.sort((a, b) => a.name.localeCompare(b.name));
    const q = printerSearch.toLowerCase();
    return printers
      .filter((p) => p.name.toLowerCase().includes(q) || p.location?.toLowerCase().includes(q) || p.ipAddress?.includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [printers, printerSearch]);

  const filteredTonerLinkList = useMemo(() => {
    if (!tonerLinkSearch) return tonerLinkList;
    return tonerLinkList.filter((t) => t.name.toLowerCase().includes(tonerLinkSearch.toLowerCase()));
  }, [tonerLinkList, tonerLinkSearch]);

  const handleLinkToner = async (toner: TonerLink) => {
    if (!selectedPrinter) return;
    try {
      await updateDoc(doc(db, "printers", selectedPrinter.id), { tonerId: toner.id });
      setShowLinkModal(false);
      setSelectedPrinter(null);
      Alert.alert("Linked!", `${toner.name} linked to ${selectedPrinter.name}.`);
    } catch {
      Alert.alert("Error", "Failed to link toner.");
    }
  };

  const handleDeductToner = async (printer: Printer) => {
    if (!printer.tonerId) return;
    Alert.alert("Deduct Toner", `Use 1 toner for ${printer.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Deduct 1",
        onPress: async () => {
          try {
            await updateDoc(doc(db, "toners", printer.tonerId!), { quantity: increment(-1) });
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
        partNumber: toner.partNumber || "",
        color: toner.color,
        quantity: String(toner.quantity),
        minQuantity: String(toner.minQuantity),
        printer: toner.printer || "",
        supplier: toner.supplier || "",
        notes: toner.notes || "",
        barcode: toner.barcode || "",
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
        barcode: "",
      });
    }
    setShowTonerModal(true);
  };

  const saveToner = async () => {
    if (!tonerForm.model || !tonerForm.quantity) {
      Alert.alert("Error", "Model and Quantity are required.");
      return;
    }
    const data = {
      ...tonerForm,
      quantity: parseInt(tonerForm.quantity) || 0,
      minQuantity: parseInt(tonerForm.minQuantity) || 0,
      siteId,
    };
    try {
      if (editingToner) {
        await setDoc(doc(db, "toners", editingToner.id), data, { merge: true });
      } else {
        await addDoc(collection(db, "toners"), data);
      }
      setShowTonerModal(false);
    } catch (err) {
      Alert.alert("Error", "Failed to save toner.");
    }
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

  const renderPrinter = ({ item }: { item: Printer }) => (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <View style={{ flex: 1 }}>
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
      </View>
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        <Text style={{ color: theme.text, fontWeight: "700", fontSize: 14 }}>{item.ipAddress || "No IP"}</Text>
        {item.tonerId ? (
          <Pressable
            style={styles.deductButton}
            onPress={() => handleDeductToner(item)}
          >
            <Text style={styles.deductText}>DEDUCT 1</Text>
          </Pressable>
        ) : (
          <Pressable
            style={styles.linkButton}
            onPress={() => {
              setSelectedPrinter(item);
              setTonerLinkSearch("");
              setShowLinkModal(true);
            }}
          >
            <Text style={styles.linkText}>LINK TONER</Text>
          </Pressable>
        )}
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
        </View>
      </View>

      {activeTab === "inventory" ? (
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemName, { color: theme.text }]}>{item.name}</Text>
                <Text style={{ color: theme.mutedText, fontSize: 12 }}>{item.location || "No location"}</Text>
              </View>
              <View style={styles.rightControls}>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ color: item.currentQuantity <= item.minQuantity ? "#ef4444" : theme.text, fontWeight: "800", fontSize: 18 }}>
                    {item.currentQuantity}
                  </Text>
                  <Text style={{ color: theme.mutedText, fontSize: 10 }}>STOCK</Text>
                </View>
                <Pressable onPress={() => scheduleDelete(item)} style={{ padding: 4 }}>
                  <Ionicons name="trash-outline" size={20} color="#ef4444" />
                </Pressable>
              </View>
            </View>
          )}
          contentContainerStyle={{ padding: 16 }}
          ListHeaderComponent={
            <>
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
      ) : (
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
                <TextInput
                  style={[styles.searchInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
                  placeholder="Search printers..."
                  placeholderTextColor={theme.mutedText}
                  value={printerSearch}
                  onChangeText={setPrinterSearch}
                />
              }
            />
          )}
        </View>
      )}

      {/* Inventory Undo Bar */}
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

      {/* Toner Undo Bar */}
      <Animated.View
        style={[
          styles.undoBar,
          {
            backgroundColor: theme.card,
            borderColor: theme.tint,
            bottom: 80,
            transform: [{ translateY: undoTonerAnim.interpolate({ inputRange: [0, 1], outputRange: [100, 0] }) }],
          },
        ]}
      >
        <Text style={{ color: theme.text, fontWeight: "700" }}>Toner deleted</Text>
        <Pressable
          onPress={undoTonerDelete}
          style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: theme.tint, borderRadius: 8 }}
        >
          <Text style={{ color: "#000", fontWeight: "800" }}>UNDO</Text>
        </Pressable>
      </Animated.View>

      {/* Toner Modal */}
      <Modal visible={showTonerModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowTonerModal(false)}>
        <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{editingToner ? "Edit Toner" : "Add New Toner"}</Text>
            <Pressable onPress={() => setShowTonerModal(false)}>
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
            <Pressable style={[styles.saveBtn, { backgroundColor: theme.tint }]} onPress={saveToner}>
              <Text style={styles.saveBtnText}>{editingToner ? "Update Toner" : "Add Toner"}</Text>
            </Pressable>
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
  sortGroup: { flexDirection: "row", gap: 6 },
  card: { borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 10, flexDirection: "row", alignItems: "center", borderWidth: 1 },
  itemName: { fontSize: 16, fontWeight: "800" },
  rightControls: { flexDirection: "row", gap: 12, alignItems: "center", marginLeft: 12 },
  undoBar: { position: "absolute", left: 16, right: 16, bottom: 16, borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", zIndex: 1000 },
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
  // New styles
  stockBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, alignSelf: "flex-start" },
  stockText: { fontSize: 11, fontWeight: "800" },
  deductButton: { backgroundColor: "#ef4444", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  deductText: { color: "#fff", fontSize: 10, fontWeight: "900" },
  linkButton: { backgroundColor: "#007AFF", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  linkText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 20 },
  linkModalContent: { borderRadius: 20, padding: 20 },
  linkItem: { paddingVertical: 14, borderBottomWidth: 1 },
});