// app/(tabs)/alerts.tsx
// Alerts & Activity Log Screen
//
// v9 - 2026-03-13 — Fixed dismiss → Firestore update
// ------------------------------------------
// - Tap an alert card to dismiss it
// - Stores userDismissedAlert + userDismissedAlertQuantity in Firestore
// - Alert reappears if currentQuantity changes from when it was dismissed
// - Fade-out animation on dismiss
// - No "Reset Dismissed" button needed
// - Activity Log fully preserved
// - FIX: Trigger Firestore update immediately on tap (before animation)
// - FIX: Added Alert.alert for visible success/failure feedback (debug)

import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  collection,
  doc,
  onSnapshot,
  query,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useAppTheme } from "../../constants/theme";
import { db } from "../../firebaseConfig";
import { useUserProfile } from "../../hooks/useUserProfile";

// ─── Types ───────────────────────────────────────────────────────────

/** Activity log entry from alertsLog collection */
interface ActivityEntry {
  id: string;
  siteId: string;
  itemName: string;
  itemId: string;
  qty: number;
  min: number;
  prevState: string;
  nextState: string;
  status: string;
  action: string;
  itemType: "inventory" | "toner" | "printer";
  createdAt: Timestamp | null;
  dismissed: boolean;
  userDismissed: boolean;
}

/** Alert entry derived from items collection */
interface AlertEntry {
  id: string;           // Firestore document ID (same as itemId)
  itemId: string;       // Firestore document ID
  itemName: string;
  location: string;
  siteId: string;
  alertState: string;   // "LOW", "CRITICAL", "OUT"
  currentQuantity: number;
  minQuantity: number;
  lastAlertAt: Timestamp | null;
  isLowStock: boolean;
  // Dismiss fields from Firestore
  userDismissedAlert: boolean;
  userDismissedAlertQuantity: number | null;
}

// ─── Active-state accent color ──────────────────────────────────────
const ACTIVE_BG = "#2563eb"; // blue-600
const ACTIVE_TEXT = "#ffffff";

// ─── Constants ───────────────────────────────────────────────────────

type DateFilter = "today" | "7days" | "30days" | "all";
type ActionFilter = "all" | "added" | "edited" | "deleted" | "deducted" | "linked" | "unlinked" | "disposed";

const DATE_FILTERS: { label: string; value: DateFilter }[] = [
  { label: "Today", value: "today" },
  { label: "7 Days", value: "7days" },
  { label: "30 Days", value: "30days" },
  { label: "All", value: "all" },
];

const ACTION_FILTERS: { label: string; value: ActionFilter }[] = [
  { label: "All", value: "all" },
  { label: "Added", value: "added" },
  { label: "Edited", value: "edited" },
  { label: "Deleted", value: "deleted" },
  { label: "Deducted", value: "deducted" },
  { label: "Linked", value: "linked" },
  { label: "Unlinked", value: "unlinked" },
  { label: "Disposed", value: "disposed" },
];

// ─── Helpers ─────────────────────────────────────────────────────────

function getActionIcon(action: string): { name: keyof typeof Ionicons.glyphMap; color: string } {
  switch (action) {
    case "added":
      return { name: "add-circle", color: "#22c55e" };
    case "edited":
      return { name: "create", color: "#3b82f6" };
    case "deleted":
      return { name: "trash", color: "#ef4444" };
    case "deducted":
      return { name: "remove-circle", color: "#f97316" };
    case "linked":
      return { name: "link", color: "#8b5cf6" };
    case "unlinked":
      return { name: "unlink", color: "#f59e0b" };
    case "disposed":
      return { name: "close-circle", color: "#ef4444" };
    default:
      return { name: "ellipse", color: "#6b7280" };
  }
}

function getSeverityLevel(state: string): number {
  switch (state.toUpperCase()) {
    case "OUT":
      return 3;
    case "CRITICAL":
      return 2;
    case "LOW":
      return 1;
    case "OK":
    default:
      return 0;
  }
}

function calculateAlertState(currentQty: number, minQty: number): string {
  if (currentQty <= 0) return "OUT";
  if (currentQty <= minQty * 0.5) return "CRITICAL";
  if (currentQty <= minQty) return "LOW";
  return "OK";
}

function getStatusColor(status: string): string {
  switch (status.toUpperCase()) {
    case "OK":
      return "#22c55e";
    case "LOW":
      return "#f97316";
    case "CRITICAL":
    case "OUT":
      return "#ef4444";
    default:
      return "#6b7280";
  }
}

