// app/(tabs)/alerts.tsx
// Alerts & Activity Log Screen
// REWRITE: Alerts view now queries the `items` collection directly instead of
// deriving alerts from `alertsLog`. This is more reliable because the items
// collection holds the current stock state (isLowStock, alertState, etc.).
// Activity Log view remains unchanged — still queries alertsLog collection.
//
// FIX v3 - 2026-03-13
// --------------------
// - Moved locallyDismissedItemIds filtering OUT of the onSnapshot callback
//   and into a useMemo. This prevents re-subscribing on every dismiss and
//   avoids stale-closure issues.
// - Added generation guard (like useLowStockCount) to prevent stale callbacks.
// - Fixed CRITICAL threshold: now uses minQty * 0.5 (not Math.floor).
// - Enhanced debug logging throughout.

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
  View,
} from "react-native";
import { useAppTheme } from "../../constants/theme";
import { db } from "../../firebaseConfig";
import { useUserProfile } from "../../hooks/useUserProfile";

// ─── Types ───────────────────────────────────────────────────────────

/** Activity log entry from alertsLog collection (unchanged) */
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
  userDismissedAlert: boolean;       // from Firestore
  userDismissedAlertState: string;   // from Firestore (severity when dismissed)
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

/**
 * Returns a numeric severity level for alert states (higher = worse).
 * OUT=3, CRITICAL=2, LOW=1, OK=0
 */
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

/**
 * Calculates the alert severity from actual quantity values.
 *
 * - OUT:      currentQuantity <= 0
 * - CRITICAL: currentQuantity > 0 AND currentQuantity <= (minQuantity * 0.5)
 * - LOW:      currentQuantity > (minQuantity * 0.5) AND currentQuantity <= minQuantity
 * - OK:       currentQuantity > minQuantity
 */
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

/** Infer an action label from prevState/nextState when the `action` field is missing */
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

// ─── Main Component ──────────────────────────────────────────────────

