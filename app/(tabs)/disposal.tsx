// app/(tabs)/disposal.tsx
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";

import { useAppTheme } from "../../constants/theme";
import { db } from "../../firebaseConfig";
import { useUserProfile } from "../../hooks/useUserProfile";

type DisposalReason = "broken" | "obsolete" | "lost" | "damaged" | "other";

type DisposalRecord = {
  id: string;
  itemId: string;
  itemName: string;
  siteId: string;
  reason: DisposalReason;
  notes?: string;
  disposedBy: string;
  disposedByUid: string;
  disposedAt: any;
  quantity: number;
};

export default function DisposalScreen() {
  const theme = useAppTheme();
  const { profile, siteId, loading: profileLoading } = useUserProfile();

  const [disposals, setDisposals] = useState<DisposalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (profileLoading) return;

    if (!siteId) {
      setDisposals([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, "disposals"),
      where("siteId", "==", siteId),
      orderBy("disposedAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: DisposalRecord[] = snap.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            itemId: data.itemId || "",
            itemName: data.itemName || "Unknown item",
            siteId: data.siteId || "",
            reason: data.reason || "other",
            notes: data.notes || "",
            disposedBy: data.disposedBy || "Unknown",
            disposedByUid: data.disposedByUid || "",
            disposedAt: data.disposedAt,
            quantity: data.quantity || 1,
          };
        });
        setDisposals(list);
        setLoading(false);
      },
      (err) => {
        console.error("Disposal records error:", err);
        setDisposals([]);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [siteId, profileLoading]);

  const formatDate = (timestamp: any) => {
    if (!timestamp || !timestamp.toDate) return "";
    const date = timestamp.toDate();
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDateForCSV = (timestamp: any) => {
    if (!timestamp || !timestamp.toDate) return "";
    const date = timestamp.toDate();
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const escapeCSV = (value: string) => {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const generateCSV = () => {
    const headers = [
      'Item Name',
      'Item ID',
      'Quantity',
      'Site',
      'Reason',
      'Notes',
      'Disposed By',
      'Disposal Date'
    ];

    const rows = disposals.map(disposal => [
      escapeCSV(disposal.itemName),
      escapeCSV(disposal.itemId),
      disposal.quantity.toString(),
      escapeCSV(disposal.siteId),
      escapeCSV(disposal.reason),
      escapeCSV(disposal.notes || ''),
      escapeCSV(disposal.disposedBy),
      escapeCSV(formatDateForCSV(disposal.disposedAt))
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    return csvContent;
  };

  const exportToCSV = async () => {
    if (disposals.length === 0) {
      Alert.alert('No Data', 'There are no disposal records to export.');
      return;
    }

    setExporting(true);

    try {
      const csv = generateCSV();
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `Disposal_${siteId}_${timestamp}.csv`;

      const dir = FileSystem.documentDirectory as string;
      const fileUri = dir + filename;

      await FileSystem.writeAsStringAsync(fileUri, csv, {
        encoding: 'utf8',
      });

      await Sharing.shareAsync(fileUri, {
        mimeType: 'text/csv',
        dialogTitle: `Disposal Records - ${siteId}`,
        UTI: 'public.comma-separated-values-text', // iOS
      });

    } catch (error: any) {
      console.error('Export error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      Alert.alert('Export Failed', `Error: ${errorMessage}`);
    } finally {
      setExporting(false);
    }
  };

  const reasonColor = (reason: DisposalReason) => {
    switch (reason) {
      case "broken":
        return "#ef4444";
      case "damaged":
        return "#f97316";
      case "obsolete":
        return "#8b5cf6";
      case "lost":
        return "#ec4899";
      default:
        return "#6b7280";
    }
  };

  const reasonLabel = (reason: DisposalReason) => {
    return reason.toUpperCase();
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.text }]}>Asset Disposal</Text>
          <Text style={[styles.subtitle, { color: theme.mutedText }]}>
            Site: {siteId || "Unassigned"}
          </Text>
          <Text style={[styles.subtitle, { color: theme.mutedText }]}>
            Disposed items for audit and tracking
          </Text>
        </View>

        {disposals.length > 0 && (
          <Pressable
            style={[
              styles.exportButton,
              { backgroundColor: '#007AFF' },
              exporting && styles.exportButtonDisabled
            ]}
            onPress={exportToCSV}
            disabled={exporting}
          >
            {exporting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.exportButtonText}>Export CSV</Text>
            )}
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={{ color: theme.mutedText, marginTop: 10 }}>
            Loading disposal records…
          </Text>
        </View>
      ) : disposals.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: theme.text }]}>
            No disposed items yet
          </Text>
          <Text style={[styles.emptySubtext, { color: theme.mutedText }]}>
            Disposed items will appear here for tracking
          </Text>
        </View>
      ) : (
        <FlatList
          data={disposals}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: 20 }}
          renderItem={({ item }) => (
            <View
              style={[
                styles.card,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.border,
                },
              ]}
            >
              <View style={styles.cardHeader}>
                <Text style={[styles.itemName, { color: theme.text }]}>
                  {item.itemName}
                </Text>
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: reasonColor(item.reason) },
                  ]}
                >
                  <Text style={styles.badgeText}>
                    {reasonLabel(item.reason)}
                  </Text>
                </View>
              </View>

              {item.notes ? (
                <Text style={[styles.notes, { color: theme.mutedText }]}>
                  {item.notes}
                </Text>
              ) : null}

              <View style={styles.meta}>
                <Text style={[styles.metaText, { color: theme.mutedText }]}>
                  Qty: {item.quantity}
                </Text>
                <Text style={[styles.metaText, { color: theme.mutedText }]}>
                  •
                </Text>
                <Text style={[styles.metaText, { color: theme.mutedText }]}>
                  By: {item.disposedBy}
                </Text>
              </View>

              <Text style={[styles.date, { color: theme.mutedText }]}>
                {formatDate(item.disposedAt)}
              </Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
  },
  subtitle: {
    fontSize: 13,
    marginTop: 6,
  },
  exportButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    marginLeft: 12,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportButtonDisabled: {
    opacity: 0.6,
  },
  exportButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "800",
  },
  emptySubtext: {
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
  },
  card: {
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  itemName: {
    fontSize: 16,
    fontWeight: "800",
    flex: 1,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "900",
  },
  notes: {
    fontSize: 13,
    marginTop: 8,
  },
  meta: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  metaText: {
    fontSize: 12,
  },
  date: {
    fontSize: 11,
    marginTop: 6,
  },
});