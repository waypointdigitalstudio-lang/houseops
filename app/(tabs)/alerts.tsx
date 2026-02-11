// app/(tabs)/alerts.tsx
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where
} from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";

import { BRAND } from "../../constants/branding";
import { useAppTheme } from "../../constants/theme";
import { db } from "../../firebaseConfig";
import { usePushNotifications } from "../../hooks/usePushNotifications";
import { useUserProfile } from "../../hooks/useUserProfile";

type AlertType = "low" | "out" | "restock";

type AlertDoc = {
  siteId?: string;

  type: AlertType;
  title: string;
  body: string;

  itemId?: string;
  itemName?: string;

  qty?: number;
  min?: number;

  createdAt?: any;
  updatedAt?: any;

  readBy?: Record<string, boolean>; // key = device token
};

type AlertRow = AlertDoc & { id: string };

export default function AlertsScreen() {
  const theme = useAppTheme();

  // Token is used for "read/unread"
  const token = usePushNotifications() as string | null;

  // Site scoping
  const { profile, loading: profileLoading } = useUserProfile();
  const siteId = profile?.siteId ?? null;

  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Toggle between "unread" and "history" view
  const [viewMode, setViewMode] = useState<"unread" | "history">("unread");
  const [sortMode, setSortMode] = useState<"newest" | "type">("newest");

  useEffect(() => {
    if (profileLoading) return;

    if (!siteId) {
      setAlerts([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    // Pull alerts for this site
    const q = query(
      collection(db, "alerts"),
      where("siteId", "==", siteId),
      orderBy("createdAt", "desc"),
      limit(viewMode === "history" ? 500 : 200)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: AlertRow[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as AlertDoc),
        }));
        setAlerts(rows);
        setLoading(false);
      },
      (err) => {
        console.log("Alerts snapshot error:", err);
        setAlerts([]);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [siteId, profileLoading, viewMode]);

  const isUnread = (a: AlertRow) => {
    // If token isn't ready, treat as unread so user still sees stuff
    if (!token) return true;
    return !(a.readBy && a.readBy[token]);
  };

  const badgeStyleFor = (type: AlertType) => {
    if (type === "out") return { backgroundColor: "#ef4444" }; // red
    if (type === "low") return { backgroundColor: "#f59e0b" }; // amber
    return { backgroundColor: "#22c55e" }; // green
  };

  const formatDate = (alert: AlertRow) => {
    const ts = alert.createdAt;
    if (!ts || !ts.toDate) return "";
    const d = ts.toDate() as Date;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Filter based on view mode
  const filteredAlerts = useMemo(() => {
    if (viewMode === "history") {
      return alerts; // Show all
    }
    return alerts.filter(isUnread); // Show unread only
  }, [alerts, viewMode, token]);

  // Sort
  const sortedAlerts = useMemo(() => {
    const list = [...filteredAlerts];

    if (sortMode === "type") {
      const rank: Record<AlertType, number> = { out: 0, low: 1, restock: 2 };
      return list.sort((a, b) => rank[a.type] - rank[b.type]);
    }

    // newest already from Firestore ordering
    return list;
  }, [filteredAlerts, sortMode]);

  // Group by date for history view
  const groupedAlerts = useMemo(() => {
    if (viewMode !== "history") return null;

    const groups: { [key: string]: AlertRow[] } = {};
    
    sortedAlerts.forEach((alert) => {
      const ts = alert.createdAt;
      if (!ts || !ts.toDate) return;
      
      const d = ts.toDate() as Date;
      const dateKey = d.toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(alert);
    });
    
    return Object.entries(groups);
  }, [sortedAlerts, viewMode]);

  const markOneAsRead = async (alertId: string) => {
    if (!token) return;

    try {
      const ref = doc(db, "alerts", alertId);
      await setDoc(
        ref,
        {
          readBy: { [token]: true },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (e) {
      console.log("Mark read failed:", e);
    }
  };

  const ViewToggle = () => (
    <View
      style={{
        flexDirection: "row",
        gap: 8,
        marginTop: 12,
      }}
    >
      <Pressable
        onPress={() => setViewMode("unread")}
        style={{
          flex: 1,
          paddingVertical: 10,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: viewMode === "unread" ? theme.tint : theme.border,
          backgroundColor: viewMode === "unread" ? theme.card : "transparent",
          alignItems: "center",
        }}
      >
        <Text
          style={{
            color: viewMode === "unread" ? theme.tint : theme.text,
            fontSize: 14,
            fontWeight: "700",
          }}
        >
          Unread
        </Text>
      </Pressable>

      <Pressable
        onPress={() => setViewMode("history")}
        style={{
          flex: 1,
          paddingVertical: 10,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: viewMode === "history" ? theme.tint : theme.border,
          backgroundColor: viewMode === "history" ? theme.card : "transparent",
          alignItems: "center",
        }}
      >
        <Text
          style={{
            color: viewMode === "history" ? theme.tint : theme.text,
            fontSize: 14,
            fontWeight: "700",
          }}
        >
          History
        </Text>
      </Pressable>
    </View>
  );

  const SortPill = ({
    mode,
    label,
  }: {
    mode: "newest" | "type";
    label: string;
  }) => {
    const active = sortMode === mode;

    return (
      <Pressable
        onPress={() => setSortMode(mode)}
        style={{
          paddingVertical: 6,
          paddingHorizontal: 12,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: active ? theme.tint : theme.border,
          backgroundColor: active ? theme.card : "transparent",
        }}
      >
        <Text style={{ color: theme.text, fontSize: 12, fontWeight: "700" }}>
          {label}
        </Text>
      </Pressable>
    );
  };

  const renderAlert = (item: AlertRow, showDate = false) => (
    <Pressable
      onPress={() => viewMode === "unread" && markOneAsRead(item.id)}
      disabled={viewMode === "history"}
    >
      <View
        style={{
          backgroundColor: theme.card,
          borderRadius: 14,
          padding: 14,
          borderWidth: 1,
          borderColor: theme.border,
          marginBottom: 8,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 999,
              ...badgeStyleFor(item.type),
            }}
          >
            <Text style={{ color: "#000", fontWeight: "900", fontSize: 11 }}>
              {String(item.type ?? "low").toUpperCase()}
            </Text>
          </View>

          {viewMode === "unread" && (
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                backgroundColor: BRAND.primary,
              }}
            />
          )}

          {showDate && (
            <Text style={{ color: theme.mutedText, fontSize: 11 }}>
              {formatDate(item)}
            </Text>
          )}
        </View>

        <Text style={{ color: theme.text, fontWeight: "800", fontSize: 15 }}>
          {item.title}
        </Text>

        <Text style={{ color: theme.mutedText, marginTop: 4, fontSize: 13 }}>
          {item.body}
        </Text>

        {typeof item.qty === "number" && typeof item.min === "number" ? (
          <Text style={{ color: theme.mutedText, marginTop: 6, fontSize: 12 }}>
            Qty: {item.qty} • Min: {item.min}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.background, padding: 16 }}>
      <Text style={{ color: theme.text, fontSize: 22, fontWeight: "800" }}>
        Alerts
      </Text>

      <Text style={{ color: theme.mutedText, fontSize: 13, marginTop: 6 }}>
        Site: {siteId ?? "Unassigned"}
      </Text>

      <ViewToggle />

      <Text style={{ color: theme.mutedText, fontSize: 13, marginTop: 12 }}>
        {viewMode === "unread"
          ? "Unread alerts only — tap one to mark it as read."
          : "Complete alert history for audit and tracking"}
      </Text>

      <View
        style={{
          flexDirection: "row",
          gap: 8,
          marginTop: 12,
          marginBottom: 12,
        }}
      >
        <SortPill mode="newest" label="Newest" />
        <SortPill mode="type" label="Type" />
      </View>

      {loading ? (
        <View style={{ marginTop: 30, alignItems: "center" }}>
          <ActivityIndicator />
          <Text style={{ color: theme.mutedText, marginTop: 8 }}>Loading…</Text>
        </View>
      ) : viewMode === "history" && groupedAlerts ? (
        // History view with date grouping
        <FlatList
          data={groupedAlerts}
          keyExtractor={([date]) => date}
          ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
          ListEmptyComponent={
            <View style={{ marginTop: 30, alignItems: "center" }}>
              <Text style={{ color: theme.text, fontWeight: "800", fontSize: 16 }}>
                No alerts yet
              </Text>
              <Text style={{ color: theme.mutedText, marginTop: 6 }}>
                Alert history will appear here
              </Text>
            </View>
          }
          renderItem={({ item: [date, dateAlerts] }) => (
            <View>
              <Text
                style={{
                  color: theme.text,
                  fontSize: 14,
                  fontWeight: "800",
                  marginBottom: 8,
                  opacity: 0.7,
                }}
              >
                {date}
              </Text>
              {dateAlerts.map((alert) => (
                <View key={alert.id}>{renderAlert(alert, true)}</View>
              ))}
            </View>
          )}
        />
      ) : (
        // Unread view (flat list)
        <FlatList
          data={sortedAlerts}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={
            <View style={{ marginTop: 18 }}>
              <Text style={{ color: theme.text, fontWeight: "800", fontSize: 16 }}>
                All caught up 🎉
              </Text>
              <Text style={{ color: theme.mutedText, marginTop: 6 }}>
                {siteId ? "No unread alerts right now." : "Assign a siteId to see alerts."}
              </Text>
            </View>
          }
          renderItem={({ item }) => renderAlert(item)}
        />
      )}
    </View>
  );
}