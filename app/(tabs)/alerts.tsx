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
  readBy?: Record<string, boolean>;
};

type AlertRow = AlertDoc & { id: string };

type ActivityLogDoc = {
  siteId?: string;
  itemName?: string;
  itemId?: string;
  qty?: number;
  min?: number;
  prevState?: string;
  nextState?: string;
  status?: string;
  createdAt?: any;
};

type ActivityLogRow = ActivityLogDoc & { id: string };

export default function AlertsScreen() {
  const theme = useAppTheme();
  const token = usePushNotifications() as string | null;
  const { profile, loading: profileLoading } = useUserProfile();
  const siteId = profile?.siteId ?? null;

  const [activeTab, setActiveTab] = useState<"alerts" | "activity">("alerts");
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [viewMode, setViewMode] = useState<"unread" | "history">("unread");
  const [sortMode, setSortMode] = useState<"newest" | "type">("newest");
  const [activityLogs, setActivityLogs] = useState<ActivityLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  // 1. Fetch Alerts
  useEffect(() => {
    if (profileLoading || !siteId || activeTab !== "alerts") return;
    setLoading(true);

    const q = query(
      collection(db, "alerts"),
      where("siteId", "==", siteId),
      orderBy("createdAt", "desc"),
      limit(viewMode === "history" ? 500 : 200)
    );

    const unsub = onSnapshot(q, (snap) => {
      setAlerts(snap.docs.map(d => ({ id: d.id, ...d.data() } as AlertRow)));
      setLoading(false);
    }, () => setLoading(false));

    return () => unsub();
  }, [siteId, profileLoading, viewMode, activeTab]);

  // 2. Fetch Activity Logs (alertsLog collection)
  useEffect(() => {
    if (profileLoading || !siteId || activeTab !== "activity") return;
    setLoading(true);

    const q = query(
      collection(db, "alertsLog"),
      where("siteId", "==", siteId),
      orderBy("createdAt", "desc"),
      limit(100)
    );

    const unsub = onSnapshot(q, (snap) => {
      setActivityLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as ActivityLogRow)));
      setLoading(false);
    }, () => setLoading(false));

    return () => unsub();
  }, [siteId, profileLoading, activeTab]);

  const isUnread = (a: AlertRow) => !token || !(a.readBy && a.readBy[token]);

  const badgeStyleFor = (state?: string) => {
    const s = state?.toLowerCase();
    if (s === "out") return { backgroundColor: "#ef4444" };
    if (s === "low") return { backgroundColor: "#f59e0b" };
    if (s === "ok" || s === "restock") return { backgroundColor: "#22c55e" };
    return { backgroundColor: theme.mutedText };
  };

  const formatDate = (ts: any) => {
    if (!ts || !ts.toDate) return "";
    return ts.toDate().toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  };

  const filteredAlerts = useMemo(() => 
    viewMode === "history" ? alerts : alerts.filter(isUnread)
  , [alerts, viewMode, token]);

  const sortedAlerts = useMemo(() => {
    const list = [...filteredAlerts];
    if (sortMode === "type") {
      const rank: any = { out: 0, low: 1, restock: 2 };
      return list.sort((a, b) => rank[a.type] - rank[b.type]);
    }
    return list;
  }, [filteredAlerts, sortMode]);

  const markOneAsRead = async (alertId: string) => {
    if (!token) return;
    try {
      await setDoc(doc(db, "alerts", alertId), {
        readBy: { [token]: true }, updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (e) { console.log(e); }
  };

  // UI Components
  const TabButton = ({ id, label }: { id: "alerts" | "activity", label: string }) => {
    const isActive = activeTab === id;
    
    // Contrast Fix: If the background (tint) is white, use black text.
    const isWhiteBackground = theme.tint.toLowerCase() === '#ffffff' || theme.tint.toLowerCase() === '#fff';
    const activeTextColor = isWhiteBackground ? '#000000' : '#ffffff';

    return (
      <Pressable
        onPress={() => setActiveTab(id)}
        style={{
          flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center",
          backgroundColor: isActive ? theme.tint : "transparent",
          borderWidth: 1, borderColor: isActive ? theme.tint : theme.border,
        }}
      >
        <Text style={{ 
          color: isActive ? activeTextColor : theme.text, 
          fontWeight: "900", 
          fontSize: 14,
          textTransform: 'uppercase',
          letterSpacing: 0.5
        }}>
          {label}
        </Text>
      </Pressable>
    );
  };

  const renderAlert = ({ item }: { item: AlertRow }) => (
    <Pressable onPress={() => viewMode === "unread" && markOneAsRead(item.id)} disabled={viewMode === "history"}>
      <View style={{ backgroundColor: theme.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.border, marginBottom: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, ...badgeStyleFor(item.type) }}>
            <Text style={{ color: "#000", fontWeight: "900", fontSize: 11 }}>{item.type.toUpperCase()}</Text>
          </View>
          {viewMode === "unread" && <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: BRAND.primary }} />}
          <Text style={{ color: theme.mutedText, fontSize: 11 }}>{formatDate(item.createdAt)}</Text>
        </View>
        <Text style={{ color: theme.text, fontWeight: "800", fontSize: 15 }}>{item.title}</Text>
        <Text style={{ color: theme.mutedText, marginTop: 4, fontSize: 13 }}>{item.body}</Text>
      </View>
    </Pressable>
  );

  const renderActivity = ({ item }: { item: ActivityLogRow }) => (
    <View style={{ backgroundColor: theme.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.border, marginBottom: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, ...badgeStyleFor(item.nextState) }}>
          <Text style={{ color: "#000", fontWeight: "900", fontSize: 11 }}>{item.nextState?.toUpperCase() || "LOG"}</Text>
        </View>
        <Text style={{ color: theme.mutedText, fontSize: 11 }}>{formatDate(item.createdAt)}</Text>
      </View>
      <Text style={{ color: theme.text, fontWeight: "800", fontSize: 15 }}>{item.itemName}</Text>
      <Text style={{ color: theme.mutedText, marginTop: 4, fontSize: 13 }}>
        Status changed from {item.prevState} to {item.nextState}
      </Text>
      <Text style={{ color: theme.mutedText, marginTop: 6, fontSize: 12 }}>
        Current Qty: {item.qty} • Min: {item.min}
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.background, padding: 16 }}>
      <Text style={{ color: theme.text, fontSize: 24, fontWeight: "900", marginBottom: 4 }}>Control Center</Text>
      <Text style={{ color: theme.mutedText, fontSize: 13, marginBottom: 16 }}>Site: {siteId ?? "Unassigned"}</Text>

      <View style={{ flexDirection: "row", gap: 10, marginBottom: 20 }}>
        <TabButton id="alerts" label="Alerts" />
        <TabButton id="activity" label="Activity" />
      </View>

      {activeTab === "alerts" && (
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
          {[
            { id: "unread", label: "Unread" },
            { id: "history", label: "History" }
          ].map((mode) => {
            const isActive = viewMode === mode.id;
            return (
              <Pressable 
                key={mode.id}
                onPress={() => setViewMode(mode.id as any)} 
                style={{ 
                  paddingHorizontal: 20, 
                  paddingVertical: 10, 
                  borderRadius: 25, 
                  backgroundColor: isActive ? theme.text : "transparent", 
                  borderWidth: 1, 
                  borderColor: isActive ? theme.text : theme.border 
                }}
              >
                <Text style={{ 
                  color: isActive ? theme.background : theme.text, 
                  fontWeight: "800", 
                  fontSize: 12 
                }}>
                  {mode.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : activeTab === "alerts" ? (
        <FlatList
          data={sortedAlerts}
          keyExtractor={(item) => item.id}
          renderItem={renderAlert}
          ListEmptyComponent={
            <View style={{ alignItems: "center", marginTop: 40 }}>
              <Text style={{ color: theme.text, fontWeight: "700" }}>No alerts found</Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={activityLogs}
          keyExtractor={(item) => item.id}
          renderItem={renderActivity}
          ListEmptyComponent={
            <View style={{ alignItems: "center", marginTop: 40 }}>
              <Text style={{ color: theme.text, fontWeight: "700" }}>No activity found</Text>
            </View>
          }
        />
      )}
    </View>
  );
}