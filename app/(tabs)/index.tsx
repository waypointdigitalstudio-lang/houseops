// app/(tabs)/index.tsx
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { BRAND } from "../../constants/branding";
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

type SortMode = "name" | "stock";

export default function IndexScreen() {
  const theme = useAppTheme();

  // IMPORTANT: use siteId from the hook result (NOT profile?.siteId)
  const { uid, profile, siteId, loading: profileLoading } = useUserProfile();

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

  const showUndoBar = () => {
    Animated.timing(undoAnim, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  };

  const hideUndoBar = () => {
    Animated.timing(undoAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  };

  const scheduleDelete = async (item: Item) => {
    if (pendingDelete?.timeoutId) {
      clearTimeout(pendingDelete.timeoutId);
      try {
        await deleteDoc(doc(db, "items", pendingDelete.item.id));
      } catch {}
      setPendingDelete(null);
      setHiddenIds((p) => {
        const n = new Set(p);
        n.delete(pendingDelete.item.id);
        return n;
      });
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
      try {
        await deleteDoc(doc(db, "items", item.id));
      } catch {
        setHiddenIds((p) => {
          const n = new Set(p);
          n.delete(item.id);
          return n;
        });
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

    setHiddenIds((p) => {
      const n = new Set(p);
      n.delete(pendingDelete.item.id);
      return n;
    });

    try {
      await setDoc(doc(db, "items", pendingDelete.item.id), pendingDelete.backup, {
        merge: true,
      });
    } catch {
    } finally {
      hideUndoBar();
      setPendingDelete(null);
    }
  };

  // Pull-to-refresh handler
  const onRefresh = () => {
    setRefreshing(true);
    // The onSnapshot listener will automatically update items
    // Just simulate a brief refresh animation
    setTimeout(() => {
      setRefreshing(false);
    }, 1000);
  };

  // 🔥 SITE-SCOPED INVENTORY LISTENER
  useEffect(() => {
    // Still loading profile → don't do anything yet
    if (profileLoading) return;

    // Profile loaded but no siteId → show empty state
    if (!siteId) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(collection(db, "items"), where("siteId", "==", siteId));

    const unsub = onSnapshot(
      q,
      (snap) => {
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
      },
      (err) => {
        console.log("Inventory snapshot error:", err);
        setItems([]);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [siteId, profileLoading, hiddenIds]);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filtered = useMemo(() => {
    let list =
      normalizedQuery.length === 0
        ? items
        : items.filter((i) =>
            [i.name, i.location, i.barcode, i.notes]
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery)
          );

    if (showLowOnly) {
      list = list.filter((i) => i.currentQuantity <= i.minQuantity);
    }

    return list;
  }, [items, normalizedQuery, showLowOnly]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) =>
      sortMode === "name"
        ? a.name.localeCompare(b.name)
        : a.currentQuantity - b.currentQuantity
    );
    return list;
  }, [filtered, sortMode]);

  const lowStockCount = useMemo(
    () => items.filter((i) => i.currentQuantity <= i.minQuantity).length,
    [items]
  );

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <StatusBar style="auto" />

        <Text style={[styles.screenTitle, { color: theme.text }]}>
          {BRAND.appName}
        </Text>

        <Text style={{ color: theme.mutedText, marginTop: 6 }}>
          Loading inventory…
        </Text>

        <View style={{ marginTop: 12 }}>
          <ActivityIndicator />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <StatusBar style="auto" />

      <Text style={[styles.screenTitle, { color: theme.text }]}>
        Control Deck
      </Text>

      {!siteId ? (
        <Text style={{ color: "#ef4444", marginTop: 8, fontWeight: "800" }}>
          Your account doesn't have a site assigned yet.
        </Text>
      ) : null}

      {/* Search */}
      <TextInput
        style={[
          styles.searchInput,
          {
            borderColor: theme.border,
            color: theme.text,
            backgroundColor: theme.card,
          },
        ]}
        placeholder="Search name, location, barcode, or notes…"
        placeholderTextColor={theme.mutedText}
        value={searchQuery}
        onChangeText={setSearchQuery}
      />

      {/* Filters + Sort */}
      <View style={styles.filterRow}>
        <Pressable
          onPress={() => setShowLowOnly((p) => !p)}
          style={[
            styles.chip,
            {
              borderColor: showLowOnly ? theme.tint : theme.border,
              backgroundColor: showLowOnly ? theme.card : "transparent",
            },
          ]}
        >
          <Text
            style={[
              styles.chipText,
              { color: showLowOnly ? theme.text : theme.mutedText },
            ]}
          >
            Low stock only
          </Text>
        </Pressable>

        <View style={styles.sortGroup}>
          <Pressable
            onPress={() => setSortMode("name")}
            style={[
              styles.chipSmall,
              {
                borderColor: sortMode === "name" ? theme.tint : theme.border,
                backgroundColor: sortMode === "name" ? theme.card : "transparent",
              },
            ]}
          >
            <Text
              style={[
                styles.chipTextSmall,
                { color: sortMode === "name" ? theme.text : theme.mutedText },
              ]}
            >
              A–Z
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setSortMode("stock")}
            style={[
              styles.chipSmall,
              {
                borderColor: sortMode === "stock" ? theme.tint : theme.border,
                backgroundColor: sortMode === "stock" ? theme.card : "transparent",
              },
            ]}
          >
            <Text
              style={[
                styles.chipTextSmall,
                { color: sortMode === "stock" ? theme.text : theme.mutedText },
              ]}
            >
              Low → High
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Global Low Stock Banner */}
      {siteId && lowStockCount > 0 && !showLowOnly && normalizedQuery.length === 0 ? (
        <View
          style={[
            styles.alertBox,
            {
              borderColor: "#ef4444",
              backgroundColor: "rgba(239, 68, 68, 0.18)",
            },
          ]}
        >
          <Text style={[styles.alertTitle, { color: theme.text }]}>
            Needs Attention
          </Text>
          <Text style={[styles.alertText, { color: theme.mutedText }]}>
            {lowStockCount} item{lowStockCount === 1 ? " is" : "s are"} at or below
            minimum stock.
          </Text>
        </View>
      ) : null}

      {/* Results */}
      {!siteId ? (
        <Text style={{ color: theme.mutedText, marginTop: 14 }}>
          No site assigned for this user yet.
        </Text>
      ) : sorted.length === 0 ? (
        <Text style={{ color: theme.mutedText, marginTop: 14 }}>
          No items found.
        </Text>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: 90 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.tint}
              colors={[theme.tint]}
            />
          }
          renderItem={({ item }) => {
            const isLow = item.currentQuantity <= item.minQuantity;

            return (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/item/[id]",
                    params: { id: item.id },
                  })
                }
                style={[
                  styles.card,
                  {
                    backgroundColor: theme.card,
                    borderColor: isLow ? "#ef4444" : theme.border,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemName, { color: theme.text }]}>
                    {item.name}
                  </Text>

                  {item.location ? (
                    <Text style={{ color: theme.tint, fontSize: 12, marginTop: 2 }}>
                      Location: {item.location}
                    </Text>
                  ) : null}

                  {item.barcode ? (
                    <Text style={{ color: theme.mutedText, fontSize: 11, marginTop: 2 }}>
                      Barcode: {item.barcode}
                    </Text>
                  ) : null}

                  {item.notes ? (
                    <Text
                      numberOfLines={2}
                      style={{ color: theme.mutedText, fontSize: 12, marginTop: 4 }}
                    >
                      Note: {item.notes}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.rightControls}>
                  <Pressable
                    onPress={() =>
                      Alert.alert(
                        "Delete item?",
                        `Delete "${item.name}"? You can undo for 5 seconds.`,
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Delete",
                            style: "destructive",
                            onPress: () => scheduleDelete(item),
                          },
                        ]
                      )
                    }
                    hitSlop={10}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={18}
                      color={theme.mutedText}
                    />
                  </Pressable>

                  <Text
                    style={{
                      fontWeight: "900",
                      color: isLow ? "#ef4444" : theme.text,
                      fontSize: 16,
                      width: 28,
                      textAlign: "right",
                    }}
                  >
                    {item.currentQuantity}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {/* Undo bar */}
      {pendingDelete ? (
        <Animated.View
          style={[
            styles.undoBar,
            {
              backgroundColor: theme.card,
              borderColor: theme.border,
              opacity: undoAnim,
            },
          ]}
        >
          <Text style={{ color: theme.text }} numberOfLines={1}>
            Deleted "{pendingDelete.item.name}"
          </Text>

          <Pressable onPress={undoDelete}>
            <Text style={{ color: theme.tint, fontWeight: "900" }}>UNDO</Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 16,
    paddingHorizontal: 16,
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: "800",
    marginTop: 8,
  },

  searchInput: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    marginBottom: 10,
  },

  filterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipSmall: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
  },
  chipTextSmall: {
    fontSize: 12,
    fontWeight: "600",
  },
  sortGroup: {
    flexDirection: "row",
    gap: 6,
  },

  alertBox: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
  },
  alertTitle: {
    fontWeight: "800",
  },
  alertText: {
    fontSize: 13,
    marginTop: 4,
  },

  card: {
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
  },
  itemName: {
    fontSize: 16,
    fontWeight: "800",
  },
  rightControls: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    marginLeft: 12,
  },

  undoBar: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});