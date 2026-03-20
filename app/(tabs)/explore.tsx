// app/(tabs)/explore.tsx — Vendor & Contact Directory
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
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
} from "firebase/firestore";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
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
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
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
});
