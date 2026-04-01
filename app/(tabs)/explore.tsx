// app/(tabs)/explore.tsx — Directory (Contacts + Vendors)
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

// ─── Types ───────────────────────────────────────────────────────────────────

type Contact = {
  id: string;
  name: string;
  company?: string;
  phone?: string;
  phone2?: string;
  email?: string;
  category?: string;
  notes?: string;
  siteId: string;
};

type Vendor = {
  id: string;
  company: string;
  contactName?: string;
  phone?: string;
  email?: string;
  website?: string;
  accountNumber?: string;
  serviceType?: string;
  notes?: string;
  siteId: string;
};

const emptyContactForm = {
  name: "", company: "", phone: "", phone2: "", email: "", category: "IT Support", notes: "",
};

const emptyVendorForm = {
  company: "", contactName: "", phone: "", email: "", website: "", accountNumber: "", serviceType: "", notes: "",
};

type LincolnTech = {
  id: string;
  name: string;
  title?: string;
  phone?: string;
  email?: string;
  notes?: string;
  siteId: string;
};

const emptyLincolnForm = {
  name: "", title: "", phone: "", email: "", notes: "",
};

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function DirectoryScreen() {
  const theme = useAppTheme();
  const { profile, siteId } = useUserProfile();
  const role = profile?.role ?? "staff";

  const [tab, setTab] = useState<"contacts" | "vendors" | "lincoln">("contacts");

  const techTabLabel =
    siteId === "ballys_tiverton" ? "Lincoln Tech" :
    siteId === "ballys_lincoln"  ? "Tiverton Tech" :
    "Tech Contacts";

  // ── Contacts state ──────────────────────────────────────────────────────
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showContactModal, setShowContactModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [contactForm, setContactForm] = useState({ ...emptyContactForm });
  const [savingContact, setSavingContact] = useState(false);
  const [importingContacts, setImportingContacts] = useState(false);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  // ── Vendors state ───────────────────────────────────────────────────────
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorSearch, setVendorSearch] = useState("");
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [vendorForm, setVendorForm] = useState({ ...emptyVendorForm });
  const [savingVendor, setSavingVendor] = useState(false);
  const [importingVendors, setImportingVendors] = useState(false);

  // ── Lincoln Techs state ─────────────────────────────────────────────────
  const [lincolnTechs, setLincolnTechs] = useState<LincolnTech[]>([]);
  const [lincolnSearch, setLincolnSearch] = useState("");
  const [showLincolnModal, setShowLincolnModal] = useState(false);
  const [editingLincoln, setEditingLincoln] = useState<LincolnTech | null>(null);
  const [lincolnForm, setLincolnForm] = useState({ ...emptyLincolnForm });
  const [savingLincoln, setSavingLincoln] = useState(false);

  // ── Listeners ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!siteId) return;
    const unsub = onSnapshot(
      query(collection(db, "contacts"), where("siteId", "==", siteId)),
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Contact));
        docs.sort((a, b) => a.name.localeCompare(b.name));
        setContacts(docs);
      },
      (err) => console.error("Contacts listener error:", err)
    );
    return unsub;
  }, [siteId]);

  useEffect(() => {
    if (!siteId) return;
    const unsub = onSnapshot(
      query(collection(db, "vendors"), where("siteId", "==", siteId)),
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Vendor));
        docs.sort((a, b) => a.company.localeCompare(b.company));
        setVendors(docs);
      },
      (err) => console.error("Vendors listener error:", err)
    );
    return unsub;
  }, [siteId]);

  useEffect(() => {
    if (!siteId) return;
    const unsub = onSnapshot(
      query(collection(db, "lincolnTechs"), where("siteId", "==", siteId)),
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as LincolnTech));
        docs.sort((a, b) => a.name.localeCompare(b.name));
        setLincolnTechs(docs);
      },
      (err) => console.error("LincolnTechs listener error:", err)
    );
    return unsub;
  }, [siteId]);

  // ── Contacts helpers ─────────────────────────────────────────────────────
  const activeCategories = useMemo(() => {
    const cats = new Set(contacts.map((c) => c.category).filter(Boolean) as string[]);
    return Array.from(cats).sort();
  }, [contacts]);

  const filteredContacts = useMemo(() => {
    let list = contacts;
    if (selectedCategory) list = list.filter((c) => c.category === selectedCategory);
    if (contactSearch.trim()) {
      const s = contactSearch.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(s) ||
          c.company?.toLowerCase().includes(s) ||
          c.phone?.includes(s) ||
          c.email?.toLowerCase().includes(s)
      );
    }
    return list;
  }, [contacts, contactSearch, selectedCategory]);

  const openAddContact = useCallback(() => {
    setEditingContact(null);
    setContactForm({ ...emptyContactForm });
    setShowContactModal(true);
  }, []);

  const openEditContact = useCallback((contact: Contact) => {
    setEditingContact(contact);
    setContactForm({
      name: contact.name,
      company: contact.company ?? "",
      phone: contact.phone ?? "",
      phone2: contact.phone2 ?? "",
      email: contact.email ?? "",
      category: contact.category ?? "IT Support",
      notes: contact.notes ?? "",
    });
    setShowContactModal(true);
  }, []);

  const saveContact = useCallback(async () => {
    if (!contactForm.name.trim()) { Alert.alert("Error", "Name is required."); return; }
    setSavingContact(true);
    try {
      const data = {
        name: contactForm.name.trim(),
        company: contactForm.company.trim(),
        phone: contactForm.phone.trim(),
        phone2: contactForm.phone2.trim(),
        email: contactForm.email.trim(),
        category: contactForm.category,
        notes: contactForm.notes.trim(),
        siteId: siteId || "default",
      };
      if (editingContact) {
        await updateDoc(doc(db, "contacts", editingContact.id), data);
      } else {
        await addDoc(collection(db, "contacts"), { ...data, createdAt: serverTimestamp() });
      }
      setShowContactModal(false);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to save contact.");
    } finally {
      setSavingContact(false);
    }
  }, [contactForm, editingContact, siteId]);

  const deleteContact = useCallback((contact: Contact) => {
    Alert.alert("Delete Contact", `Remove ${contact.name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await deleteDoc(doc(db, "contacts", contact.id)); }
        catch (err: any) { Alert.alert("Error", err.message); }
      }},
    ]);
  }, []);

  // ── Vendors helpers ──────────────────────────────────────────────────────
  const filteredVendors = useMemo(() => {
    if (!vendorSearch.trim()) return vendors;
    const s = vendorSearch.toLowerCase();
    return vendors.filter(
      (v) =>
        v.company.toLowerCase().includes(s) ||
        v.contactName?.toLowerCase().includes(s) ||
        v.serviceType?.toLowerCase().includes(s) ||
        v.phone?.includes(s) ||
        v.email?.toLowerCase().includes(s)
    );
  }, [vendors, vendorSearch]);

  const openAddVendor = useCallback(() => {
    setEditingVendor(null);
    setVendorForm({ ...emptyVendorForm });
    setShowVendorModal(true);
  }, []);

  const openEditVendor = useCallback((vendor: Vendor) => {
    setEditingVendor(vendor);
    setVendorForm({
      company: vendor.company,
      contactName: vendor.contactName ?? "",
      phone: vendor.phone ?? "",
      email: vendor.email ?? "",
      website: vendor.website ?? "",
      accountNumber: vendor.accountNumber ?? "",
      serviceType: vendor.serviceType ?? "",
      notes: vendor.notes ?? "",
    });
    setShowVendorModal(true);
  }, []);

  const saveVendor = useCallback(async () => {
    if (!vendorForm.company.trim()) { Alert.alert("Error", "Company name is required."); return; }
    setSavingVendor(true);
    try {
      const data = {
        company: vendorForm.company.trim(),
        contactName: vendorForm.contactName.trim(),
        phone: vendorForm.phone.trim(),
        email: vendorForm.email.trim(),
        website: vendorForm.website.trim(),
        accountNumber: vendorForm.accountNumber.trim(),
        serviceType: vendorForm.serviceType.trim(),
        notes: vendorForm.notes.trim(),
        siteId: siteId || "default",
      };
      if (editingVendor) {
        await updateDoc(doc(db, "vendors", editingVendor.id), data);
      } else {
        await addDoc(collection(db, "vendors"), { ...data, createdAt: serverTimestamp() });
      }
      setShowVendorModal(false);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to save vendor.");
    } finally {
      setSavingVendor(false);
    }
  }, [vendorForm, editingVendor, siteId]);

  const deleteVendor = useCallback((vendor: Vendor) => {
    Alert.alert("Delete Vendor", `Remove ${vendor.company}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await deleteDoc(doc(db, "vendors", vendor.id)); }
        catch (err: any) { Alert.alert("Error", err.message); }
      }},
    ]);
  }, []);

  // ── Lincoln Techs helpers ────────────────────────────────────────────────
  const filteredLincolnTechs = useMemo(() => {
    if (!lincolnSearch.trim()) return lincolnTechs;
    const s = lincolnSearch.toLowerCase();
    return lincolnTechs.filter(
      (lt) =>
        lt.name.toLowerCase().includes(s) ||
        lt.title?.toLowerCase().includes(s) ||
        lt.phone?.includes(s) ||
        lt.email?.toLowerCase().includes(s)
    );
  }, [lincolnTechs, lincolnSearch]);

  const openAddLincoln = useCallback(() => {
    setEditingLincoln(null);
    setLincolnForm({ ...emptyLincolnForm });
    setShowLincolnModal(true);
  }, []);

  const openEditLincoln = useCallback((lt: LincolnTech) => {
    setEditingLincoln(lt);
    setLincolnForm({
      name: lt.name,
      title: lt.title ?? "",
      phone: lt.phone ?? "",
      email: lt.email ?? "",
      notes: lt.notes ?? "",
    });
    setShowLincolnModal(true);
  }, []);

  const saveLincoln = useCallback(async () => {
    if (!lincolnForm.name.trim()) { Alert.alert("Error", "Name is required."); return; }
    setSavingLincoln(true);
    try {
      const data = {
        name: lincolnForm.name.trim(),
        title: lincolnForm.title.trim(),
        phone: lincolnForm.phone.trim(),
        email: lincolnForm.email.trim(),
        notes: lincolnForm.notes.trim(),
        siteId: siteId || "default",
      };
      if (editingLincoln) {
        await updateDoc(doc(db, "lincolnTechs", editingLincoln.id), data);
      } else {
        await addDoc(collection(db, "lincolnTechs"), { ...data, createdAt: serverTimestamp() });
      }
      setShowLincolnModal(false);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to save.");
    } finally {
      setSavingLincoln(false);
    }
  }, [lincolnForm, editingLincoln, siteId]);

  const deleteLincoln = useCallback((lt: LincolnTech) => {
    Alert.alert("Delete", `Remove ${lt.name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await deleteDoc(doc(db, "lincolnTechs", lt.id)); }
        catch (err: any) { Alert.alert("Error", err.message); }
      }},
    ]);
  }, []);

  // ── CSV helpers ──────────────────────────────────────────────────────────
  const call  = useCallback((phone: string) => Linking.openURL(`tel:${phone}`), []);
  const email = useCallback((addr: string)  => Linking.openURL(`mailto:${addr}`), []);
  const web   = useCallback((url: string)   => Linking.openURL(url.startsWith("http") ? url : `https://${url}`), []);

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
      const result = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "text/plain"] });
      if (result.canceled) return;
      setImportingContacts(true);
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const rows = parseCSV(content);
      if (rows.length < 2) { Alert.alert("Empty File", "No data rows found."); return; }

      const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, ""));
      const col = (names: string[]) => {
        for (const n of names) { const idx = headers.findIndex((h) => h.includes(n)); if (idx !== -1) return idx; }
        return -1;
      };
      const iName     = col(["name", "contact", "fullname"]);
      const iCompany  = col(["company", "organization", "org", "business", "department", "dept"]);
      const iRole     = col(["role/description", "roledescription", "role", "description", "title", "position"]);
      const iPhone    = col(["phone", "tel", "mobile", "cell", "extension", "ext"]);
      const iPhone2   = col(["phone2", "secondaryphone", "altphone"]);
      const iEmail    = col(["email", "mail"]);
      const iCategory = col(["category", "type", "cat", "department", "dept"]);
      const iNotes    = col(["notes", "note"]);

      const dataRows = rows.slice(1).filter((row) => row.some((cell) => normalizeCell(cell) !== ""));
      let batch = writeBatch(db);
      let count = 0;
      let batchCount = 0;

      for (const row of dataRows) {
        const rawName    = normalizeCell(row[iName] ?? "");
        const rawCompany = normalizeCell(row[iCompany] ?? "");
        const rawRole    = iRole !== -1 ? normalizeCell(row[iRole] ?? "") : "";
        const rawPhone   = normalizeCell(row[iPhone] ?? "");
        const rawPhone2  = iPhone2 !== -1 ? normalizeCell(row[iPhone2] ?? "") : "";
        const rawNotes   = normalizeCell(row[iNotes] ?? "");
        // Nameless rows (e.g. "Front Desk") use Role/Description as the display name
        const name = rawName || rawRole || rawCompany;
        if (!name) continue;
        const rawCat  = normalizeCell(row[iCategory] ?? "");
        const category = rawCompany.trim() || rawCat || "Other";
        // For named contacts, store their role/title in notes if no explicit notes
        const notes = rawNotes || (rawName && rawRole ? rawRole : "");
        const stableId = `${siteId}_${name}`.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 100);
        batch.set(doc(db, "contacts", stableId), {
          name, company: rawCompany, phone: rawPhone, phone2: rawPhone2,
          email: normalizeCell(row[iEmail] ?? ""), category, notes,
          siteId: siteId || "default", importedAt: new Date().toISOString(),
        }, { merge: true });
        count++;
        batchCount++;
        if (batchCount === 499) { await batch.commit(); batch = writeBatch(db); batchCount = 0; }
      }
      if (batchCount > 0) await batch.commit();
      Alert.alert("Import Complete", `${count} contact${count !== 1 ? "s" : ""} imported/updated.`);
    } catch (err: any) {
      Alert.alert("Import Failed", err.message || "An unexpected error occurred.");
    } finally {
      setImportingContacts(false);
    }
  }, [siteId]);

  const exportContactsToCSV = useCallback(async () => {
    if (contacts.length === 0) { Alert.alert("Nothing to export", "No contacts to export."); return; }
    try {
      const header = "Name,Department,Role/Description,Phone,Phone2,Email,Notes";
      const rows = contacts.map((c) =>
        [c.name, c.company ?? "", c.notes ?? "", c.phone ?? "", c.phone2 ?? "", c.email ?? "", ""]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
      );
      const uri = FileSystem.cacheDirectory + "contacts_export.csv";
      await FileSystem.writeAsStringAsync(uri, [header, ...rows].join("\n"), { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Export Contacts CSV" });
    } catch (err: any) {
      Alert.alert("Export Failed", err.message || "An unexpected error occurred.");
    }
  }, [contacts]);

  const exportVendorsToCSV = useCallback(async () => {
    if (vendors.length === 0) { Alert.alert("Nothing to export", "No vendors to export."); return; }
    try {
      const header = "Company,Contact Name,Phone,Email,Website,Account #,Service Type,Notes";
      const rows = vendors.map((v) =>
        [v.company, v.contactName ?? "", v.phone ?? "", v.email ?? "", v.website ?? "", v.accountNumber ?? "", v.serviceType ?? "", v.notes ?? ""]
          .map((val) => `"${String(val).replace(/"/g, '""')}"`)
          .join(",")
      );
      const uri = FileSystem.cacheDirectory + "vendors_export.csv";
      await FileSystem.writeAsStringAsync(uri, [header, ...rows].join("\n"), { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Export Vendors CSV" });
    } catch (err: any) {
      Alert.alert("Export Failed", err.message || "An unexpected error occurred.");
    }
  }, [vendors]);

  const downloadContactTemplate = useCallback(async () => {
    try {
      const content = [
        "Name,Department,Role/Description,Phone,Phone2,Email,Notes",
        "Kim Baron,Marketing,Reg. Marketing & Promotion Mgr.,401-816-6240,856-430-6446,kbaron@example.com,",
        ",Information Technology,IT Help Desk,401-816-6115,,,",
        ",Security,Security Dispatch/Badging,401-816-6400,,,",
      ].join("\n");
      const uri = FileSystem.cacheDirectory + "contacts_template.csv";
      await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Contacts CSV Template" });
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not generate template.");
    }
  }, []);

  const importVendorsFromCSV = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "text/plain"] });
      if (result.canceled) return;
      setImportingVendors(true);
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const rows = parseCSV(content);
      if (rows.length < 2) { Alert.alert("Empty File", "No data rows found."); return; }

      const headers = rows[0].map((h) => h.toLowerCase().replace(/[\s#]+/g, ""));
      const col = (names: string[]) => {
        for (const n of names) { const idx = headers.findIndex((h) => h.includes(n)); if (idx !== -1) return idx; }
        return -1;
      };
      const iCompany     = col(["company", "vendor", "business", "organization"]);
      const iContactName = col(["contactname", "contact", "name", "person"]);
      const iPhone       = col(["phone", "tel", "mobile", "cell"]);
      const iEmail       = col(["email", "mail"]);
      const iWebsite     = col(["website", "web", "url", "site"]);
      const iAccount     = col(["accountnumber", "account", "acct", "customer"]);
      const iService     = col(["servicetype", "service", "type", "category"]);
      const iNotes       = col(["notes", "note", "comment"]);

      const dataRows = rows.slice(1).filter((row) => row.some((cell) => normalizeCell(cell) !== ""));
      let batch = writeBatch(db);
      let count = 0;
      let batchCount = 0;

      for (const row of dataRows) {
        const company = normalizeCell(row[iCompany] ?? "");
        if (!company) continue;
        const stableId = `${siteId}_vendor_${company}`.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 100);
        batch.set(doc(db, "vendors", stableId), {
          company,
          contactName:   normalizeCell(row[iContactName] ?? ""),
          phone:         normalizeCell(row[iPhone] ?? ""),
          email:         normalizeCell(row[iEmail] ?? ""),
          website:       normalizeCell(row[iWebsite] ?? ""),
          accountNumber: normalizeCell(row[iAccount] ?? ""),
          serviceType:   normalizeCell(row[iService] ?? ""),
          notes:         normalizeCell(row[iNotes] ?? ""),
          siteId: siteId || "default", importedAt: new Date().toISOString(),
        }, { merge: true });
        count++;
        batchCount++;
        if (batchCount === 499) { await batch.commit(); batch = writeBatch(db); batchCount = 0; }
      }
      if (batchCount > 0) await batch.commit();
      Alert.alert("Import Complete", `${count} vendor${count !== 1 ? "s" : ""} imported/updated.`);
    } catch (err: any) {
      Alert.alert("Import Failed", err.message || "An unexpected error occurred.");
    } finally {
      setImportingVendors(false);
    }
  }, [siteId]);

  const downloadVendorTemplate = useCallback(async () => {
    try {
      const content = [
        "Company,Contact Name,Phone,Email,Website,Account #,Service Type,Notes",
        "Ipourit,Customer Service,949-270-0548,support@ipourit.com,https://ipouritinc.com/,Ballys Tiverton,Beer Wall,mainly a F&B product but still have to step in once in a while",
        "Light and Wonder,Customer Care,877-462-2559,email per Vendor,https://portal.lnw.com/,tivertonitsupport@ballystiverton.com,Player Tracking/Gaming,All passwords should be saved in Keeper/password reminder",
        "Everi,Customer Service,702-360-8550,support.loyalty@everi.com,https://everi.zendesk.com,tivertonitsupport@ballystiverton.com,Player Tracking/Gaming,All passwords should be saved in Keeper/password reminder",
        "Toshiba,,,, https://tbs.toshiba.com/tbs/supplies/,pagesmart@tabs.toshiba.com,Printers,",
      ].join("\n");
      const uri = FileSystem.cacheDirectory + "vendors_template.csv";
      await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Vendors CSV Template" });
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not generate template.");
    }
  }, []);

  // ── Render helpers ───────────────────────────────────────────────────────
  const renderContact = useCallback(({ item }: { item: Contact }) => {
    const phoneBtn = (phone: string, secondary?: boolean) => (
      <Pressable onPress={() => call(phone)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Text style={{ color: theme.tint, fontSize: 12, fontWeight: "700", opacity: secondary ? 0.6 : 1 }}>{phone.replace(/\D/g, "").slice(-4)}</Text>
        <Ionicons name="call-outline" size={20} color={theme.tint} style={secondary ? { opacity: 0.6 } : undefined} />
      </Pressable>
    );
    return (
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Pressable onPress={() => openEditContact(item)} style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
            <Text style={[styles.name, { color: theme.text }]}>{item.name}</Text>
            {item.category ? (
              <View style={[styles.badge, { backgroundColor: theme.tint + "22" }]}>
                <Text style={{ color: theme.tint, fontSize: 11, fontWeight: "700" }} numberOfLines={1}>{item.category}</Text>
              </View>
            ) : null}
          </View>
          {item.company ? <Text style={{ color: theme.mutedText, fontSize: 13, marginBottom: 2 }}>{item.company}</Text> : null}
          {item.notes ? <Text style={{ color: theme.mutedText, fontSize: 11, fontStyle: "italic" }} numberOfLines={1}>{item.notes}</Text> : null}
        </Pressable>
        <View style={{ alignItems: "flex-end", gap: 8 }}>
          {item.phone  ? phoneBtn(item.phone) : null}
          {item.phone2 ? phoneBtn(item.phone2, true) : null}
          {item.email  ? <Pressable onPress={() => email(item.email!)} hitSlop={8}><Ionicons name="mail-outline" size={20} color={theme.tint} /></Pressable> : null}
          <Pressable onPress={() => deleteContact(item)} hitSlop={8}><Ionicons name="trash-outline" size={18} color="#ef4444" /></Pressable>
        </View>
      </View>
    );
  }, [theme, openEditContact, call, email, deleteContact]);

  const renderVendor = useCallback(({ item }: { item: Vendor }) => (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Pressable onPress={() => openEditVendor(item)} style={{ flex: 1 }}>
        <Text style={[styles.name, { color: theme.text }]}>{item.company}</Text>
        {item.serviceType ? (
          <View style={[styles.badge, { backgroundColor: theme.tint + "22", marginBottom: 4, alignSelf: "flex-start" }]}>
            <Text style={{ color: theme.tint, fontSize: 11, fontWeight: "700" }}>{item.serviceType}</Text>
          </View>
        ) : null}
        {item.contactName ? <Text style={{ color: theme.mutedText, fontSize: 13, marginBottom: 2 }}>{item.contactName}</Text> : null}
        {item.accountNumber ? <Text style={{ color: theme.mutedText, fontSize: 11 }}>Acct: {item.accountNumber}</Text> : null}
        {item.notes ? <Text style={{ color: theme.mutedText, fontSize: 11, fontStyle: "italic" }} numberOfLines={1}>{item.notes}</Text> : null}
      </Pressable>
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        {item.phone   ? <Pressable onPress={() => call(item.phone!)} hitSlop={8}><Ionicons name="call-outline" size={20} color={theme.tint} /></Pressable> : null}
        {item.email   ? <Pressable onPress={() => email(item.email!)} hitSlop={8}><Ionicons name="mail-outline" size={20} color={theme.tint} /></Pressable> : null}
        {item.website ? <Pressable onPress={() => web(item.website!)} hitSlop={8}><Ionicons name="globe-outline" size={20} color={theme.tint} /></Pressable> : null}
        <Pressable onPress={() => deleteVendor(item)} hitSlop={8}><Ionicons name="trash-outline" size={18} color="#ef4444" /></Pressable>
      </View>
    </View>
  ), [theme, openEditVendor, call, email, web, deleteVendor]);

  const renderLincolnTech = useCallback(({ item }: { item: LincolnTech }) => (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Pressable onPress={() => openEditLincoln(item)} style={{ flex: 1 }}>
        <Text style={[styles.name, { color: theme.text }]}>{item.name}</Text>
        {item.title ? (
          <View style={[styles.badge, { backgroundColor: theme.tint + "22", marginBottom: 4, alignSelf: "flex-start" }]}>
            <Text style={{ color: theme.tint, fontSize: 11, fontWeight: "700" }}>{item.title}</Text>
          </View>
        ) : null}
        {item.notes ? <Text style={{ color: theme.mutedText, fontSize: 11, fontStyle: "italic" }} numberOfLines={1}>{item.notes}</Text> : null}
      </Pressable>
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        {item.phone ? <Pressable onPress={() => call(item.phone!)} hitSlop={8}><Ionicons name="call-outline" size={20} color={theme.tint} /></Pressable> : null}
        {item.email ? <Pressable onPress={() => email(item.email!)} hitSlop={8}><Ionicons name="mail-outline" size={20} color={theme.tint} /></Pressable> : null}
        <Pressable onPress={() => deleteLincoln(item)} hitSlop={8}><Ionicons name="trash-outline" size={18} color="#ef4444" /></Pressable>
      </View>
    </View>
  ), [theme, openEditLincoln, call, email, deleteLincoln]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>

      {/* Subtab switcher */}
      <View style={[styles.tabRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
        {(["contacts", "vendors", "lincoln"] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tabBtn, tab === t && { backgroundColor: theme.tint }]}
          >
            <Text style={{ color: tab === t ? "#000" : theme.mutedText, fontWeight: "700", fontSize: 13, textTransform: "capitalize" }}>
              {t === "contacts" ? "Contacts" : t === "vendors" ? "Vendors" : techTabLabel}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ── CONTACTS TAB ── */}
      {tab === "contacts" && (
        <>
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 8 }}>
            <TextInput
              style={[styles.search, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, flex: 1 }]}
              placeholder="Search contacts..."
              placeholderTextColor={theme.mutedText}
              value={contactSearch}
              onChangeText={setContactSearch}
            />
            <Pressable onPress={openAddContact} style={[styles.addBtn, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Ionicons name="add" size={22} color={theme.text} />
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
            <Pressable onPress={importContactsFromCSV} disabled={importingContacts}
              style={[styles.csvBtn, { backgroundColor: theme.card, borderColor: theme.border, flex: 1 }]}>
              {importingContacts
                ? <ActivityIndicator size="small" color={theme.text} />
                : <><Ionicons name="cloud-upload-outline" size={15} color={theme.text} style={{ marginRight: 4 }} /><Text style={[styles.csvBtnText, { color: theme.text }]}>Import</Text></>}
            </Pressable>
            <Pressable onPress={exportContactsToCSV}
              style={[styles.csvBtn, { backgroundColor: theme.card, borderColor: theme.border, flex: 1 }]}>
              <Ionicons name="cloud-download-outline" size={15} color={theme.text} style={{ marginRight: 4 }} />
              <Text style={[styles.csvBtnText, { color: theme.text }]}>Export</Text>
            </Pressable>
            <Pressable onPress={downloadContactTemplate}
              style={[styles.csvBtn, { backgroundColor: theme.card, borderColor: theme.border, flex: 1 }]}>
              <Ionicons name="document-outline" size={15} color={theme.text} style={{ marginRight: 4 }} />
              <Text style={[styles.csvBtnText, { color: theme.text }]}>Template</Text>
            </Pressable>
          </View>

          <Pressable onPress={() => setShowFilterDropdown(true)}
            style={[styles.dropdown, { backgroundColor: theme.card, borderColor: selectedCategory ? theme.tint : theme.border }]}>
            <Text style={{ color: selectedCategory ? theme.tint : theme.mutedText, fontSize: 14, flex: 1 }}>
              {selectedCategory ?? "Filter by department..."}
            </Text>
            {selectedCategory
              ? <Pressable onPress={() => setSelectedCategory(null)} hitSlop={8}><Ionicons name="close-circle" size={18} color={theme.mutedText} /></Pressable>
              : <Ionicons name="chevron-down" size={18} color={theme.mutedText} />}
          </Pressable>

          <Modal visible={showFilterDropdown} transparent animationType="fade" onRequestClose={() => setShowFilterDropdown(false)}>
            <Pressable style={styles.dropdownOverlay} onPress={() => setShowFilterDropdown(false)}>
              <View style={[styles.dropdownMenu, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Pressable onPress={() => { setSelectedCategory(null); setShowFilterDropdown(false); }}
                  style={[styles.dropdownItem, { borderBottomColor: theme.border }]}>
                  <Text style={{ color: theme.text, fontSize: 15, fontWeight: "700" }}>All Departments</Text>
                </Pressable>
                <ScrollView>
                  {activeCategories.map((cat) => (
                    <Pressable key={cat} onPress={() => { setSelectedCategory(cat); setShowFilterDropdown(false); }}
                      style={[styles.dropdownItem, { borderBottomColor: theme.border, backgroundColor: selectedCategory === cat ? theme.tint + "22" : "transparent" }]}>
                      <Text style={{ color: selectedCategory === cat ? theme.tint : theme.text, fontSize: 15 }}>{cat}</Text>
                      {selectedCategory === cat && <Ionicons name="checkmark" size={16} color={theme.tint} />}
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            </Pressable>
          </Modal>

          <FlatList
            data={filteredContacts}
            keyExtractor={(c) => c.id}
            renderItem={renderContact}
            contentContainerStyle={{ paddingBottom: 40 }}
            ListEmptyComponent={
              <Text style={{ color: theme.mutedText, textAlign: "center", marginTop: 40 }}>
                {contactSearch || selectedCategory ? "No contacts match." : "No contacts yet. Tap + to add one."}
              </Text>
            }
          />
        </>
      )}

      {/* ── VENDORS TAB ── */}
      {tab === "vendors" && (
        <>
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 8 }}>
            <TextInput
              style={[styles.search, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, flex: 1 }]}
              placeholder="Search vendors..."
              placeholderTextColor={theme.mutedText}
              value={vendorSearch}
              onChangeText={setVendorSearch}
            />
            <Pressable onPress={openAddVendor} style={[styles.addBtn, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Ionicons name="add" size={22} color={theme.text} />
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
            <Pressable onPress={importVendorsFromCSV} disabled={importingVendors}
              style={[styles.csvBtn, { backgroundColor: theme.card, borderColor: theme.border, flex: 1 }]}>
              {importingVendors
                ? <ActivityIndicator size="small" color={theme.text} />
                : <><Ionicons name="cloud-upload-outline" size={15} color={theme.text} style={{ marginRight: 4 }} /><Text style={[styles.csvBtnText, { color: theme.text }]}>Import</Text></>}
            </Pressable>
            <Pressable onPress={exportVendorsToCSV}
              style={[styles.csvBtn, { backgroundColor: theme.card, borderColor: theme.border, flex: 1 }]}>
              <Ionicons name="cloud-download-outline" size={15} color={theme.text} style={{ marginRight: 4 }} />
              <Text style={[styles.csvBtnText, { color: theme.text }]}>Export</Text>
            </Pressable>
            <Pressable onPress={downloadVendorTemplate}
              style={[styles.csvBtn, { backgroundColor: theme.card, borderColor: theme.border, flex: 1 }]}>
              <Ionicons name="document-outline" size={15} color={theme.text} style={{ marginRight: 4 }} />
              <Text style={[styles.csvBtnText, { color: theme.text }]}>Template</Text>
            </Pressable>
          </View>

          <FlatList
            data={filteredVendors}
            keyExtractor={(v) => v.id}
            renderItem={renderVendor}
            contentContainerStyle={{ paddingBottom: 40 }}
            ListEmptyComponent={
              <Text style={{ color: theme.mutedText, textAlign: "center", marginTop: 40 }}>
                {vendorSearch ? "No vendors match." : "No vendors yet. Tap + to add one."}
              </Text>
            }
          />
        </>
      )}

      {/* ── LINCOLN TECHS TAB ── */}
      {tab === "lincoln" && (
        <>
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 8 }}>
            <TextInput
              style={[styles.search, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, flex: 1 }]}
              placeholder={`Search ${techTabLabel}s...`}
              placeholderTextColor={theme.mutedText}
              value={lincolnSearch}
              onChangeText={setLincolnSearch}
            />
            <Pressable onPress={openAddLincoln} style={[styles.addBtn, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Ionicons name="add" size={22} color={theme.text} />
            </Pressable>
          </View>
          <FlatList
            data={filteredLincolnTechs}
            keyExtractor={(lt) => lt.id}
            renderItem={renderLincolnTech}
            contentContainerStyle={{ paddingBottom: 40 }}
            ListEmptyComponent={
              <Text style={{ color: theme.mutedText, textAlign: "center", marginTop: 40 }}>
                {lincolnSearch ? "No results match." : "No Techs have been added yet. Tap + to add one."}
              </Text>
            }
          />
        </>
      )}

      {/* ── CONTACT MODAL ── */}
      <Modal visible={showContactModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowContactModal(false)}>
        <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{editingContact ? "Edit Contact" : "Add Contact"}</Text>
            <Pressable onPress={() => setShowContactModal(false)}><Ionicons name="close" size={24} color={theme.text} /></Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {[
              { label: "Name *", key: "name", placeholder: "Full name", keyboard: "default" },
              { label: "Department", key: "company", placeholder: "Department or company", keyboard: "default" },
              { label: "Phone", key: "phone", placeholder: "Phone number", keyboard: "phone-pad" },
              { label: "Phone 2", key: "phone2", placeholder: "Secondary phone", keyboard: "phone-pad" },
              { label: "Email", key: "email", placeholder: "Email address", keyboard: "email-address" },
            ].map(({ label, key, placeholder, keyboard }) => (
              <View key={key}>
                <Text style={[styles.label, { color: theme.mutedText }]}>{label}</Text>
                <TextInput
                  style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                  placeholder={placeholder}
                  placeholderTextColor={theme.mutedText}
                  keyboardType={keyboard as any}
                  autoCapitalize={keyboard === "email-address" ? "none" : "sentences"}
                  value={(contactForm as any)[key]}
                  onChangeText={(v) => setContactForm((p) => ({ ...p, [key]: v }))}
                />
              </View>
            ))}
            <Text style={[styles.label, { color: theme.mutedText }]}>Notes</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, height: 80, textAlignVertical: "top" }]}
              placeholder="Any additional notes..."
              placeholderTextColor={theme.mutedText}
              multiline
              value={contactForm.notes}
              onChangeText={(v) => setContactForm((p) => ({ ...p, notes: v }))}
            />
            <Pressable onPress={saveContact} disabled={savingContact}
              style={[styles.saveBtn, { backgroundColor: theme.tint, opacity: savingContact ? 0.6 : 1 }]}>
              <Text style={{ color: "#000", fontWeight: "800", fontSize: 16 }}>
                {savingContact ? "Saving…" : editingContact ? "Save Changes" : "Add Contact"}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {/* ── VENDOR MODAL ── */}
      <Modal visible={showVendorModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowVendorModal(false)}>
        <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{editingVendor ? "Edit Vendor" : "Add Vendor"}</Text>
            <Pressable onPress={() => setShowVendorModal(false)}><Ionicons name="close" size={24} color={theme.text} /></Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {[
              { label: "Company Name *", key: "company", placeholder: "Vendor company name", keyboard: "default" },
              { label: "Contact Person", key: "contactName", placeholder: "Name of your contact", keyboard: "default" },
              { label: "Phone", key: "phone", placeholder: "Phone number", keyboard: "phone-pad" },
              { label: "Email", key: "email", placeholder: "Email address", keyboard: "email-address" },
              { label: "Website", key: "website", placeholder: "e.g. vendor.com", keyboard: "url" },
              { label: "Account #", key: "accountNumber", placeholder: "Account or customer number", keyboard: "default" },
              { label: "Service Type", key: "serviceType", placeholder: "e.g. Copier Maintenance, IT Support", keyboard: "default" },
            ].map(({ label, key, placeholder, keyboard }) => (
              <View key={key}>
                <Text style={[styles.label, { color: theme.mutedText }]}>{label}</Text>
                <TextInput
                  style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                  placeholder={placeholder}
                  placeholderTextColor={theme.mutedText}
                  keyboardType={keyboard as any}
                  autoCapitalize={["email-address", "url"].includes(keyboard) ? "none" : "sentences"}
                  value={(vendorForm as any)[key]}
                  onChangeText={(v) => setVendorForm((p) => ({ ...p, [key]: v }))}
                />
              </View>
            ))}
            <Text style={[styles.label, { color: theme.mutedText }]}>Notes</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, height: 80, textAlignVertical: "top" }]}
              placeholder="Any additional notes..."
              placeholderTextColor={theme.mutedText}
              multiline
              value={vendorForm.notes}
              onChangeText={(v) => setVendorForm((p) => ({ ...p, notes: v }))}
            />
            <Pressable onPress={saveVendor} disabled={savingVendor}
              style={[styles.saveBtn, { backgroundColor: theme.tint, opacity: savingVendor ? 0.6 : 1 }]}>
              <Text style={{ color: "#000", fontWeight: "800", fontSize: 16 }}>
                {savingVendor ? "Saving…" : editingVendor ? "Save Changes" : "Add Vendor"}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {/* ── LINCOLN MODAL ── */}
      <Modal visible={showLincolnModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowLincolnModal(false)}>
        <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{editingLincoln ? `Edit ${techTabLabel}` : `Add ${techTabLabel}`}</Text>
            <Pressable onPress={() => setShowLincolnModal(false)}><Ionicons name="close" size={24} color={theme.text} /></Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {[
              { label: "Name *", key: "name", placeholder: "Full name", keyboard: "default" },
              { label: "Title / Role", key: "title", placeholder: "e.g. Field Technician", keyboard: "default" },
              { label: "Phone", key: "phone", placeholder: "Phone number", keyboard: "phone-pad" },
              { label: "Email", key: "email", placeholder: "Email address", keyboard: "email-address" },
            ].map(({ label, key, placeholder, keyboard }) => (
              <View key={key}>
                <Text style={[styles.label, { color: theme.mutedText }]}>{label}</Text>
                <TextInput
                  style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card }]}
                  placeholder={placeholder}
                  placeholderTextColor={theme.mutedText}
                  keyboardType={keyboard as any}
                  autoCapitalize={keyboard === "email-address" ? "none" : "sentences"}
                  value={(lincolnForm as any)[key]}
                  onChangeText={(v) => setLincolnForm((p) => ({ ...p, [key]: v }))}
                />
              </View>
            ))}
            <Text style={[styles.label, { color: theme.mutedText }]}>Notes</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.card, height: 80, textAlignVertical: "top" }]}
              placeholder="Any additional notes..."
              placeholderTextColor={theme.mutedText}
              multiline
              value={lincolnForm.notes}
              onChangeText={(v) => setLincolnForm((p) => ({ ...p, notes: v }))}
            />
            <Pressable onPress={saveLincoln} disabled={savingLincoln}
              style={[styles.saveBtn, { backgroundColor: theme.tint, opacity: savingLincoln ? 0.6 : 1 }]}>
              <Text style={{ color: "#000", fontWeight: "800", fontSize: 16 }}>
                {savingLincoln ? "Saving…" : editingLincoln ? "Save Changes" : `Add ${techTabLabel}`}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:      { flex: 1, padding: 16, paddingTop: 16 },
  tabRow:         { flexDirection: "row", borderRadius: 12, borderWidth: 1, marginBottom: 14, overflow: "hidden" },
  tabBtn:         { flex: 1, paddingVertical: 10, alignItems: "center", justifyContent: "center" },
  search:         { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14 },
  addBtn:         { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, justifyContent: "center", alignItems: "center" },
  card:           { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  name:           { fontWeight: "700", fontSize: 15, marginRight: 8 },
  badge:          { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, maxWidth: 160, flexShrink: 1 },
  modalContainer: { flex: 1, padding: 20 },
  modalHeader:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle:     { fontSize: 20, fontWeight: "800" },
  label:          { fontSize: 12, fontWeight: "600", marginBottom: 6, textTransform: "uppercase" },
  input:          { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, marginBottom: 16 },
  saveBtn:        { borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 8, marginBottom: 40 },
  csvBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  csvBtnText:     { fontSize: 13, fontWeight: "600" },
  dropdown:       { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 12 },
  dropdownOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  dropdownMenu:   { borderRadius: 16, borderWidth: 1, overflow: "hidden", maxHeight: 400 },
  dropdownItem:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1 },
});
