// app/(tabs)/alerts.tsx
// Activity Log + Alerts Screen with toggle between views
// Fetches from Firestore 'alertsLog' collection, supports filtering and CSV export
// FIX: Removed orderBy from Firestore query to avoid composite index requirement
// FIX: Fixed case-sensitivity mismatch — index.tsx writes UPPERCASE states (OK, LOW, OUT)

import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  collection,
  onSnapshot,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
}

interface AlertEntry {
  id: string;
  itemName: string;
  itemType: string;
  status: string;
  qty: number;
  min: number;
  createdAt: Timestamp | null;
}

// ─── Active-state accent color (works in both light & dark mode) ────
const ACTIVE_BG = "#2563eb"; // blue-600
const ACTIVE_TEXT = "#ffffff"; // always white on blue

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

// FIX: Normalize to lowercase so it works with both "OK"/"LOW"/"OUT" (from index.tsx)
// and "ok"/"low"/"out" (used in alerts derivation)
function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case "ok":
      return "#22c55e";
    case "low":
      return "#f97316";
    case "critical":
    case "out":
      return "#ef4444";
    default:
      return "#6b7280";
  }
}

function formatTimestamp(ts: Timestamp | null): string {
  if (!ts) return "—";
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
}

function formatFullTimestamp(ts: Timestamp | null): string {
  if (!ts) return "";
  const d = ts.toDate();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
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

  // Activity log state
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(true);

  // Alerts state
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(true);

  // Filters
  const [dateFilter, setDateFilter] = useState<DateFilter>("7days");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");

  // ─── Fetch activities from alertsLog ───────────────────────────────
  // FIX: Removed orderBy("createdAt","desc") from the Firestore query.
  // Using where() + orderBy() on different fields requires a composite index
  // in Firestore. Without it, the query silently fails and returns 0 results,
  // causing "No activities found". We now sort client-side instead.
  useEffect(() => {
    if (!siteId) return;

    setLoadingActivities(true);
    const q = query(
      collection(db, "alertsLog"),
      where("siteId", "==", siteId)
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const items: ActivityEntry[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as ActivityEntry[];
        // FIX: Sort client-side by createdAt descending (newest first)
        items.sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() ?? 0;
          const bTime = b.createdAt?.toMillis?.() ?? 0;
          return bTime - aTime;
        });
        setActivities(items);
        setLoadingActivities(false);
      },
      (err) => {
        console.error("Error fetching activities:", err);
        setLoadingActivities(false);
      }
    );

    return () => unsub();
  }, [siteId]);

  // ─── Derive alerts from activities (items with critical/low status) ─
  // FIX: index.tsx writes states in UPPERCASE ("OK", "LOW", "OUT"), so we
  // normalize to lowercase before comparing. This ensures alerts are correctly
  // derived regardless of the casing written by logActivity().
  useEffect(() => {
    // Build alerts from the latest state of each item
    const latestByItem = new Map<string, ActivityEntry>();
    for (const a of activities) {
      if (!latestByItem.has(a.itemId)) {
        latestByItem.set(a.itemId, a);
      }
    }
    const alertItems: AlertEntry[] = [];
    for (const [, entry] of latestByItem) {
      const normalizedState = (entry.nextState || "").toLowerCase();
      if (normalizedState === "low" || normalizedState === "critical" || normalizedState === "out") {
        alertItems.push({
          id: entry.id,
          itemName: entry.itemName,
          itemType: entry.itemType,
          status: normalizedState,
          qty: entry.qty,
          min: entry.min,
          createdAt: entry.createdAt,
        });
      }
    }
    // Sort alerts: critical/out first, then low
    alertItems.sort((a, b) => {
      const priority = (s: string) => (s === "critical" || s === "out" ? 0 : 1);
      return priority(a.status) - priority(b.status);
    });
    setAlerts(alertItems);
    setLoadingAlerts(false);
  }, [activities]);

  // ─── Filtered activities ───────────────────────────────────────────
  const filteredActivities = useMemo(() => {
    let result = [...activities];

    // Date filter
    const cutoff = getDateCutoff(dateFilter);
    if (cutoff) {
      result = result.filter((a) => {
        if (!a.createdAt) return false;
        return a.createdAt.toDate() >= cutoff;
      });
    }

    // Action filter
    if (actionFilter !== "all") {
      result = result.filter((a) => a.action === actionFilter);
    }

    return result;
  }, [activities, dateFilter, actionFilter]);

  // ─── CSV Export ────────────────────────────────────────────────────
  async function exportCSV() {
    try {
      const header = "Timestamp,Action,Item Type,Item Name,Quantity,Min Qty,Prev State,New State\n";
      const rows = filteredActivities.map((a) => {
        const ts = a.createdAt ? formatFullTimestamp(a.createdAt) : "";
        return `"${ts}","${a.action}","${a.itemType}","${a.itemName}",${a.qty},${a.min},"${a.prevState}","${a.nextState}"`;
      });
      const csv = header + rows.join("\n");

      if (Platform.OS === "web") {
        // Web: download via blob
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "activity_log.csv";
        link.click();
      } else {
        // Native: write to temp file and share
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

  // ─── Render: Filter Chips ──────────────────────────────────────────
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

  // ─── Render: Activity Item ─────────────────────────────────────────
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

          {/* State change — FIX: normalize case for display consistency */}
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

  // ─── Render: Alert Item ────────────────────────────────────────────
  function renderAlertItem({ item }: { item: AlertEntry }) {
    const statusColor = getStatusColor(item.status);
    const isOut = item.status === "out" || item.status === "critical";

    return (
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
          <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={1}>
            {item.itemName}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4, gap: 8 }}>
            <View style={[styles.actionBadge, { backgroundColor: statusColor + "1A" }]}>
              <Text style={{ color: statusColor, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>
                {item.status}
              </Text>
            </View>
            <Text style={{ color: theme.mutedText, fontSize: 11 }}>
              {item.itemType} · Qty: {item.qty} / Min: {item.min}
            </Text>
          </View>
          {item.createdAt && (
            <Text style={{ color: theme.mutedText, fontSize: 10, marginTop: 3 }}>
              Last updated {formatTimestamp(item.createdAt)}
            </Text>
          )}
        </View>
      </View>
    );
  }

  // ─── Loading State ─────────────────────────────────────────────────
  if (profileLoading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.text} />
      </View>
    );
  }

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
          {loadingAlerts ? (
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

      {/* ─── Activity Log View ───────────────────────────────────────── */}
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
          {loadingActivities ? (
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
