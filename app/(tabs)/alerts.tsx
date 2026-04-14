// app/(tabs)/alerts.tsx
// Alerts & Activity Log Screen
//
// v10 - 2026-03-16 — Performance fixes
// ------------------------------------------
// FIXES:
// - alertsLog query now filters by siteId (was fetching entire collection)
// - alertsLog query uses orderBy("createdAt", "desc") + limit(100) — no more JS sort
// - renderActivityItem wrapped in useCallback (was recreated on every render)
// - FilterChips extracted to React.memo component (was remounting on every state change)
// - alertsLog useEffect now depends on siteId (was running before siteId resolved)
// - JS sort on activities removed (Firestore handles it via orderBy)
//
// NOTE: You will need a composite Firestore index on alertsLog for:
//   siteId (ASC) + createdAt (DESC)
// Firestore will throw an error with a direct link to create it on first run.

import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
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
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useAppTheme } from "../../constants/theme";
import { db } from "../../firebaseConfig";
import { useUserProfile } from "../../hooks/useUserProfile";

// ─── Types ───────────────────────────────────────────────────────────

type AnalyticsPeriod = "7days" | "30days" | "all";

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
  itemType: "inventory" | "toner" | "radioPart";
  createdAt: Timestamp | null;
  dismissed: boolean;
  userDismissed: boolean;
}

interface AlertEntry {
  id: string;
  itemId: string;
  itemType: "inventory" | "toner" | "radioPart";
  itemName: string;
  location: string;
  siteId: string;
  alertState: string;
  currentQuantity: number;
  minQuantity: number;
  lastAlertAt: Timestamp | null;
  isLowStock: boolean;
  userDismissedAlert: boolean;
  userDismissedAlertQuantity: number | null;
}

// ─── Active-state accent color ──────────────────────────────────────
const ACTIVE_BG = "#2563eb";
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
    case "added":     return { name: "add-circle",    color: "#22c55e" };
    case "edited":    return { name: "create",         color: "#3b82f6" };
    case "deleted":   return { name: "trash",          color: "#ef4444" };
    case "deducted":  return { name: "remove-circle",  color: "#f97316" };
    case "linked":    return { name: "link",           color: "#8b5cf6" };
    case "unlinked":  return { name: "unlink",         color: "#f59e0b" };
    case "disposed":  return { name: "close-circle",   color: "#ef4444" };
    default:          return { name: "ellipse",        color: "#6b7280" };
  }
}

function getSeverityLevel(state: string): number {
  switch (state.toUpperCase()) {
    case "OUT":      return 3;
    case "CRITICAL": return 2;
    case "LOW":      return 1;
    default:         return 0;
  }
}

function calculateAlertState(currentQty: number, minQty: number): string {
  if (currentQty <= 0)             return "OUT";
  if (currentQty <= minQty * 0.5) return "CRITICAL";
  if (currentQty <= minQty)       return "LOW";
  return "OK";
}

function getStatusColor(status: string): string {
  switch (status.toUpperCase()) {
    case "OK":                  return "#22c55e";
    case "LOW":                 return "#f97316";
    case "CRITICAL": case "OUT": return "#ef4444";
    default:                    return "#6b7280";
  }
}