export default function AlertsScreen() {
  const theme = useAppTheme();
  const { siteId, loading: profileLoading } = useUserProfile();

  // View toggle
  const [activeView, setActiveView] = useState<"alerts" | "activity">("alerts");

  // ─── Alerts state (from items collection) ─────────────────────────
  // rawAlerts: ALL low-stock items from Firestore (no dismiss filtering)
  const [rawAlerts, setRawAlerts] = useState<AlertEntry[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(true);

  // Dismissed alerts — tracks IDs currently animating out
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set());
  // Track locally dismissed item IDs so they stay hidden even before Firestore round-trips
  const [locallyDismissedItemIds, setLocallyDismissedItemIds] = useState<Set<string>>(new Set());
  // Animation values for each alert card
  const animValues = useRef<Map<string, Animated.Value>>(new Map());

  // Generation counter to prevent stale snapshot callbacks
  const alertGenRef = useRef(0);

  // ─── Activity log state (from alertsLog collection, unchanged) ────
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(true);

  // Filters (for Activity Log view only)
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");

  const getAnimValue = useCallback((id: string) => {
    if (!animValues.current.has(id)) {
      animValues.current.set(id, new Animated.Value(1));
    }
    return animValues.current.get(id)!;
  }, []);

  // ─── Fetch ALL low-stock items from items collection ──────────────
  // FIX v3: No longer depends on locallyDismissedItemIds — that filtering
  // is done in the useMemo below. This prevents re-subscribing on dismiss.
  useEffect(() => {
    const thisGeneration = ++alertGenRef.current;

    if (!siteId) {
      setRawAlerts([]);
      setLoadingAlerts(false);
      return;
    }

    setLoadingAlerts(true);

    console.log(`[AlertsScreen] Subscribing to items (siteId="${siteId}", gen=${thisGeneration})`);

    const q = query(collection(db, "items"), where("siteId", "==", siteId));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        // Guard: if a newer effect has started, this listener is stale
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

          // Debug: log every item's quantities
          console.log(
            `[AlertsScreen]   Item "${data.name ?? d.id}": qty=${currentQty}, min=${minQty}, ` +
            `userDismissed=${data.userDismissedAlert ?? false}, dismissedState=${data.userDismissedAlertState ?? "n/a"}`
          );

          // Only include items that are actually low on stock
          if (minQty > 0 && currentQty <= minQty) {
            const alertState = calculateAlertState(currentQty, minQty);

            console.log(
              `[AlertsScreen]   → LOW STOCK: "${data.name ?? d.id}" state=${alertState} (qty=${currentQty}, min=${minQty})`
            );

            alertItems.push({
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
              userDismissedAlert: data.userDismissedAlert === true,
              userDismissedAlertState: typeof data.userDismissedAlertState === "string"
                ? data.userDismissedAlertState
                : "OK",
            });
          }
        }

        // Sort: OUT first, then CRITICAL, then LOW
        alertItems.sort((a, b) => getSeverityLevel(b.alertState) - getSeverityLevel(a.alertState));

        console.log(`[AlertsScreen] Total low-stock items (before dismiss filter): ${alertItems.length}`);

        setRawAlerts(alertItems);
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
  }, [siteId]); // FIX v3: only depends on siteId — no locallyDismissedItemIds

  // ─── Filtered alerts (dismiss logic applied at render time) ───────
  // FIX v3: Smart dismiss + local dismiss filtering is now a useMemo.
  // This avoids re-subscribing to Firestore on every dismiss.
  const alerts = useMemo(() => {
    const result: AlertEntry[] = [];

    for (const item of rawAlerts) {
      // Skip items the user has locally dismissed (optimistic UI)
      if (locallyDismissedItemIds.has(item.itemId)) {
        console.log(`[AlertsScreen] Filtered out (locally dismissed): "${item.itemName}"`);
        continue;
      }

      // Smart auto-reset: If user dismissed this alert in Firestore,
      // check if the current severity is WORSE than what was dismissed.
      // If worse → show the alert again (auto-reset the dismissal).
      // If same or better → respect the dismissal, skip.
      if (item.userDismissedAlert) {
        const currentSeverity = getSeverityLevel(item.alertState);
        const dismissedSeverity = getSeverityLevel(item.userDismissedAlertState);

        if (currentSeverity > dismissedSeverity) {
          console.log(
            `[AlertsScreen] Auto-reset: "${item.itemName}" dismissed at ${item.userDismissedAlertState}, now ${item.alertState} (worse) → SHOWING`
          );
          // Fall through — show the alert
        } else {
          console.log(
            `[AlertsScreen] Filtered out (dismissed at ${item.userDismissedAlertState}, now ${item.alertState}): "${item.itemName}"`
          );
          continue;
        }
      }

      result.push(item);
    }

    console.log(`[AlertsScreen] Final visible alerts: ${result.length} (from ${rawAlerts.length} raw)`);
    return result;
  }, [rawAlerts, locallyDismissedItemIds]);

  // ─── Dismiss handler (updates the item document) ──────────────────
  const handleDismissAlert = useCallback(
    (alert: AlertEntry) => {
      Alert.alert(
        "Dismiss Alert",
        `Mark "${alert.itemName}" alert as acknowledged?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Dismiss",
            style: "destructive",
            onPress: () => {
              const anim = getAnimValue(alert.id);
              setDismissingIds((prev) => new Set(prev).add(alert.id));

              Animated.timing(anim, {
                toValue: 0,
                duration: 300,
                useNativeDriver: true,
              }).start(async () => {
                // Optimistically hide from UI
                setLocallyDismissedItemIds((prev) => new Set(prev).add(alert.itemId));
                setDismissingIds((prev) => {
                  const next = new Set(prev);
                  next.delete(alert.id);
                  return next;
                });

                // Update the item document in Firestore to mark dismissed
                // Store the current alert state so we can auto-reset if it worsens
                try {
                  await updateDoc(doc(db, "items", alert.itemId), {
                    userDismissedAlert: true,
                    userDismissedAlertAt: new Date(),
                    userDismissedAlertState: alert.alertState,
                  });
                  console.log(
                    `[AlertsScreen] Dismissed: "${alert.itemName}" (${alert.itemId}) at state=${alert.alertState}`
                  );
                } catch (err) {
                  console.error("[AlertsScreen] Failed to dismiss item alert:", err);
                  // Revert local dismiss on error
                  setLocallyDismissedItemIds((prev) => {
                    const next = new Set(prev);
                    next.delete(alert.itemId);
                    return next;
                  });
                  // Reset animation
                  anim.setValue(1);
                }
              });
            },
          },
        ]
      );
    },
    [getAnimValue]
  );

  // ─── Fetch activities from alertsLog ────────────────────────────
  useEffect(() => {
    setLoadingActivities(true);

    console.log("[AlertsScreen] Querying alertsLog (no siteId filter — field doesn't exist on these docs)");

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

        // Sort client-side by createdAt descending (newest first)
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

  // ─── Filtered activities (UNCHANGED) ──────────────────────────────
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

  // ─── CSV Export (UNCHANGED) ───────────────────────────────────────
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

  // ─── Render: Filter Chips (for Activity Log, UNCHANGED) ───────────
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

  // ─── Render: Activity Item (UNCHANGED) ────────────────────────────
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

  // ─── Render: Alert Item (now driven by items collection) ──────────
  function renderAlertItem({ item }: { item: AlertEntry }) {
    const statusColor = getStatusColor(item.alertState);
    const isOut = item.alertState === "OUT" || item.alertState === "CRITICAL";
    const isDismissing = dismissingIds.has(item.id);
    const animOpacity = getAnimValue(item.id);
    const animScale = animOpacity.interpolate({
      inputRange: [0, 1],
      outputRange: [0.95, 1],
    });
    const animTranslateX = animOpacity.interpolate({
      inputRange: [0, 1],
      outputRange: [60, 0],
    });

    return (
      <Animated.View
        style={{
          opacity: animOpacity,
          transform: [{ scale: animScale }, { translateX: animTranslateX }],
        }}
      >
        <Pressable
          onPress={() => handleDismissAlert(item)}
          disabled={isDismissing}
          style={({ pressed }) => [
            styles.card,
            {
              backgroundColor: pressed ? (statusColor + "12") : theme.card,
              borderColor: isOut ? "#ef444440" : theme.border,
              borderLeftWidth: 3,
              borderLeftColor: statusColor,
              transform: [{ scale: pressed ? 0.98 : 1 }],
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
              <Ionicons name="close-circle-outline" size={18} color={theme.mutedText} style={{ opacity: 0.5 }} />
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

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 3 }}>
              <Text style={{ color: theme.mutedText, fontSize: 10 }}>
                {item.lastAlertAt ? `Last alert ${formatTimestamp(item.lastAlertAt)}` : ""}
              </Text>
              <Text style={{ color: theme.mutedText, fontSize: 10, fontStyle: "italic" }}>
                Tap to dismiss
              </Text>
            </View>
          </View>
        </Pressable>
      </Animated.View>
    );
  }

  // ─── Effective loading states (combine profile + data loading) ─────
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
              Alerts{alerts.length > 0 ? ` (${alerts.length})` : ""}
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
          ) : alerts.length === 0 ? (
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
              data={alerts}
              keyExtractor={(item) => item.id}
              renderItem={renderAlertItem}
              contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
              showsVerticalScrollIndicator={false}
            />
          )}
        </>
      )}

      {/* ─── Activity Log View (UNCHANGED) ───────────────────────────── */}
      {activeView === "activity" && (
        <>
          {/* Filters */}
          <FilterChips />

          {/* Export button */}
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

          {/* Activity list */}
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

