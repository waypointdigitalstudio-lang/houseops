// app/(tabs)/disposal.tsx
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
  // We pull 'uid' directly here since your hook provides it
  const { profile, siteId, uid, loading: profileLoading } = useUserProfile();

  const [disposals, setDisposals] = useState<DisposalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  // --- ADD RECORD: Manual disposal record modal state ---
  const [showAddModal, setShowAddModal] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addForm, setAddForm] = useState({
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

      Alert.alert(
        "Clear Records?",
        `Export complete. Delete all ${disposals.length} disposal record${disposals.length !== 1 ? "s" : ""} from this site?`,
        [
          { text: "Keep Records", style: "cancel" },
          {
            text: "Delete All",
            style: "destructive",
            onPress: async () => {
              try {
                const batch = writeBatch(db);
                disposals.forEach((d) => batch.delete(doc(db, "disposals", d.id)));
                await batch.commit();
              } catch (err: any) {
                Alert.alert("Error", err.message || "Failed to delete records.");
              }
            },
          },
        ]
      );

    } catch (error: any) {
      console.error('Export error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      Alert.alert('Export Failed', `Error: ${errorMessage}`);
    } finally {
      setExporting(false);
    }
  };

  // ── CSV Import helpers ──────────────────────────────────────────────────────

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

  const importDisposalsFromCSV = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "text/plain"],
      });
      if (result.canceled) return;

      setImporting(true);
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

      const iItem     = col(["item", "name", "description"]);
      const iModel    = col(["model"]);
      const iAmount   = col(["amount", "qty", "quantity"]);
      const iVendor   = col(["vendor", "supplier"]);
      const iTotal    = col(["multipleamount", "totalvalue", "total"]);
      const iApprox   = col(["approxamount", "approxprice", "unitprice"]);
      const iAge      = col(["approxage", "age"]);
      const iNotes    = col(["notes", "desc"]);

      if (iItem === -1) {
        Alert.alert("Import Failed", "Could not find an 'ITEM' or 'Name' column in the CSV.");
        return;
      }

      const headerItemVal = rows[0][iItem]?.toLowerCase() ?? "";
      const dataRows = rows.slice(1).filter((row) => {
        const cell = (row[iItem] ?? "").toLowerCase().trim();
        return cell !== "" && cell !== headerItemVal && !cell.startsWith("---");
      });

      const batch = writeBatch(db);
      let count = 0;

      for (const row of dataRows) {
        const name   = normalizeCell(row[iItem]   ?? "");
        const model  = normalizeCell(row[iModel]  ?? "");
        const vendor = normalizeCell(row[iVendor] ?? "");

        if (!name) continue;

        const stableId = `${name}_${model}_${vendor}`
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "_")
          .replace(/_+/g, "_")
          .slice(0, 100);

        const docRef = doc(db, "disposals", stableId);

        const data: Record<string, any> = {
          itemName:    name,
          model:       model,
          vendor:      vendor,
          quantity:    parseInt(normalizeCell(row[iAmount] ?? "")) || 1,
          approxValue: normalizeCell(row[iApprox] ?? ""),
          totalValue:  normalizeCell(row[iTotal]  ?? ""),
          approxAge:   normalizeCell(row[iAge]    ?? ""),
          notes:       normalizeCell(row[iNotes]  ?? ""),
          siteId:      siteId || "default",
          reason:      "obsolete" as DisposalReason,
          // FIX: Use 'uid' from hook and a generic name since profile doesn't have one
          disposedBy:  profile?.role === "admin" ? "Admin" : "Staff",
          disposedByUid: uid || "", 
          importedAt:  new Date().toISOString(),
          disposedAt:  new Date(),
        };

        batch.set(docRef, data, { merge: true });
        count++;
      }

      await batch.commit();
      Alert.alert(
        "Import Complete",
        `${count} disposal item${count !== 1 ? "s" : ""} imported/updated successfully.`
      );
    } catch (err: any) {
      console.error("Import error:", err);
      Alert.alert("Import Failed", err.message || "An unexpected error occurred.");
    } finally {
      setImporting(false);
    }
  };

  // ── Add Record helpers ───────────────────────────────────────────────────────

  const openAddModal = () => {
    setAddForm({
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
    setShowAddModal(true);
  };

  const saveManualDisposal = async () => {
    if (!addForm.itemName.trim()) {
      Alert.alert("Error", "Item name is required.");
      return;
    }
    if (!addForm.disposedBy.trim()) {
      Alert.alert("Error", "Please enter who is disposing this item.");
      return;
    }

    setAddSaving(true);

    try {
      await addDoc(collection(db, "disposals"), {
        itemId: "",
        itemName: addForm.itemName.trim(),
        model: addForm.model.trim(),
        quantity: parseInt(addForm.amount) || 1,
        vendor: addForm.vendor.trim(),
        approxValue: addForm.approxAmount.trim(),
        totalValue: addForm.multipleAmount.trim(),
        approxAge: addForm.approxAge.trim(),
        notes: addForm.description.trim(),
        disposedBy: addForm.disposedBy.trim(),
        disposedByUid: uid || "",
        siteId: siteId || "default",
        reason: "other" as DisposalReason,
        disposedAt: serverTimestamp(),
      });

      setShowAddModal(false);
      Alert.alert("Success", "Disposal record added successfully.");
    } catch (err: any) {
      console.error("Error adding disposal record:", err);
      Alert.alert("Error", "Failed to save disposal record. Please try again.");
    } finally {
      setAddSaving(false);
    }
  };

  // ── Delete All ──────────────────────────────────────────────────────────────

  const deleteAllDisposals = () => {
    if (disposals.length === 0) return;
    Alert.alert(
      "Delete All Records",
      `This will permanently delete all ${disposals.length} disposal record${disposals.length !== 1 ? "s" : ""} for this site. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete All",
          style: "destructive",
          onPress: async () => {
            try {
              const batch = writeBatch(db);
              disposals.forEach((d) => batch.delete(doc(db, "disposals", d.id)));
              await batch.commit();
              Alert.alert("Deleted", "All disposal records have been removed.");
            } catch (err: any) {
              Alert.alert("Error", err.message || "Failed to delete records.");
            }
          },
        },
      ]
    );
  };

  // ───────────────────────────────────────────────────────────────────────────

  const reasonColor = (reason: DisposalReason) => {
    switch (reason) {
      case "broken": return "#ef4444";
      case "damaged": return "#f97316";
      case "obsolete": return "#8b5cf6";
      case "lost": return "#ec4899";
      default: return "#6b7280";
    }
  };

  const reasonLabel = (reason: DisposalReason) => reason.toUpperCase();

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

        <View style={styles.headerButtons}>
          <Pressable
            style={[styles.exportButton, { backgroundColor: '#f97316' }]}
            onPress={openAddModal}
          >
            <Text style={styles.exportButtonText}>Add Record</Text>
          </Pressable>

          <Pressable
            style={[styles.exportButton, { backgroundColor: '#34C759' }, importing && styles.exportButtonDisabled]}
            onPress={importDisposalsFromCSV}
            disabled={importing}
          >
            {importing ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.exportButtonText}>Import CSV</Text>}
          </Pressable>

          {disposals.length > 0 && (
            <Pressable
              style={[styles.exportButton, { backgroundColor: '#007AFF' }, exporting && styles.exportButtonDisabled]}
              onPress={exportToCSV}
              disabled={exporting}
            >
              {exporting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.exportButtonText}>Export CSV</Text>}
            </Pressable>
          )}

          {disposals.length > 0 && (
            <Pressable
              style={[styles.exportButton, { backgroundColor: '#ef4444' }]}
              onPress={deleteAllDisposals}
            >
              <Text style={styles.exportButtonText}>Delete All</Text>
            </Pressable>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={{ color: theme.mutedText, marginTop: 10 }}>Loading disposal records…</Text>
        </View>
      ) : disposals.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: theme.text }]}>No disposed items yet</Text>
          <Text style={[styles.emptySubtext, { color: theme.mutedText }]}>Disposed items will appear here for tracking</Text>
        </View>
      ) : (
        <FlatList
          data={disposals}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: 20 }}
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={styles.cardHeader}>
                <Text style={[styles.itemName, { color: theme.text }]}>{item.itemName}</Text>
                <View style={[styles.badge, { backgroundColor: reasonColor(item.reason) }]}>
                  <Text style={styles.badgeText}>{reasonLabel(item.reason)}</Text>
                </View>
              </View>
              {item.notes ? <Text style={[styles.notes, { color: theme.mutedText }]}>{item.notes}</Text> : null}
              <View style={styles.meta}>
                <Text style={[styles.metaText, { color: theme.mutedText }]}>Qty: {item.quantity}</Text>
                <Text style={[styles.metaText, { color: theme.mutedText }]}>•</Text>
                <Text style={[styles.metaText, { color: theme.mutedText }]}>By: {item.disposedBy}</Text>
              </View>
              <Text style={[styles.date, { color: theme.mutedText }]}>{formatDate(item.disposedAt)}</Text>
            </View>
          )}
        />
      )}
      {/* ADD RECORD: Manual Disposal Record Modal */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (!addSaving) setShowAddModal(false); }}>
        <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Add Disposal Record</Text>
            <Pressable onPress={() => { if (!addSaving) setShowAddModal(false); }}>
              <Text style={{ color: theme.tint, fontSize: 16, fontWeight: "700" }}>Cancel</Text>
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Item Name */}
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Item *</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="Item name"
              placeholderTextColor={theme.mutedText}
              value={addForm.itemName}
              onChangeText={(v) => setAddForm((p) => ({ ...p, itemName: v }))}
            />

            {/* Model */}
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Model</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="e.g. HP LaserJet Pro"
              placeholderTextColor={theme.mutedText}
              value={addForm.model}
              onChangeText={(v) => setAddForm((p) => ({ ...p, model: v }))}
            />

            {/* Amount and Approx Amount Row */}
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Amount</Text>
                <TextInput
                  style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                  keyboardType="numeric"
                  placeholder="Qty"
                  placeholderTextColor={theme.mutedText}
                  value={addForm.amount}
                  onChangeText={(v) => setAddForm((p) => ({ ...p, amount: v }))}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Approx Amount ($)</Text>
                <TextInput
                  style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                  keyboardType="numeric"
                  placeholder="Unit value"
                  placeholderTextColor={theme.mutedText}
                  value={addForm.approxAmount}
                  onChangeText={(v) => setAddForm((p) => ({ ...p, approxAmount: v }))}
                />
              </View>
            </View>

            {/* Vendor */}
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Vendor</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="e.g. Amazon, Staples"
              placeholderTextColor={theme.mutedText}
              value={addForm.vendor}
              onChangeText={(v) => setAddForm((p) => ({ ...p, vendor: v }))}
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
                  value={addForm.multipleAmount}
                  onChangeText={(v) => setAddForm((p) => ({ ...p, multipleAmount: v }))}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Approx Age</Text>
                <TextInput
                  style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                  placeholder="e.g. 2 years"
                  placeholderTextColor={theme.mutedText}
                  value={addForm.approxAge}
                  onChangeText={(v) => setAddForm((p) => ({ ...p, approxAge: v }))}
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
              value={addForm.description}
              onChangeText={(v) => setAddForm((p) => ({ ...p, description: v }))}
            />

            {/* Who is disposing it */}
            <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Who is disposing it? *</Text>
            <TextInput
              style={[styles.fieldInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="Your name"
              placeholderTextColor={theme.mutedText}
              value={addForm.disposedBy}
              onChangeText={(v) => setAddForm((p) => ({ ...p, disposedBy: v }))}
            />

            {/* Save Button */}
            <Pressable
              style={[styles.saveBtn, { backgroundColor: "#f97316", opacity: addSaving ? 0.6 : 1 }]}
              onPress={saveManualDisposal}
              disabled={addSaving}
            >
              {addSaving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.saveBtnText}>Save Record</Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  headerText: { flex: 1 },
  title: { fontSize: 22, fontWeight: "800" },
  subtitle: { fontSize: 13, marginTop: 6 },
  headerButtons: { flexDirection: 'column', gap: 8, marginLeft: 12 },
  exportButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, minWidth: 110, alignItems: 'center', justifyContent: 'center' },
  exportButtonDisabled: { opacity: 0.6 },
  exportButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyText: { fontSize: 18, fontWeight: "800" },
  emptySubtext: { fontSize: 14, marginTop: 8, textAlign: "center" },
  card: { borderRadius: 14, padding: 14, marginTop: 12, borderWidth: 1 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  itemName: { fontSize: 16, fontWeight: "800", flex: 1 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "900" },
  notes: { fontSize: 13, marginTop: 8 },
  meta: { flexDirection: "row", gap: 8, marginTop: 8 },
  metaText: { fontSize: 12 },
  date: { fontSize: 11, marginTop: 6 },
  modalContainer: { flex: 1, padding: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: "800" },
  fieldLabel: { fontSize: 13, fontWeight: "600", marginBottom: 6, marginTop: 14 },
  fieldInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  saveBtn: { marginTop: 24, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginBottom: 20 },
  saveBtnText: { color: "#ffffff", fontSize: 16, fontWeight: "800" },
});