function formatTimestamp(ts: Timestamp | null): string {
  if (!ts || typeof ts.toDate !== "function") return "—";
  try {
    const d = ts.toDate();
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);

    if (mins < 1)   return "Just now";
    if (mins < 60)  return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7)   return `${days}d ago`;

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
  if (!ts || typeof ts.toDate !== "function") return "";
  try {
    return ts.toDate().toLocaleDateString("en-US", {
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
  return "edited";
}

function getDateCutoff(filter: DateFilter): Date | null {
  if (filter === "all") return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (filter === "today")  return now;
  if (filter === "7days")  { now.setDate(now.getDate() - 7);  return now; }
  if (filter === "30days") { now.setDate(now.getDate() - 30); return now; }
  return null;
}

function shouldShowAlert(item: AlertEntry): boolean {
  if (!item.userDismissedAlert) return true;
  if (item.userDismissedAlertQuantity === null || item.userDismissedAlertQuantity === undefined) return true;
  return item.currentQuantity !== item.userDismissedAlertQuantity;
}

function getItemCollection(itemType: AlertEntry["itemType"]): string {
  if (itemType === "toner") return "toners";
  if (itemType === "radioPart") return "radioParts";
  return "items";
}

function formatItemType(t: string): string {
  if (t === "radioPart") return "Radio Part";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ─── FilterChips — extracted to React.memo to prevent remounting ────
// Previously defined as an inline function inside AlertsScreen, which
// caused full remounts on every state change.

const FilterChips = React.memo(function FilterChips({
  dateFilter,
  actionFilter,
  onDateChange,
  onActionChange,
  theme,
}: {
  dateFilter: DateFilter;
  actionFilter: ActionFilter;
  onDateChange: (v: DateFilter) => void;
  onActionChange: (v: ActionFilter) => void;
  theme: ReturnType<typeof useAppTheme>;
}) {
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
              onPress={() => onDateChange(f.value)}
              style={[
                styles.chipSmall,
                {
                  backgroundColor: active ? ACTIVE_BG : "transparent",
                  borderColor: active ? ACTIVE_BG : theme.border,
                },
              ]}
            >
              <Text style={[styles.chipTextSmall, { color: active ? ACTIVE_TEXT : theme.mutedText }]}>
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
              onPress={() => onActionChange(f.value)}
              style={[
                styles.chipSmall,
                {
                  backgroundColor: active ? ACTIVE_BG : "transparent",
                  borderColor: active ? ACTIVE_BG : theme.border,
                },
              ]}
            >
              <Text style={[styles.chipTextSmall, { color: active ? ACTIVE_TEXT : theme.mutedText }]}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
});

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
  const dismissingRef = useRef(false);
  const statusColor = getStatusColor(item.alertState);
  const isOut = item.alertState === "OUT" || item.alertState === "CRITICAL";
  const typeLabel = item.itemType !== "inventory" ? formatItemType(item.itemType) : null;

  const handlePress = useCallback(() => {
    if (dismissingRef.current) return;
    dismissingRef.current = true;

    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      // Fire dismiss AFTER animation so the fade plays fully before the item is removed
      onDismiss(item);
    });
  }, [item, onDismiss, fadeAnim]);

  return (
    <Animated.View style={{ opacity: fadeAnim }}>
      <TouchableOpacity activeOpacity={0.6} onPress={handlePress}>
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
          <View style={[styles.iconCircle, { backgroundColor: statusColor + "1A" }]}>
            <Ionicons name={isOut ? "alert-circle" : "warning"} size={20} color={statusColor} />
          </View>

          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={1}>
              {item.itemName}
            </Text>

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
              {typeLabel && (
                <View style={[styles.actionBadge, { backgroundColor: theme.border + "60" }]}>
                  <Text style={{ color: theme.mutedText, fontSize: 11, fontWeight: "600" }}>{typeLabel}</Text>
                </View>
              )}
              <Text style={{ color: theme.mutedText, fontSize: 11 }}>
                Qty: {item.currentQuantity} / Min: {item.minQuantity}
              </Text>
            </View>

            {item.lastAlertAt && (
              <Text style={{ color: theme.mutedText, fontSize: 10, marginTop: 3 }}>
                Last alert {formatTimestamp(item.lastAlertAt)}
              </Text>
            )}

            <Text style={{ color: theme.mutedText, fontSize: 10, marginTop: 4, fontStyle: "italic", opacity: 0.7 }}>
              Tap to dismiss
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Horizontal Bar ──────────────────────────────────────────────────

function HBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <View style={{ height: 6, backgroundColor: color + "22", borderRadius: 3, overflow: "hidden", marginTop: 5 }}>
      <View style={{ width: `${pct}%`, height: "100%", backgroundColor: color, borderRadius: 3 }} />
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────

export default function AlertsScreen() {
  const theme = useAppTheme();
  const { siteId, loading: profileLoading } = useUserProfile();

  const [activeView, setActiveView] = useState<"alerts" | "activity" | "analytics">("alerts");

  // ─── Alerts state ─────────────────────────────────────────────────
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [locallyDismissedIds, setLocallyDismissedIds] = useState<Set<string>>(new Set());
  const alertGenRef = useRef(0);

  // ─── Activity log state ──────────────────────────────────────────
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(true);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");

  // ─── Analytics state ─────────────────────────────────────────────
  const [analyticsPeriod, setAnalyticsPeriod] = useState<AnalyticsPeriod>("30days");
  const [analyticsActivities, setAnalyticsActivities] = useState<ActivityEntry[]>([]);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  // ─── Fetch low-stock items ────────────────────────────────────────
  useEffect(() => {
    const thisGeneration = ++alertGenRef.current;

    if (!siteId) {
      setAlerts([]);
      setLoadingAlerts(false);
      return;
    }

    setLoadingAlerts(true);
    setLocallyDismissedIds(new Set());

    // Each source accumulates here; all three listeners share this closure
    const data: Record<string, AlertEntry[]> = { items: [], toners: [], radioParts: [] };
    const loaded = new Set<string>();

    function buildEntries(
      snapshot: any,
      itemType: AlertEntry["itemType"],
      getName: (d: any) => string,
      getQty: (d: any) => number,
      getMin: (d: any) => number,
      getLoc: (d: any) => string,
    ): AlertEntry[] {
      const result: AlertEntry[] = [];
      for (const docSnap of snapshot.docs) {
        const d = docSnap.data();
        const currentQty = Number(getQty(d) ?? 0);
        const minQty = Number(getMin(d) ?? 0);
        // Alert if out of stock OR below minimum threshold
        if (currentQty > 0 && (minQty === 0 || currentQty > minQty)) continue;
        const alertState = calculateAlertState(currentQty, minQty);
        const entry: AlertEntry = {
          id: docSnap.id, itemId: docSnap.id, itemType,
          itemName: getName(d), location: getLoc(d) ?? "",
          siteId: d.siteId ?? "", alertState,
          currentQuantity: currentQty, minQuantity: minQty,
          lastAlertAt: d.lastAlertAt ?? null,
          isLowStock: true,
          userDismissedAlert: d.userDismissedAlert ?? false,
          userDismissedAlertQuantity: typeof d.userDismissedAlertQuantity === "number" ? d.userDismissedAlertQuantity : null,
        };
        if (shouldShowAlert(entry)) result.push(entry);
      }
      return result;
    }

    function commit(source: string, entries: AlertEntry[]) {
      if (alertGenRef.current !== thisGeneration) return;
      data[source] = entries;
      loaded.add(source);
      const all = [...data.items, ...data.toners, ...data.radioParts];
      all.sort((a, b) => getSeverityLevel(b.alertState) - getSeverityLevel(a.alertState));
      const allIds = new Set(all.map((a) => a.itemId));
      setLocallyDismissedIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set([...prev].filter((id) => !allIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
      setAlerts(all);
      if (loaded.size >= 3) setLoadingAlerts(false);
    }

    function onErr(source: string, err: any) {
      if (__DEV__) console.error(`[alerts] ${source}:`, err);
      loaded.add(source);
      if (alertGenRef.current === thisGeneration && loaded.size >= 3) setLoadingAlerts(false);
    }

    const unsubItems = onSnapshot(
      query(collection(db, "items"), where("siteId", "==", siteId)),
      (snap) => commit("items", buildEntries(snap, "inventory",
        (d) => d.name ?? "(unknown)", (d) => d.currentQuantity, (d) => d.minQuantity, (d) => d.location ?? "")),
      (err) => onErr("items", err)
    );

    const unsubToners = onSnapshot(
      query(collection(db, "toners"), where("siteId", "==", siteId)),
      (snap) => commit("toners", buildEntries(snap, "toner",
        (d) => `${d.model ?? "Unknown"} (${d.color ?? ""})`.trim(), (d) => d.quantity, (d) => d.minQuantity, () => "")),
      (err) => onErr("toners", err)
    );

    const unsubParts = onSnapshot(
      query(collection(db, "radioParts"), where("siteId", "==", siteId)),
      (snap) => commit("radioParts", buildEntries(snap, "radioPart",
        (d) => d.name ?? "(unknown)", (d) => d.quantity, (d) => d.minQuantity, (d) => d.location ?? "")),
      (err) => onErr("radioParts", err)
    );

    return () => { unsubItems(); unsubToners(); unsubParts(); };
  }, [siteId]);

  // ─── Fetch activity log ───────────────────────────────────────────
  // FIX: Now filters by siteId, orders in Firestore, and limits to 100 docs.
  // Previously queried the entire alertsLog collection with no filter.
  // IMPORTANT: Requires a composite index on alertsLog: siteId ASC + createdAt DESC.
  // Firestore will log a link to create it automatically on first run.
  useEffect(() => {
    if (!siteId) {
      setActivities([]);
      setLoadingActivities(false);
      return;
    }

    setLoadingActivities(true);

    const q = query(
      collection(db, "alertsLog"),
      where("siteId", "==", siteId),
      orderBy("createdAt", "desc"),
      limit(100)
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {

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
            action: data.action ?? inferActionFromStates(data.prevState, data.nextState),
            itemType: data.itemType ?? "inventory",
            createdAt: data.createdAt ?? null,
            dismissed: data.dismissed ?? false,
            userDismissed: data.userDismissed ?? false,
          } as ActivityEntry;
        });

        // No JS sort needed — Firestore orderBy handles it
        setActivities(items);
        setLoadingActivities(false);
      },
      (err) => {
        if (__DEV__) console.error("[AlertsScreen] Error fetching activities:", err);
        setLoadingActivities(false);
      }
    );

    return () => unsub();
  }, [siteId]); // FIX: was missing siteId dependency

  // ─── Fetch analytics data (dedicated query, up to 500 entries) ────
  useEffect(() => {
    if (!siteId) {
      setAnalyticsActivities([]);
      setLoadingAnalytics(false);
      return;
    }

    setLoadingAnalytics(true);

    const cutoffDate = getDateCutoff(analyticsPeriod);
    const constraints: any[] = [
      where("siteId", "==", siteId),
    ];
    if (cutoffDate) {
      constraints.push(where("createdAt", ">=", Timestamp.fromDate(cutoffDate)));
    }
    constraints.push(orderBy("createdAt", "desc"));
    constraints.push(limit(500));

    const q = query(collection(db, "alertsLog"), ...constraints);

    const unsub = onSnapshot(
      q,
      (snapshot) => {
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
            action: data.action ?? inferActionFromStates(data.prevState, data.nextState),
            itemType: data.itemType ?? "inventory",
            createdAt: data.createdAt ?? null,
            dismissed: data.dismissed ?? false,
            userDismissed: data.userDismissed ?? false,
          } as ActivityEntry;
        });
        setAnalyticsActivities(items);
        setLoadingAnalytics(false);
      },
      (err) => {
        if (__DEV__) console.error("[AlertsScreen] Error fetching analytics:", err);
        setLoadingAnalytics(false);
      }
    );

    return () => unsub();
  }, [siteId, analyticsPeriod]);

  // ─── Dismiss handler ──────────────────────────────────────────────
  const handleDismiss = useCallback(async (item: AlertEntry) => {
    if (!item.itemId) {
      Alert.alert("Dismiss Error", "Invalid item ID. Cannot dismiss this alert.");
      return;
    }

    setLocallyDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(item.itemId);
      return next;
    });

    try {
      await updateDoc(doc(db, getItemCollection(item.itemType), item.itemId), {
        userDismissedAlert: true,
        userDismissedAlertQuantity: item.currentQuantity,
      });
    } catch (err: any) {
      if (__DEV__) console.error(`[AlertsScreen] Error dismissing "${item.itemName}":`, err);
      Alert.alert(
        "Dismiss Failed",
        `Could not dismiss "${item.itemName}". ${err?.message ?? "Unknown error"}. Please try again.`
      );
      setLocallyDismissedIds((prev) => {
        const next = new Set(prev);
        next.delete(item.itemId);
        return next;
      });
    }
  }, []);

  // ─── Visible alerts (exclude locally dismissed) ───────────────────
  const visibleAlerts = useMemo(() => {
    if (locallyDismissedIds.size === 0) return alerts;
    return alerts.filter((a) => !locallyDismissedIds.has(a.itemId));
  }, [alerts, locallyDismissedIds]);

  // ─── Filtered activities (client-side date/action filter) ─────────
  const filteredActivities = useMemo(() => {
    let result = activities;

    const cutoff = getDateCutoff(dateFilter);
    if (cutoff) {
      result = result.filter((a) => {
        if (!a.createdAt || typeof a.createdAt.toDate !== "function") return true;
        try { return a.createdAt.toDate() >= cutoff; } catch { return true; }
      });
    }

    if (actionFilter !== "all") {
      result = result.filter((a) => a.action === actionFilter);
    }

    return result;
  }, [activities, dateFilter, actionFilter]);

  // ─── Analytics aggregation ───────────────────────────────────────
  const analyticsData = useMemo(() => {
    const data = analyticsActivities;

    // Top consumed: deducted events grouped by itemName, summing qty
    const consumptionMap: Record<string, { qty: number; itemType: string }> = {};
    for (const a of data) {
      if (a.action === "deducted") {
        if (!consumptionMap[a.itemName]) consumptionMap[a.itemName] = { qty: 0, itemType: a.itemType };
        consumptionMap[a.itemName].qty += a.qty;
      }
    }
    const topConsumed = Object.entries(consumptionMap)
      .sort((a, b) => b[1].qty - a[1].qty)
      .slice(0, 5)
      .map(([name, v]) => ({ name, ...v }));

    // Most alerted: entries where nextState degraded (LOW / CRITICAL / OUT)
    const alertMap: Record<string, number> = {};
    for (const a of data) {
      const ns = (a.nextState ?? "").toUpperCase();
      if (ns === "LOW" || ns === "CRITICAL" || ns === "OUT") {
        alertMap[a.itemName] = (alertMap[a.itemName] ?? 0) + 1;
      }
    }
    const topAlerted = Object.entries(alertMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    // Action breakdown counts
    const breakdown: Record<string, number> = {};
    for (const a of data) {
      breakdown[a.action] = (breakdown[a.action] ?? 0) + 1;
    }

    return { topConsumed, topAlerted, breakdown, total: data.length };
  }, [analyticsActivities]);

  // ─── Reorder List Export ─────────────────────────────────────────
  const generateReorderList = useCallback(async () => {
    const outItems = visibleAlerts.filter(
      (a) => a.alertState === "OUT" || a.alertState === "CRITICAL"
    );
    const lowItems = visibleAlerts.filter((a) => a.alertState === "LOW");

    const date = new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    const escapeCell = (val: string) =>
      val.includes(",") || val.includes('"') || val.includes("\n")
        ? `"${val.replace(/"/g, '""')}"`
        : val;

    const rows: string[] = [
      "Item Name,Location,Status,Current Qty,Min Qty,Site,Generated",
      ...[...outItems, ...lowItems].map((a) =>
        [
          escapeCell(a.itemName),
          escapeCell(a.location ?? ""),
          a.alertState,
          a.currentQuantity.toString(),
          a.minQuantity.toString(),
          escapeCell(siteId ?? ""),
          escapeCell(date),
        ].join(",")
      ),
    ];

    const content = rows.join("\n");
    const filename = `ReorderList_${siteId}_${new Date().toISOString().split("T")[0]}.csv`;

    try {
      if (Platform.OS === "web") {
        const blob = new Blob([content], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
      } else {
        const fileUri = FileSystem.cacheDirectory + filename;
        await FileSystem.writeAsStringAsync(fileUri, content, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        await Sharing.shareAsync(fileUri, {
          mimeType: "text/csv",
          dialogTitle: "Share Reorder List",
          UTI: "public.comma-separated-values-text",
        });
      }
    } catch (err) {
      if (__DEV__) console.error("Reorder list export error:", err);
    }
  }, [visibleAlerts, siteId]);

  // ─── CSV Export ───────────────────────────────────────────────────
  const exportCSV = useCallback(async () => {
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
      if (__DEV__) console.error("CSV export error:", err);
    }
  }, [filteredActivities]);

  // ─── Render: Alert Item ───────────────────────────────────────────
  const renderAlertItem = useCallback(
    ({ item }: { item: AlertEntry }) => (
      <AlertCard item={item} theme={theme} onDismiss={handleDismiss} />
    ),
    [theme, handleDismiss]
  );

  // ─── Render: Activity Item ────────────────────────────────────────
  // FIX: Wrapped in useCallback — was an inline function causing FlatList
  // to re-render every row on every parent state change.
  const renderActivityItem = useCallback(
    ({ item }: { item: ActivityEntry }) => {
      const icon = getActionIcon(item.action);
      const statusColor = getStatusColor(item.nextState);

      return (
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={[styles.iconCircle, { backgroundColor: icon.color + "1A" }]}>
            <Ionicons name={icon.name} size={20} color={icon.color} />
          </View>

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
              <View style={[styles.actionBadge, { backgroundColor: icon.color + "1A" }]}>
                <Text style={{ color: icon.color, fontSize: 11, fontWeight: "700", textTransform: "capitalize" }}>
                  {item.action}
                </Text>
              </View>
              <Text style={{ color: theme.mutedText, fontSize: 11 }}>{item.itemType}</Text>
              <Text style={{ color: theme.mutedText, fontSize: 11 }}>Qty: {item.qty}</Text>
            </View>

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
    },
    [theme]
  );

  // ─── Loading states ───────────────────────────────────────────────
  const isAlertsLoading     = profileLoading || loadingAlerts;
  const isActivitiesLoading = profileLoading || loadingActivities;

  // ─── Main Render ──────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Alerts & Activity</Text>

        <View style={[styles.tabBar, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Pressable
            onPress={() => setActiveView("alerts")}
            style={[styles.tab, activeView === "alerts" && { backgroundColor: ACTIVE_BG, borderColor: ACTIVE_BG }]}
          >
            <Text style={[styles.tabText, { color: activeView === "alerts" ? ACTIVE_TEXT : theme.mutedText }]}>
              Alerts{visibleAlerts.length > 0 ? ` (${visibleAlerts.length})` : ""}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveView("activity")}
            style={[styles.tab, activeView === "activity" && { backgroundColor: ACTIVE_BG, borderColor: ACTIVE_BG }]}
          >
            <Text style={[styles.tabText, { color: activeView === "activity" ? ACTIVE_TEXT : theme.mutedText }]}>
              Activity
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveView("analytics")}
            style={[styles.tab, activeView === "analytics" && { backgroundColor: ACTIVE_BG, borderColor: ACTIVE_BG }]}
          >
            <Text style={[styles.tabText, { color: activeView === "analytics" ? ACTIVE_TEXT : theme.mutedText }]}>
              Analytics
            </Text>
          </Pressable>
        </View>
      </View>

      {/* ─── Alerts View ──────────────────────────────────────────── */}
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
            <>
              <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
                <Pressable
                  onPress={generateReorderList}
                  style={[styles.exportBtn, { borderColor: theme.border }]}
                >
                  <Ionicons name="cart-outline" size={16} color={theme.text} />
                  <Text style={{ color: theme.text, fontSize: 13, fontWeight: "700", marginLeft: 6 }}>
                    Generate Reorder List ({visibleAlerts.length})
                  </Text>
                </Pressable>
              </View>
              <FlatList
                data={visibleAlerts}
                keyExtractor={(item) => item.id}
                renderItem={renderAlertItem}
                contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
                showsVerticalScrollIndicator={false}
              />
            </>
          )}
        </>
      )}

      {/* ─── Analytics View ──────────────────────────────────────── */}
      {activeView === "analytics" && (
        <>
          {/* Period selector — always visible above content */}
          <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 10, alignItems: "center" }}>
            {(["7days", "30days", "all"] as const).map((p) => {
              const label = p === "7days" ? "7 Days" : p === "30days" ? "30 Days" : "All Time";
              const active = analyticsPeriod === p;
              return (
                <Pressable
                  key={p}
                  onPress={() => setAnalyticsPeriod(p)}
                  style={[
                    styles.chipSmall,
                    { backgroundColor: active ? ACTIVE_BG : "transparent", borderColor: active ? ACTIVE_BG : theme.border },
                  ]}
                >
                  <Text style={[styles.chipTextSmall, { color: active ? ACTIVE_TEXT : theme.mutedText }]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
            {!loadingAnalytics && (
              <Text style={{ color: theme.mutedText, fontSize: 11, marginLeft: 4 }}>
                {analyticsData.total} entries
              </Text>
            )}
          </View>

          {loadingAnalytics ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={theme.text} />
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}>
              {/* Activity Breakdown */}
              <Text style={[styles.analyticsSection, { color: theme.text }]}>Activity Breakdown</Text>
              {Object.keys(analyticsData.breakdown).length === 0 ? (
                <Text style={{ color: theme.mutedText, fontSize: 13, marginBottom: 20 }}>
                  No activity in this period.
                </Text>
              ) : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
                  {Object.entries(analyticsData.breakdown).map(([action, count]) => {
                    const icon = getActionIcon(action);
                    return (
                      <View
                        key={action}
                        style={[styles.analyticsChip, { backgroundColor: icon.color + "1A", borderColor: icon.color + "44" }]}
                      >
                        <Ionicons name={icon.name} size={12} color={icon.color} />
                        <Text style={{ color: icon.color, fontSize: 12, fontWeight: "700", marginLeft: 4, textTransform: "capitalize" }}>
                          {action}
                        </Text>
                        <Text style={{ color: icon.color, fontSize: 14, fontWeight: "900", marginLeft: 6 }}>
                          {count}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Top Consumed */}
              <Text style={[styles.analyticsSection, { color: theme.text }]}>Top Consumed</Text>
              {analyticsData.topConsumed.length === 0 ? (
                <Text style={{ color: theme.mutedText, fontSize: 13, marginBottom: 24 }}>
                  No deductions logged in this period.
                </Text>
              ) : (
                <View style={[styles.analyticsCard, { backgroundColor: theme.card, borderColor: theme.border, marginBottom: 24 }]}>
                  {analyticsData.topConsumed.map((item, i) => (
                    <View
                      key={item.name}
                      style={[
                        styles.analyticsRow,
                        i < analyticsData.topConsumed.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border },
                      ]}
                    >
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <Text style={{ color: theme.text, fontSize: 13, fontWeight: "700", flex: 1 }} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text style={{ color: "#f97316", fontSize: 14, fontWeight: "900", marginLeft: 8 }}>
                          -{item.qty}
                        </Text>
                      </View>
                      <HBar value={item.qty} max={analyticsData.topConsumed[0].qty} color="#f97316" />
                    </View>
                  ))}
                </View>
              )}

              {/* Most Alerted */}
              <Text style={[styles.analyticsSection, { color: theme.text }]}>Most Alerted Items</Text>
              {analyticsData.topAlerted.length === 0 ? (
                <Text style={{ color: theme.mutedText, fontSize: 13, marginBottom: 24 }}>
                  No stock alerts logged in this period.
                </Text>
              ) : (
                <View style={[styles.analyticsCard, { backgroundColor: theme.card, borderColor: theme.border, marginBottom: 24 }]}>
                  {analyticsData.topAlerted.map((item, i) => (
                    <View
                      key={item.name}
                      style={[
                        styles.analyticsRow,
                        i < analyticsData.topAlerted.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border },
                      ]}
                    >
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <Text style={{ color: theme.text, fontSize: 13, fontWeight: "700", flex: 1 }} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text style={{ color: "#ef4444", fontSize: 14, fontWeight: "900", marginLeft: 8 }}>
                          {item.count}×
                        </Text>
                      </View>
                      <HBar value={item.count} max={analyticsData.topAlerted[0].count} color="#ef4444" />
                    </View>
                  ))}
                </View>
              )}

              <Text style={{ color: theme.mutedText, fontSize: 10, textAlign: "center", fontStyle: "italic" }}>
                Up to 500 entries for the selected period.
              </Text>
            </ScrollView>
          )}
        </>
      )}

      {/* ─── Activity Log View ────────────────────────────────────── */}
      {activeView === "activity" && (
        <>
          <FilterChips
            dateFilter={dateFilter}
            actionFilter={actionFilter}
            onDateChange={setDateFilter}
            onActionChange={setActionFilter}
            theme={theme}
          />

          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <Pressable
              onPress={exportCSV}
              style={[styles.exportBtn, { borderColor: theme.border }]}
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
  analyticsSection: {
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 10,
  },
  analyticsCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  analyticsRow: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  analyticsChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
});
