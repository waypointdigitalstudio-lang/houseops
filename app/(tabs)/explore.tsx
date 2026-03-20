// app/(tabs)/explore.tsx — Vendor & Contact Directory
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAppTheme } from "../../constants/theme";
import { db } from "../../firebaseConfig";
import { useUserProfile } from "../../hooks/useUserProfile";

const CATEGORIES = ["Vendor", "IT Support", "Maintenance", "Facilities", "Other"];

type Contact = {
  id: string;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  category?: string;
  notes?: string;
  siteId: string;
};

const emptyForm = {
  name: "",
  company: "",
  phone: "",
  email: "",
  category: "Vendor",
  notes: "",
};

export default function DirectoryScreen() {
  const theme = useAppTheme();
  const { profile, siteId } = useUserProfile();
  const role = profile?.role ?? "staff";

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [importingContacts, setImportingContacts] = useState(false);

  // Real-time listener
  useEffect(() => {
    if (!siteId) return;
    const q = query(
      collection(db, "contacts"),
      where("siteId", "==", siteId),
      orderBy("name", "asc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setContacts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Contact)));
    });
    return unsub;
  }, [siteId]);

  const filtered = useMemo(() => {
    let list = contacts;
    if (selectedCategory) list = list.filter((c) => c.category === selectedCategory);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(s) ||
          c.company?.toLowerCase().includes(s) ||
          c.phone?.includes(s) ||
          c.email?.toLowerCase().includes(s)
      );
    }
    return list;
  }, [contacts, search, selectedCategory]);

  const openAdd = useCallback(() => {
    setEditingContact(null);
    setForm({ ...emptyForm });
    setShowModal(true);
  }, []);

  const openEdit = useCallback((contact: Contact) => {
    setEditingContact(contact);
    setForm({
      name: contact.name,
      company: contact.company ?? "",
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      category: contact.category ?? "Vendor",
      notes: contact.notes ?? "",
    });
    setShowModal(true);
  }, []);

  const saveContact = useCallback(async () => {
    if (!form.name.trim()) {
      Alert.alert("Error", "Name is required.");
      return;
    }
    setSaving(true);
    try {
      const data = {
        name: form.name.trim(),
        company: form.company.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        category: form.category,
        notes: form.notes.trim(),
        siteId: siteId || "default",
      };
      if (editingContact) {
        await updateDoc(doc(db, "contacts", editingContact.id), data);
      } else {
        await addDoc(collection(db, "contacts"), { ...data, createdAt: serverTimestamp() });
      }
      setShowModal(false);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to save contact.");
    } finally {
      setSaving(false);
    }
  }, [form, editingContact, siteId]);

  const deleteContact = useCallback((contact: Contact) => {
    Alert.alert(
      "Delete Contact",
      `Remove ${contact.name} from the directory?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteDoc(doc(db, "contacts", contact.id));
            } catch (err: any) {
              Alert.alert("Error", err.message || "Failed to delete contact.");
            }
          },
        },
      ]
    );
  }, []);

  const call = (phone: string) => Linking.openURL(`tel:${phone}`);
  const email = (addr: string) => Linking.openURL(`mailto:${addr}`);

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

  const importContactsFromCSV = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "text/plain"],
      });
      if (result.canceled) return;

      setImportingContacts(true);
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const rows = parseCSV(content);

      if (rows.length < 2) { Alert.alert("Empty File", "No data rows found in the CSV."); return; }

      const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, ""));
      const col = (names: string[]) => {
        for (const n of names) { const idx = headers.findIndex((h) => h.includes(n)); if (idx !== -1) return idx; }
        return -1;
      };

      const iName     = col(["name", "contact", "fullname"]);
      const iCompany  = col(["company", "organization", "org", "business"]);
      const iPhone    = col(["phone", "tel", "mobile", "cell"]);
      const iEmail    = col(["email", "mail"]);
      const iCategory = col(["category", "type", "cat"]);
      const iNotes    = col(["notes", "note"]);

      if (iName === -1) { Alert.alert("Import Failed", "Could not find a 'Name' or 'Contact' column."); return; }

      const VALID_CATS = ["Vendor", "IT Support", "Maintenance", "Facilities", "Other"];
      const dataRows = rows.slice(1).filter((row) => normalizeCell(row[iName] ?? "") !== "");
      const batch = writeBatch(db);
      let count = 0;

      for (const row of dataRows) {
        const name = normalizeCell(row[iName] ?? "");
        if (!name) continue;
        const rawCat = normalizeCell(row[iCategory] ?? "Other");
        const category = VALID_CATS.find((c) => c.toLowerCase() === rawCat.toLowerCase()) || "Other";
        const stableId = `${siteId}_${name}`
          .toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 100);
        const docRef = doc(db, "contacts", stableId);
        batch.set(docRef, {
          name,
          company:  normalizeCell(row[iCompany] ?? ""),
          phone:    normalizeCell(row[iPhone] ?? ""),
          email:    normalizeCell(row[iEmail] ?? ""),
          category,
          notes:    normalizeCell(row[iNotes] ?? ""),
          siteId:   siteId || "default",
          importedAt: new Date().toISOString(),
        }, { merge: true });
        count++;
      }

      await batch.commit();
      Alert.alert("Import Complete", `${count} contact${count !== 1 ? "s" : ""} imported/updated.`);
    } catch (err: any) {
      console.error("Contact import error:", err);
      Alert.alert("Import Failed", err.message || "An unexpected error occurred.");
    } finally {
      setImportingContacts(false);
    }
  }, [siteId]);

  const exportContactsToCSV = useCallback(async () => {
    try {
      if (contacts.length === 0) { Alert.alert("Nothing to export", "No contacts to export."); return; }
      const header = "Name,Company,Phone,Email,Category,Notes";
      const rows = contacts.map((c) =>
        [c.name, c.company ?? "", c.phone ?? "", c.email ?? "", c.category ?? "", c.notes ?? ""]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
      );
      const csv = [header, ...rows].join("\n");
      const uri = FileSystem.cacheDirectory + "contacts_export.csv";
      await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Export Contacts CSV" });
    } catch (err: any) {
      Alert.alert("Export Failed", err.message || "An unexpected error occurred.");
    }
  }, [contacts]);

  const renderContact = ({ item }: { item: Contact }) => (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Pressable onPress={() => openEdit(item)} style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
          <Text style={[styles.name, { color: theme.text }]}>{item.name}</Text>
          {item.category ? (
            <View style={[styles.badge, { backgroundColor: theme.tint + "22" }]}>
              <Text style={{ color: theme.tint, fontSize: 10, fontWeight: "700" }}>{item.category}</Text>
            </View>
          ) : null}
        </View>
        {item.company ? (
          <Text style={{ color: theme.mutedText, fontSize: 13, marginBottom: 2 }}>{item.company}</Text>
        ) : null}
        {item.notes ? (
          <Text style={{ color: theme.mutedText, fontSize: 11, fontStyle: "italic" }} numberOfLines={1}>
            {item.notes}
          </Text>
        ) : null}
      </Pressable>

      <View style={{ alignItems: "flex-end", gap: 8 }}>
        {item.phone ? (
          <Pressable onPress={() => call(item.phone!)} hitSlop={8}>
            <Ionicons name="call-outline" size={20} color={theme.tint} />
          </Pressable>
        ) : null}
        {item.email ? (
          <Pressable onPress={() => email(item.email!)} hitSlop={8}>
            <Ionicons name="mail-outline" size={20} color={theme.tint} />
          </Pressable>
        ) : null}
        <Pressable onPress={() => deleteContact(item)} hitSlop={8}>
          <Ionicons name="trash-outline" size={18} color="#ef4444" />
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Search + Add */}
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 8 }}>
        <TextInput
          style={[styles.search, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, flex: 1 }]}
          placeholder="Search directory..."
          placeholderTextColor={theme.mutedText}
          value={search}
          onChangeText={setSearch}
        />
        <Pressable
          onPress={openAdd}
          style={[styles.addBtn, { backgroundColor: theme.card, borderColor: theme.border }]}
        >
          <Ionicons name="add" size={22} color={theme.text} />
        </Pressable>
      </View>
      {/* Import / Export */}
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
        <Pressable
          onPress={importContactsFromCSV}
          disabled={importingContacts}
          style={[styles.csvBtn, { backgroundColor: theme.card, borderColor: theme.border, flex: 1 }]}
        >
          {importingContacts
            ? <ActivityIndicator size="small" color={theme.text} />
            : <><Ionicons name="cloud-upload-outline" size={15} color={theme.text} style={{ marginRight: 5 }} /><Text style={[styles.csvBtnText, { color: theme.text }]}>Import CSV</Text></>
          }
        </Pressable>
        <Pressable
          onPress={exportContactsToCSV}
          style={[styles.csvBtn, { backgroundColor: theme.card, borderColor: theme.border, flex: 1 }]}
        >
          <Ionicons name="cloud-download-outline" size={15} color={theme.text} style={{ marginRight: 5 }} />
          <Text style={[styles.csvBtnText, { color: theme.text }]}>Export CSV</Text>
        </Pressable>
      </View>

      {/* Category filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        <Pressable
          onPress={() => setSelectedCategory(null)}
          style={[styles.chip, { backgroundColor: !selectedCategory ? theme.tint : theme.card, borderColor: theme.border }]}
        >
          <Text style={{ color: !selectedCategory ? "#000" : theme.mutedText, fontWeight: "700", fontSize: 12 }}>All</Text>
        </Pressable>
        {CATEGORIES.map((cat) => (
          <Pressable
            key={cat}
            onPress={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
            style={[styles.chip, { backgroundColor: selectedCategory === cat ? theme.tint : theme.card, borderColor: theme.border, marginLeft: 8 }]}
          >
            <Text style={{ color: selectedCategory === cat ? "#000" : theme.mutedText, fontWeight: "700", fontSize: 12 }}>{cat}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <FlatList
        data={filtered}
        keyExtractor={(c) => c.id}
        renderItem={renderContact}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListEmptyComponent={
          <Text style={{ color: theme.mutedText, textAlign: "center", marginTop: 40 }}>
            {search || selectedCategory ? "No contacts match." : "No contacts yet. Tap + to add one."}
          </Text>
        }
      />

      {/* Add / Edit Modal */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowModal(false)}>
        <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>
              {editingContact ? "Edit Contact" : "Add Contact"}
            </Text>
            <Pressable onPress={() => setShowModal(false)}>
              <Ionicons name="close" size={24} color={theme.text} />
            </Pressable>
          </View>

          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            <Text style={[styles.label, { color: theme.mutedText }]}>Name *</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="Full name"
              placeholderTextColor={theme.mutedText}
              value={form.name}
              onChangeText={(v) => setForm((p) => ({ ...p, name: v }))}
            />

            <Text style={[styles.label, { color: theme.mutedText }]}>Company</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="Company or organization"
              placeholderTextColor={theme.mutedText}
              value={form.company}
              onChangeText={(v) => setForm((p) => ({ ...p, company: v }))}
            />

            <Text style={[styles.label, { color: theme.mutedText }]}>Phone</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="Phone number"
              placeholderTextColor={theme.mutedText}
              keyboardType="phone-pad"
              value={form.phone}
              onChangeText={(v) => setForm((p) => ({ ...p, phone: v }))}
            />

            <Text style={[styles.label, { color: theme.mutedText }]}>Email</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
              placeholder="Email address"
              placeholderTextColor={theme.mutedText}
              keyboardType="email-address"
              autoCapitalize="none"
              value={form.email}
              onChangeText={(v) => setForm((p) => ({ ...p, email: v }))}
            />

            <Text style={[styles.label, { color: theme.mutedText }]}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              {CATEGORIES.map((cat) => (
                <Pressable
                  key={cat}
                  onPress={() => setForm((p) => ({ ...p, category: cat }))}
                  style={[styles.chip, { backgroundColor: form.category === cat ? theme.tint : theme.card, borderColor: theme.border, marginRight: 8 }]}
                >
                  <Text style={{ color: form.category === cat ? "#000" : theme.mutedText, fontWeight: "700", fontSize: 12 }}>{cat}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={[styles.label, { color: theme.mutedText }]}>Notes</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, height: 80, textAlignVertical: "top" }]}
              placeholder="Any additional notes..."
              placeholderTextColor={theme.mutedText}
              multiline
              value={form.notes}
              onChangeText={(v) => setForm((p) => ({ ...p, notes: v }))}
            />

            <Pressable
              onPress={saveContact}
              disabled={saving}
              style={[styles.saveBtn, { backgroundColor: theme.tint, opacity: saving ? 0.6 : 1 }]}
            >
              <Text style={{ color: "#000", fontWeight: "800", fontSize: 16 }}>
                {saving ? "Saving…" : editingContact ? "Save Changes" : "Add Contact"}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, paddingTop: 16 },
  search: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14 },
  addBtn: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, justifyContent: "center", alignItems: "center" },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  card: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  name: { fontWeight: "700", fontSize: 15, marginRight: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  modalContainer: { flex: 1, padding: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: "800" },
  label: { fontSize: 12, fontWeight: "600", marginBottom: 6, textTransform: "uppercase" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, marginBottom: 16 },
  saveBtn: { borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 8, marginBottom: 40 },
  csvBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  csvBtnText: { fontSize: 13, fontWeight: "600" },
});