function formatTimestamp(ts: Timestamp | null): string {
  if (!ts) return "—";
  if (typeof ts.toDate !== "function") return "—";
  try {
    const d = ts.toDate();
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function formatFullTimestamp(ts: Timestamp | null): string {
  if (!ts) return "";
  if (typeof ts.toDate !== "function") return "";
  try {
    const d = ts.toDate();
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function inferActionFromStates(prev?: string, next?: string): string {
  if (!prev && !next) return "added";
  const p = (prev ?? "").toUpperCase();
  const n = (next ?? "").toUpperCase();
  if ((p === "LOW" || p === "OUT" || p === "CRITICAL") && n === "OK") return "added";
  if (p === "OK" && (n === "LOW" || n === "OUT" || n === "CRITICAL")) return "deducted";
  if (p !== n) return "edited";
  return "edited";
}

function getDateCutoff(filter: DateFilter): Date | null {
  if (filter === "all") return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (filter === "today") return now;
  if (filter === "7days") {
    now.setDate(now.getDate() - 7);
    return now;
  }
  if (filter === "30days") {
    now.setDate(now.getDate() - 30);
    return now;
  }
  return null;
}

/**
 * Determines whether a low-stock alert should be visible to the user.
 *
 * An alert is shown if:
 *   1. It was never dismissed (userDismissedAlert is false/undefined), OR
 *   2. The quantity has changed since it was dismissed
 *      (currentQuantity !== userDismissedAlertQuantity)
 */
function shouldShowAlert(item: AlertEntry): boolean {
  if (!item.userDismissedAlert) return true;
  if (item.userDismissedAlertQuantity === null || item.userDismissedAlertQuantity === undefined) return true;
  return item.currentQuantity !== item.userDismissedAlertQuantity;
}

// ─── Animated Alert Card Component ──────────────────────────────────

function AlertCard({
  item,
  theme,
  onDismiss,
}: {
  item: AlertEntry;
  theme: ReturnType<typeof useAppTheme>;
  onDismiss: (item: AlertEntry) => void;
}) {
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const dismissingRef = useRef(false); // prevent double-tap
  const statusColor = getStatusColor(item.alertState);
  const isOut = item.alertState === "OUT" || item.alertState === "CRITICAL";

  const handlePress = useCallback(() => {
    // Guard against double-tap
    if (dismissingRef.current) {
      console.log(`[AlertCard] Already dismissing "${item.itemName}" — ignoring duplicate tap`);
      return;
    }
    dismissingRef.current = true;

    console.log(`[AlertCard] ✅ TAP DETECTED on "${item.itemName}" (id=${item.itemId})`);

    // ⚡ Fire the dismiss handler IMMEDIATELY — don't wait for animation
    onDismiss(item);

    // Then play the fade-out animation (purely visual)
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      console.log(`[AlertCard] Fade-out animation complete for "${item.itemName}"`);
    });
  }, [item, onDismiss, fadeAnim]);

  return (
    <Animated.View style={{ opacity: fadeAnim }}>
      <TouchableOpacity
        activeOpacity={0.6}
        onPress={handlePress}
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.card,
              borderColor: isOut ? "#ef444440" : theme.border,
              borderLeftWidth: 3,
              borderLeftColor: statusColor,
            },
          ]}
        >
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: statusColor + "1A" },
            ]}
          >
            <Ionicons
              name={isOut ? "alert-circle" : "warning"}
              size={20}
              color={statusColor}
            />
          </View>

          <View style={{ flex: 1, marginLeft: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={1}>
                {item.itemName}
              </Text>
            </View>

            {/* Location */}
            {item.location ? (
              <Text style={{ color: theme.mutedText, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                📍 {item.location}
              </Text>
            ) : null}

            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4, gap: 8 }}>
              <View style={[styles.actionBadge, { backgroundColor: statusColor + "1A" }]}>
                <Text style={{ color: statusColor, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>
                  {item.alertState}
                </Text>
              </View>
              <Text style={{ color: theme.mutedText, fontSize: 11 }}>
                Qty: {item.currentQuantity} / Min: {item.minQuantity}
              </Text>
            </View>

            {item.lastAlertAt && (
              <Text style={{ color: theme.mutedText, fontSize: 10, marginTop: 3 }}>
                Last alert {formatTimestamp(item.lastAlertAt)}
              </Text>
            )}

            {/* Tap to dismiss hint */}
            <Text style={{ color: theme.mutedText, fontSize: 10, marginTop: 4, fontStyle: "italic", opacity: 0.7 }}>
              Tap to dismiss
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────

export default function AlertsScreen() {
  const theme = useAppTheme();
  const { siteId, loading: profileLoading } = useUserProfile();

  // View toggle
  const [activeView, setActiveView] = useState<"alerts" | "activity">("alerts");

  // ─── Alerts state (from items collection) ─────────────────────────
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(true);

  // Track locally dismissed IDs to hide them instantly (before Firestore round-trip)
  const [locallyDismissedIds, setLocallyDismissedIds] = useState<Set<string>>(new Set());

  // Generation counter to prevent stale snapshot callbacks
  const alertGenRef = useRef(0);

  // ─── Activity log state (from alertsLog collection) ────────────
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(true);

  // Filters (for Activity Log view only)
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");

  // ─── Fetch low-stock items with dismiss filtering ─────────────────
  useEffect(() => {
    const thisGeneration = ++alertGenRef.current;

    if (!siteId) {
      setAlerts([]);
      setLoadingAlerts(false);
      return;
    }

    setLoadingAlerts(true);
    // Clear locally dismissed set on re-subscribe since Firestore will have the truth
    setLocallyDismissedIds(new Set());

    console.log(`[AlertsScreen] Subscribing to items (siteId="${siteId}", gen=${thisGeneration})`);

    const q = query(collection(db, "items"), where("siteId", "==", siteId));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        if (alertGenRef.current !== thisGeneration) {
          console.log(
            `[AlertsScreen] Stale snapshot (gen=${thisGeneration}, current=${alertGenRef.current}) — ignoring`
          );
          return;
        }

        console.log(`[AlertsScreen] items snapshot fired (gen=${thisGeneration}). doc count =`, snapshot.docs.length);

        const alertItems: AlertEntry[] = [];

        for (const d of snapshot.docs) {
          const data = d.data();

          const currentQty: number =
            typeof data.currentQuantity === "number" ? data.currentQuantity : 0;
          const minQty: number =
            typeof data.minQuantity === "number" ? data.minQuantity : 0;

          // Only include items that are actually low on stock
          if (minQty > 0 && currentQty <= minQty) {
            const alertState = calculateAlertState(currentQty, minQty);

            const entry: AlertEntry = {
              id: d.id,
              itemId: d.id,
              itemName: data.name ?? "(unknown)",
              location: data.location ?? "",
              siteId: data.siteId ?? "",
              alertState,
              currentQuantity: currentQty,
              minQuantity: minQty,
              lastAlertAt: data.lastAlertAt ?? data.updatedAt ?? null,
              isLowStock: true,
              userDismissedAlert: data.userDismissedAlert ?? false,
              userDismissedAlertQuantity:
                typeof data.userDismissedAlertQuantity === "number"
                  ? data.userDismissedAlertQuantity
                  : null,
            };

            // Apply dismiss filter: show if not dismissed, or if quantity changed
            if (shouldShowAlert(entry)) {
              console.log(
                `[AlertsScreen]   VISIBLE: "${entry.itemName}" state=${alertState} (qty=${currentQty}, min=${minQty})`
              );
              alertItems.push(entry);
            } else {
              console.log(
                `[AlertsScreen]   DISMISSED: "${entry.itemName}" (dismissed at qty=${entry.userDismissedAlertQuantity}, current=${currentQty})`
              );
            }
          }
        }

        // Sort: OUT first, then CRITICAL, then LOW
        alertItems.sort((a, b) => getSeverityLevel(b.alertState) - getSeverityLevel(a.alertState));

        console.log(`[AlertsScreen] Total visible alerts: ${alertItems.length}`);

        setAlerts(alertItems);
        setLoadingAlerts(false);
      },
      (err) => {
        console.error("[AlertsScreen] Error fetching items for alerts:", err);
        if (alertGenRef.current === thisGeneration) {
          setLoadingAlerts(false);
        }
      }
    );

    return () => {
      console.log(`[AlertsScreen] Unsubscribing items listener (gen=${thisGeneration})`);
      unsub();
    };
  }, [siteId]);

  // ─── Dismiss handler ──────────────────────────────────────────────
  const handleDismiss = useCallback(
    async (item: AlertEntry) => {
      console.log(`[AlertsScreen] ===== DISMISS START =====`);
      console.log(`[AlertsScreen] Item: "${item.itemName}"`);
      console.log(`[AlertsScreen] itemId: "${item.itemId}"`);
      console.log(`[AlertsScreen] currentQuantity: ${item.currentQuantity}`);
      console.log(`[AlertsScreen] Firestore path: items/${item.itemId}`);

      // Validate itemId before proceeding
      if (!item.itemId) {
        console.error(`[AlertsScreen] ❌ INVALID itemId — cannot dismiss`);
        Alert.alert("Dismiss Error", "Invalid item ID. Cannot dismiss this alert.");
        return;
      }

      // Immediately hide locally
      setLocallyDismissedIds((prev) => {
        const next = new Set(prev);
        next.add(item.itemId);
        console.log(`[AlertsScreen] Locally dismissed IDs:`, Array.from(next));
        return next;
      });

      // Persist to Firestore
      try {
        const itemRef = doc(db, "items", item.itemId);
        console.log(`[AlertsScreen] Calling updateDoc on items/${item.itemId} ...`);

        await updateDoc(itemRef, {
          userDismissedAlert: true,
          userDismissedAlertQuantity: item.currentQuantity,
        });

        console.log(`[AlertsScreen] ✅ Dismiss persisted for "${item.itemName}" (userDismissedAlert=true, qty=${item.currentQuantity})`);

        // DEBUG: visible confirmation — remove this Alert.alert once confirmed working
        // Alert.alert("Dismissed ✅", `"${item.itemName}" dismissed at qty ${item.currentQuantity}`);
      } catch (err: any) {
        console.error(`[AlertsScreen] ❌ Error dismissing "${item.itemName}":`, err);
        console.error(`[AlertsScreen] Error code:`, err?.code);
        console.error(`[AlertsScreen] Error message:`, err?.message);

        // Show error to user so they know it failed
        Alert.alert(
          "Dismiss Failed",
          `Could not dismiss "${item.itemName}". Error: ${err?.message ?? "Unknown error"}. Please try again.`
        );

        // If Firestore write fails, un-hide locally so user can retry
        setLocallyDismissedIds((prev) => {
          const next = new Set(prev);
          next.delete(item.itemId);
          return next;
        });
      }
      console.log(`[AlertsScreen] ===== DISMISS END =====`);
    },
    []
  );

  // ─── Visible alerts (exclude locally dismissed) ───────────────────
  const visibleAlerts = useMemo(() => {
    if (locallyDismissedIds.size === 0) return alerts;
    return alerts.filter((a) => !locallyDismissedIds.has(a.id));
  }, [alerts, locallyDismissedIds]);

  // ─── Fetch activities from alertsLog ────────────────────────────
  useEffect(() => {
    setLoadingActivities(true);

    console.log("[AlertsScreen] Querying alertsLog");

    const q = query(collection(db, "alertsLog"));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        console.log("[AlertsScreen] alertsLog onSnapshot fired. doc count =", snapshot.docs.length);

        const items: ActivityEntry[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            siteId: data.siteId ?? "default",
            itemName: data.itemName ?? data.name ?? "(unknown)",
            itemId: data.itemId ?? "",
            qty: data.qty ?? data.quantity ?? 0,
            min: data.min ?? data.minQuantity ?? 0,
            prevState: data.prevState ?? "",
            nextState: data.nextState ?? "",
            status: data.status ?? data.nextState ?? "",
            action: data.action
              ? data.action
              : inferActionFromStates(data.prevState, data.nextState),
            itemType: data.itemType ?? "inventory",
            createdAt: data.createdAt ?? null,
            dismissed: data.dismissed ?? false,
            userDismissed: data.userDismissed ?? false,
          } as ActivityEntry;
        });

        items.sort((a, b) => {
          const aTime = a.createdAt && typeof a.createdAt.toMillis === "function"
            ? a.createdAt.toMillis()
            : 0;
          const bTime = b.createdAt && typeof b.createdAt.toMillis === "function"
            ? b.createdAt.toMillis()
            : 0;
          return bTime - aTime;
        });

        console.log("[AlertsScreen] Parsed activities count:", items.length);
        setActivities(items);
        setLoadingActivities(false);
      },
      (err) => {
        console.error("[AlertsScreen] Error fetching activities:", err);
        setLoadingActivities(false);
      }
    );

    return () => unsub();
  }, []);

  // ─── Filtered activities ──────────────────────────────────────────
  const filteredActivities = useMemo(() => {
    let result = [...activities];

    const cutoff = getDateCutoff(dateFilter);
    if (cutoff) {
      result = result.filter((a) => {
        if (!a.createdAt) return true;
        if (typeof a.createdAt.toDate !== "function") return true;
        try {
          return a.createdAt.toDate() >= cutoff;
        } catch {
          return true;
        }
      });
    }

    if (actionFilter !== "all") {
      result = result.filter((a) => a.action === actionFilter);
    }

    return result;
  }, [activities, dateFilter, actionFilter]);

  // ─── CSV Export ───────────────────────────────────────────────────
  async function exportCSV() {
    try {
      const header = "Timestamp,Action,Item Type,Item Name,Quantity,Min Qty,Prev State,New State\n";
      const rows = filteredActivities.map((a) => {
        const ts = a.createdAt ? formatFullTimestamp(a.createdAt) : "";
        return `"${ts}","${a.action}","${a.itemType}","${a.itemName}",${a.qty},${a.min},"${a.prevState}","${a.nextState}"`;
      });
      const csv = header + rows.join("\n");

      if (Platform.OS === "web") {
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "activity_log.csv";
        link.click();
      } else {
        const fileUri = FileSystem.cacheDirectory + "activity_log.csv";
        await FileSystem.writeAsStringAsync(fileUri, csv, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        await Sharing.shareAsync(fileUri, {
          mimeType: "text/csv",
          dialogTitle: "Export Activity Log",
          UTI: "public.comma-separated-values-text",
        });
      }
    } catch (err) {
      console.error("CSV export error:", err);
    }
  }

  // ─── Render: Filter Chips (for Activity Log) ─────────────────────
  function FilterChips() {
    return (
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        {/* Date filters */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          <Text style={{ color: theme.mutedText, fontSize: 12, fontWeight: "600", alignSelf: "center", marginRight: 4 }}>
            Date:
          </Text>
          {DATE_FILTERS.map((f) => {
            const active = dateFilter === f.value;
            return (
              <Pressable
                key={f.value}
                onPress={() => setDateFilter(f.value)}
                style={[
                  styles.chipSmall,
                  {
                    backgroundColor: active ? ACTIVE_BG : "transparent",
                    borderColor: active ? ACTIVE_BG : theme.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.chipTextSmall,
                    { color: active ? ACTIVE_TEXT : theme.mutedText },
                  ]}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Action filters */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <Text style={{ color: theme.mutedText, fontSize: 12, fontWeight: "600", alignSelf: "center", marginRight: 4 }}>
            Action:
          </Text>
          {ACTION_FILTERS.map((f) => {
            const active = actionFilter === f.value;
            return (
              <Pressable
                key={f.value}
                onPress={() => setActionFilter(f.value)}
                style={[
                  styles.chipSmall,
                  {
                    backgroundColor: active ? ACTIVE_BG : "transparent",
                    borderColor: active ? ACTIVE_BG : theme.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.chipTextSmall,
                    { color: active ? ACTIVE_TEXT : theme.mutedText },
                  ]}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  // ─── Render: Activity Item ────────────────────────────────────────
  function renderActivityItem({ item }: { item: ActivityEntry }) {
    const icon = getActionIcon(item.action);
    const statusColor = getStatusColor(item.nextState);

    return (
      <View
        style={[
          styles.card,
          { backgroundColor: theme.card, borderColor: theme.border },
        ]}
      >
        {/* Icon */}
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: icon.color + "1A" },
          ]}
        >
          <Ionicons name={icon.name} size={20} color={icon.color} />
        </View>

        {/* Content */}
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={1}>
              {item.itemName}
            </Text>
            <Text style={{ color: theme.mutedText, fontSize: 11 }}>
              {formatTimestamp(item.createdAt)}
            </Text>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4, flexWrap: "wrap", gap: 6 }}>
            {/* Action badge */}
            <View
              style={[
                styles.actionBadge,
                { backgroundColor: icon.color + "1A" },
              ]}
            >
              <Text style={{ color: icon.color, fontSize: 11, fontWeight: "700", textTransform: "capitalize" }}>
                {item.action}
              </Text>
            </View>

            {/* Item type */}
            <Text style={{ color: theme.mutedText, fontSize: 11 }}>
              {item.itemType}
            </Text>

            {/* Quantity info */}
            <Text style={{ color: theme.mutedText, fontSize: 11 }}>
              Qty: {item.qty}
            </Text>
          </View>

          {/* State change */}
          {item.prevState && item.nextState && item.prevState.toLowerCase() !== item.nextState.toLowerCase() && (
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
              <View style={[styles.stateDot, { backgroundColor: getStatusColor(item.prevState) }]} />
              <Text style={{ color: theme.mutedText, fontSize: 11 }}>{item.prevState}</Text>
              <Ionicons name="arrow-forward" size={10} color={theme.mutedText} style={{ marginHorizontal: 4 }} />
              <View style={[styles.stateDot, { backgroundColor: statusColor }]} />
              <Text style={{ color: statusColor, fontSize: 11, fontWeight: "700" }}>{item.nextState}</Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  // ─── Render: Alert Item (with fade-out dismiss) ───────────────────
  const renderAlertItem = useCallback(
    ({ item }: { item: AlertEntry }) => (
      <AlertCard item={item} theme={theme} onDismiss={handleDismiss} />
    ),
    [theme, handleDismiss]
  );

  // ─── Effective loading states ─────────────────────────────────────
  const isAlertsLoading = profileLoading || loadingAlerts;
  const isActivitiesLoading = profileLoading || loadingActivities;

  // ─── Main Render ───────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Alerts & Activity</Text>

        {/* View Toggle */}
        <View style={[styles.tabBar, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Pressable
            onPress={() => setActiveView("alerts")}
            style={[
              styles.tab,
              activeView === "alerts" && { backgroundColor: ACTIVE_BG, borderColor: ACTIVE_BG },
            ]}
          >
            <Text
              style={[
                styles.tabText,
                { color: activeView === "alerts" ? ACTIVE_TEXT : theme.mutedText },
              ]}
            >
              Alerts{visibleAlerts.length > 0 ? ` (${visibleAlerts.length})` : ""}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveView("activity")}
            style={[
              styles.tab,
              activeView === "activity" && { backgroundColor: ACTIVE_BG, borderColor: ACTIVE_BG },
            ]}
          >
            <Text
              style={[
                styles.tabText,
                { color: activeView === "activity" ? ACTIVE_TEXT : theme.mutedText },
              ]}
            >
              Activity Log
            </Text>
          </Pressable>
        </View>
      </View>

      {/* ─── Alerts View ─────────────────────────────────────────────── */}
      {activeView === "alerts" && (
        <>
          {isAlertsLoading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={theme.text} />
            </View>
          ) : visibleAlerts.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="checkmark-circle" size={48} color="#22c55e" />
              <Text style={{ color: theme.mutedText, fontSize: 16, fontWeight: "600", marginTop: 12 }}>
                All clear!
              </Text>
              <Text style={{ color: theme.mutedText, fontSize: 13, marginTop: 4 }}>
                No low stock alerts right now.
              </Text>
            </View>
          ) : (
            <FlatList
              data={visibleAlerts}
              keyExtractor={(item) => item.id}
              renderItem={renderAlertItem}
              contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
              showsVerticalScrollIndicator={false}
            />
          )}
        </>
      )}

      {/* ─── Activity Log View ───────────────────────────────────────── */}
      {activeView === "activity" && (
        <>
          <FilterChips />

          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <Pressable
              onPress={exportCSV}
              style={[
                styles.exportBtn,
                { borderColor: theme.border },
              ]}
            >
              <Ionicons name="download-outline" size={16} color={theme.text} />
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: "700", marginLeft: 6 }}>
                Export CSV ({filteredActivities.length})
              </Text>
            </Pressable>
          </View>

          {isActivitiesLoading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={theme.text} />
            </View>
          ) : filteredActivities.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="document-text-outline" size={48} color={theme.mutedText} />
              <Text style={{ color: theme.mutedText, fontSize: 16, fontWeight: "600", marginTop: 12 }}>
                No activities found
              </Text>
              <Text style={{ color: theme.mutedText, fontSize: 13, marginTop: 4 }}>
                Try adjusting your filters.
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredActivities}
              keyExtractor={(item) => item.id}
              renderItem={renderActivityItem}
              contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
              showsVerticalScrollIndicator={false}
            />
          )}
        </>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    marginBottom: 16,
    letterSpacing: -0.5,
  },
  tabBar: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
  tabText: {
    fontSize: 13,
    fontWeight: "600",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1,
  },
  itemName: {
    fontSize: 15,
    fontWeight: "800",
    flexShrink: 1,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  stateDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  chipSmall: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipTextSmall: {
    fontSize: 12,
    fontWeight: "600",
  },
  exportBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    alignSelf: "flex-start",
  },
});
