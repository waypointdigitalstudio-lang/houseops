// app/(tabs)/pm.tsx — Preventative Maintenance Device List
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  View,
} from "react-native";
import { ALL_CHECKS, PM_SECTIONS } from "../../constants/pmSections";
import { useAppTheme } from "../../constants/theme";
import { db } from "../../firebaseConfig";
import { useUserProfile } from "../../hooks/useUserProfile";
import { normalizeCell, parseCSV } from "../../utils/csvHelpers";

// ─── Types ───────────────────────────────────────────────────────────────────

type CheckValue = "OK" | "Repair Needed" | "N/A";
type FilterMode = "all" | "due" | "pending" | "done" | "repair";
type DeviceType = "Desktop" | "Laptop" | "Server";

interface PmDevice {
  id: string;
  name: string;
  fqdn: string;
  ip: string;
  os: string;
  osVer: string;
  status: string;
  user: string;
  type: DeviceType;
  siteId: string;
}

interface PmRecord {
  id: string;
  deviceId: string;
  siteId: string;
  checks: Record<string, CheckValue>;
  pmDate: string;
  tech: string;
}

interface AddForm {
  name: string;
  fqdn: string;
  ip: string;
  os: string;
  osVer: string;
  type: DeviceType;
  status: string;
  user: string;
}

interface ImportPreviewRow {
  name: string;
  fqdn: string;
  ip: string;
  os: string;
  osVer: string;
  type: string;
  status: string;
  user: string;
}

const BLANK_FORM: AddForm = {
  name: "", fqdn: "", ip: "", os: "", osVer: "",
  type: "Desktop", status: "Active [ON]", user: "",
};

const STATUS_OPTIONS = ["Active [ON]", "Offline", "Lost"];
const TYPE_OPTIONS: DeviceType[] = ["Desktop", "Laptop", "Server"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stableDeviceId(siteId: string, name: string): string {
  return `${siteId}_${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
}

function isDone(record: PmRecord | undefined): boolean {
  if (!record) return false;
  return ALL_CHECKS.every((c) => record.checks?.[c]);
}

function checkedCount(record: PmRecord | undefined): number {
  if (!record) return 0;
  return ALL_CHECKS.filter((c) => record.checks?.[c]).length;
}

function hasRepair(record: PmRecord | undefined): boolean {
  if (!record) return false;
  return ALL_CHECKS.some((c) => record.checks?.[c] === "Repair Needed");
}

function pmDueStatus(record: PmRecord | undefined): "due" | "overdue" | "current" {
  if (!record?.pmDate) return "due";
  const lastPm = new Date(record.pmDate);
  if (isNaN(lastPm.getTime())) return "due";
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);
  return lastPm <= cutoff ? "overdue" : "current";
}

function statusDotColor(status: string): string {
  if (status.includes("Active")) return "#22c55e";
  if (status === "Lost") return "#f97316";
  return "#ef4444";
}

function deviceIcon(type: DeviceType): string {
  if (type === "Laptop") return "laptop-outline";
  if (type === "Server") return "server-outline";
  return "desktop-outline";
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PMScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const { profile, siteId } = useUserProfile();
  const isAdmin = profile?.role === "admin";

  const [devices, setDevices] = useState<PmDevice[]>([]);
  const [records, setRecords] = useState<Record<string, PmRecord>>({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");

  // Add device modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<AddForm>(BLANK_FORM);
  const [addSaving, setAddSaving] = useState(false);
  const [editingDevice, setEditingDevice] = useState<PmDevice | null>(null);

  // Import modal
  const [importPreview, setImportPreview] = useState<ImportPreviewRow[]>([]);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [importSaving, setImportSaving] = useState(false);

  const [exporting, setExporting] = useState(false);

  // ─── Firestore subscriptions ──────────────────────────────────────────────

  useEffect(() => {
    if (!siteId) { setLoading(false); return; }
    const q = query(
      collection(db, "pmDevices"),
      where("siteId", "==", siteId)
    );
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as PmDevice))
          .sort((a, b) => a.name.localeCompare(b.name));
        setDevices(list);
        setLoading(false);
      },
      (err) => {
        console.error("pmDevices snapshot error:", err);
        setLoading(false);
      }
    );
  }, [siteId]);

  useEffect(() => {
    if (!siteId) return;
    const q = query(collection(db, "pmRecords"), where("siteId", "==", siteId));
    return onSnapshot(q, (snap) => {
      const map: Record<string, PmRecord> = {};
      snap.docs.forEach((d) => {
        const rec = { id: d.id, ...d.data() } as PmRecord;
        map[rec.deviceId] = rec;
      });
      setRecords(map);
    });
  }, [siteId]);

  // ─── Derived state ────────────────────────────────────────────────────────

  const filteredDevices = useMemo(() => {
    let result = devices;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.ip.includes(q) ||
          d.user.toLowerCase().includes(q) ||
          d.os.toLowerCase().includes(q)
      );
    }
    if (filter === "due")     result = result.filter((d) => pmDueStatus(records[d.id]) !== "current");
    if (filter === "done")    result = result.filter((d) => isDone(records[d.id]));
    if (filter === "pending") result = result.filter((d) => !isDone(records[d.id]));
    if (filter === "repair")  result = result.filter((d) => hasRepair(records[d.id]));
    return result;
  }, [devices, records, searchQuery, filter]);

  const totalDone = useMemo(
    () => devices.filter((d) => isDone(records[d.id])).length,
    [devices, records]
  );

  // ─── Add / Edit device ────────────────────────────────────────────────────

  const openAddModal = () => {
    setEditingDevice(null);
    setAddForm(BLANK_FORM);
    setShowAddModal(true);
  };

  const openEditModal = (device: PmDevice) => {
    setEditingDevice(device);
    setAddForm({
      name: device.name,
      fqdn: device.fqdn || "",
      ip: device.ip || "",
      os: device.os || "",
      osVer: device.osVer || "",
      type: device.type || "Desktop",
      status: device.status || "Active [ON]",
      user: device.user || "",
    });
    setShowAddModal(true);
  };

  const saveDevice = async () => {
    if (!siteId || !addForm.name.trim()) {
      Alert.alert("Error", "Device name is required.");
      return;
    }
    setAddSaving(true);
    try {
      const docId = editingDevice
        ? editingDevice.id
        : stableDeviceId(siteId, addForm.name.trim());
      await setDoc(
        doc(db, "pmDevices", docId),
        {
          name: addForm.name.trim(),
          fqdn: addForm.fqdn.trim(),
          ip: addForm.ip.trim(),
          os: addForm.os.trim(),
          osVer: addForm.osVer.trim(),
          type: addForm.type,
          status: addForm.status,
          user: addForm.user.trim(),
          siteId,
          updatedAt: serverTimestamp(),
          ...(editingDevice ? {} : { createdAt: serverTimestamp() }),
        },
        { merge: true }
      );
      setShowAddModal(false);
      setAddForm(BLANK_FORM);
      setEditingDevice(null);
    } catch {
      Alert.alert("Error", "Failed to save device.");
    }
    setAddSaving(false);
  };

  const confirmDelete = (device: PmDevice) => {
    Alert.alert(
      "Delete Device",
      `Remove "${device.name}" from PM? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteDoc(doc(db, "pmDevices", device.id));
            } catch {
              Alert.alert("Error", "Failed to delete device.");
            }
          },
        },
      ]
    );
  };

  // ─── CSV Import ───────────────────────────────────────────────────────────

  const pickImportCSV = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "text/plain"] });
      if (result.canceled) return;
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const rows = parseCSV(content);
      if (rows.length < 2) { Alert.alert("Error", "CSV has no data rows."); return; }

      // BeyondTrust exports start with a single-cell "Jump Client" label row — skip it
      const headerRowIdx = rows[0].length === 1 ? 1 : 0;
      const headers = rows[headerRowIdx].map((h) => h.toLowerCase().trim());
      const dataRows = rows.slice(headerRowIdx + 1);

      // Detect BeyondTrust Jump Client format by unique column names
      const isBeyondTrust = headers.some(
        (h) => h === "operating system" || h === "console user" || h === "hostname / ip"
      );

      let preview: ImportPreviewRow[];

      if (isBeyondTrust) {
        const nameIdx      = headers.indexOf("name");
        const fqdnIdx      = headers.indexOf("fqdn");
        const ipIdx        = headers.indexOf("private ip");
        const osIdx        = headers.indexOf("operating system");
        const statusIdx    = headers.indexOf("status");
        const userIdx      = headers.indexOf("console user");

        const strip = (s: string) => (s.startsWith("'") ? s.slice(1) : s);

        const parseOS = (raw: string): { os: string; osVer: string } => {
          const m = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
          return m ? { os: m[1].trim(), osVer: m[2].trim() } : { os: raw, osVer: "" };
        };

        const mapStatus = (s: string): string => {
          const l = s.toLowerCase();
          if (l.includes("lost")) return "Lost";
          if (l.includes("offline") || l === "uninstalled") return "Offline";
          return "Active [ON]";
        };

        const inferType = (os: string, name: string): DeviceType => {
          if (os.toLowerCase().includes("server")) return "Server";
          if (name.toLowerCase().includes("laptop")) return "Laptop";
          return "Desktop";
        };

        const seen = new Set<string>();
        preview = dataRows
          .map((row) => {
            const name = strip(normalizeCell(row[nameIdx] ?? ""));
            const rawOs = osIdx !== -1 ? normalizeCell(row[osIdx] ?? "") : "";
            const { os, osVer } = parseOS(rawOs);
            return {
              name,
              fqdn:   fqdnIdx   !== -1 ? strip(normalizeCell(row[fqdnIdx]   ?? "")) : "",
              ip:     ipIdx     !== -1 ? normalizeCell(row[ipIdx]            ?? "") : "",
              os,
              osVer,
              type:   inferType(os, name),
              status: statusIdx !== -1 ? mapStatus(normalizeCell(row[statusIdx] ?? "")) : "Active [ON]",
              user:   userIdx   !== -1 ? normalizeCell(row[userIdx]          ?? "") : "",
            };
          })
          .filter((d) => {
            if (!d.name || d.name.toLowerCase().startsWith("tv48 jump")) return false;
            const key = d.name.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
      } else {
        // Original Nexus device template format
        const col = (names: string[]) =>
          names.map((n) => headers.findIndex((h) => h.includes(n))).find((i) => i !== -1) ?? -1;
        const nameIdx   = col(["name"]);
        const fqdnIdx   = col(["fqdn", "hostname", "host"]);
        const ipIdx     = col(["ip"]);
        const osIdx     = col(["os"]);
        const osVerIdx  = col(["os ver", "osver", "version", "ver"]);
        const typeIdx   = col(["type"]);
        const statusIdx = col(["status"]);
        const userIdx   = col(["user"]);

        if (nameIdx === -1) { Alert.alert("Error", "CSV must have a 'Name' column."); return; }

        preview = dataRows
          .map((row) => ({
            name:   normalizeCell(row[nameIdx]   ?? ""),
            fqdn:   fqdnIdx   !== -1 ? normalizeCell(row[fqdnIdx]   ?? "") : "",
            ip:     ipIdx     !== -1 ? normalizeCell(row[ipIdx]     ?? "") : "",
            os:     osIdx     !== -1 ? normalizeCell(row[osIdx]     ?? "") : "",
            osVer:  osVerIdx  !== -1 ? normalizeCell(row[osVerIdx]  ?? "") : "",
            type:   typeIdx   !== -1 ? normalizeCell(row[typeIdx]   ?? "") : "Desktop",
            status: statusIdx !== -1 ? normalizeCell(row[statusIdx] ?? "") : "Active [ON]",
            user:   userIdx   !== -1 ? normalizeCell(row[userIdx]   ?? "") : "",
          }))
          .filter((d) => d.name);
      }

      if (preview.length === 0) { Alert.alert("Error", "No valid rows found."); return; }
      setImportPreview(preview);
      setShowImportModal(true);
    } catch {
      Alert.alert("Error", "Failed to read CSV file.");
    }
  };

  const commitImport = async () => {
    if (!siteId) return;
    setImportSaving(true);
    try {
      // Firestore batch limit = 500; device lists are typically <500
      const batch = writeBatch(db);
      importPreview.forEach((d) => {
        const docId = stableDeviceId(siteId, d.name);
        batch.set(
          doc(db, "pmDevices", docId),
          {
            name: d.name,
            fqdn: d.fqdn,
            ip: d.ip,
            os: d.os,
            osVer: d.osVer,
            type: d.type || "Desktop",
            status: d.status || "Active [ON]",
            user: d.user,
            siteId,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      });
      await batch.commit();
      setShowImportModal(false);
      setImportPreview([]);
      Alert.alert("Success", `${importPreview.length} device(s) imported.`);
    } catch {
      Alert.alert("Error", "Import failed.");
    }
    setImportSaving(false);
  };

  // ─── CSV Export ───────────────────────────────────────────────────────────

  const exportCSV = async () => {
    if (devices.length === 0) { Alert.alert("Nothing to export."); return; }
    setExporting(true);
    try {
      const headers = [
        "Device", "FQDN", "IP", "OS", "OS Version", "Type", "Status", "User",
        "PM Date", "Tech", "Dept", "Asset No",
        ...ALL_CHECKS, "Boot Errors", "PM Notes",
      ];
      const rows = [headers];
      devices.forEach((d) => {
        const rec = records[d.id];
        rows.push([
          d.name, d.fqdn || "", d.ip || "", d.os || "", d.osVer || "",
          d.type || "", d.status || "", d.user || "",
          rec?.pmDate || "", rec?.tech || "",
          (rec as any)?.dept || "", (rec as any)?.assetNo || "",
          ...ALL_CHECKS.map((c) => rec?.checks?.[c] || ""),
          (rec as any)?.bootErrors || "", (rec as any)?.notes || "",
        ]);
      });
      const csv = rows
        .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
        .join("\n");
      const uri =
        FileSystem.cacheDirectory +
        `PM_Checklist_${new Date().toISOString().split("T")[0]}.csv`;
      await FileSystem.writeAsStringAsync(uri, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "PM Checklist Export" });
    } catch {
      Alert.alert("Error", "Export failed.");
    }
    setExporting(false);
  };

  // ─── Render helpers ───────────────────────────────────────────────────────

  const renderDevice = useCallback(
    ({ item: device }: { item: PmDevice }) => {
      const rec = records[device.id];
      const done = isDone(rec);
      const count = checkedCount(rec);
      const repair = hasRepair(rec);
      const dueStatus = pmDueStatus(rec);

      const borderColor =
        dueStatus === "overdue" ? "#f97316" :
        dueStatus === "due"     ? "#f97316" :
        repair                  ? "#ef4444" :
        done                    ? "#22c55e" :
        theme.border;

      return (
        <Pressable
          style={[styles.card, { backgroundColor: theme.card, borderColor }]}
          onPress={() => router.push(`/pm/${device.id}`)}
          onLongPress={() => isAdmin && openEditModal(device)}
        >
          <View style={[styles.cardIcon, { backgroundColor: theme.background }]}>
            <Ionicons name={deviceIcon(device.type) as any} size={22} color={theme.primary} />
          </View>

          <View style={styles.cardInfo}>
            <Text style={[styles.cardName, { color: theme.text }]} numberOfLines={1}>
              {device.name}
            </Text>
            <Text style={[styles.cardMeta, { color: theme.mutedText }]} numberOfLines={1}>
              {[device.os, device.osVer].filter(Boolean).join(" · ")}
              {device.user ? ` · ${device.user}` : ""}
            </Text>
            <Text style={[styles.cardMeta, { color: theme.mutedText }]}>
              {device.ip}
              {dueStatus === "current" && rec?.pmDate ? `  ·  PM: ${rec.pmDate}` : ""}
            </Text>
          </View>

          <View style={styles.cardRight}>
            <View style={[styles.statusDot, { backgroundColor: statusDotColor(device.status) }]} />
            {dueStatus === "overdue" ? (
              <View style={[styles.badge, styles.badgeOverdue]}>
                <Text style={styles.badgeOverdueText}>Overdue</Text>
              </View>
            ) : dueStatus === "due" ? (
              <View style={[styles.badge, styles.badgeDue]}>
                <Text style={styles.badgeDueText}>PM Due</Text>
              </View>
            ) : done ? (
              <View style={[styles.badge, styles.badgeDone]}>
                <Text style={styles.badgeDoneText}>✓ Done</Text>
              </View>
            ) : repair ? (
              <View style={[styles.badge, styles.badgeRepair]}>
                <Text style={styles.badgeRepairText}>⚠ Repair</Text>
              </View>
            ) : count > 0 ? (
              <View style={[styles.badge, styles.badgePending]}>
                <Text style={styles.badgePendingText}>{count}/{ALL_CHECKS.length}</Text>
              </View>
            ) : null}
            {isAdmin && (
              <Pressable
                hitSlop={8}
                onPress={() =>
                  Alert.alert(device.name, "What would you like to do?", [
                    { text: "Edit", onPress: () => openEditModal(device) },
                    { text: "Delete", style: "destructive", onPress: () => confirmDelete(device) },
                    { text: "Cancel", style: "cancel" },
                  ])
                }
              >
                <Ionicons name="ellipsis-horizontal" size={18} color={theme.mutedText} />
              </Pressable>
            )}
          </View>
        </Pressable>
      );
    },
    [records, theme, isAdmin, router]
  );

  // ─── Form field helper ────────────────────────────────────────────────────

  const field = (label: string, key: keyof AddForm, placeholder?: string) => (
    <View style={styles.formField}>
      <Text style={[styles.formLabel, { color: theme.mutedText }]}>{label}</Text>
      <TextInput
        style={[styles.formInput, { backgroundColor: theme.background, borderColor: theme.border, color: theme.text }]}
        value={String(addForm[key])}
        onChangeText={(v) => setAddForm((f) => ({ ...f, [key]: v }))}
        placeholder={placeholder ?? label}
        placeholderTextColor={theme.mutedText}
        autoCapitalize="none"
      />
    </View>
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  const s = StyleSheet.create({});

  if (!siteId && !loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Text style={{ color: theme.mutedText }}>No site assigned. Contact an admin.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* ── Search + filters ── */}
      <View style={[styles.searchWrap, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
        <View style={[styles.searchBar, { backgroundColor: theme.background, borderColor: theme.border }]}>
          <Ionicons name="search-outline" size={16} color={theme.mutedText} style={{ marginRight: 6 }} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search name, IP, user, OS…"
            placeholderTextColor={theme.mutedText}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
        </View>

        {/* Filter chips + count + overflow */}
        <View style={styles.filterRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            {(["all", "due", "pending", "done", "repair"] as FilterMode[]).map((f) => (
              <Pressable
                key={f}
                style={[
                  styles.chip,
                  { borderColor: theme.border, backgroundColor: theme.background },
                  filter === f && { backgroundColor: theme.primary, borderColor: theme.primary },
                ]}
                onPress={() => setFilter(f)}
              >
                <Text style={[styles.chipText, { color: theme.mutedText }, filter === f && { color: "#fff" }]}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={[styles.countText, { color: theme.mutedText }]}>
            {loading ? "…" : `${totalDone}/${devices.length}`}
          </Text>
          <Pressable style={styles.iconBtn} onPress={() => setShowOverflowMenu(true)}>
            {exporting ? (
              <ActivityIndicator size="small" color={theme.mutedText} />
            ) : (
              <Ionicons name="ellipsis-horizontal" size={22} color={theme.mutedText} />
            )}
          </Pressable>
        </View>
      </View>

      {/* ── Device list ── */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : filteredDevices.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="construct-outline" size={48} color={theme.mutedText} />
          <Text style={[styles.emptyText, { color: theme.mutedText }]}>
            {devices.length === 0 ? "No devices yet." : "No devices match your filter."}
          </Text>
          {devices.length === 0 && isAdmin && (
            <Text style={[styles.emptyHint, { color: theme.mutedText }]}>
              Tap + to add a device or import via CSV.
            </Text>
          )}
        </View>
      ) : (
        <FlatList
          data={filteredDevices}
          keyExtractor={(d) => d.id}
          renderItem={renderDevice}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {/* ── Add / Edit device modal ── */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { backgroundColor: theme.background }]}>
          {/* Title row — no action buttons */}
          <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
            <Pressable onPress={() => setShowAddModal(false)} style={styles.modalClose}>
              <Ionicons name="close" size={22} color={theme.mutedText} />
            </Pressable>
            <Text style={[styles.modalTitle, { color: theme.text }]}>
              {editingDevice ? "Edit Device" : "Add Device"}
            </Text>
            <View style={styles.modalClose} />
          </View>

          <ScrollView contentContainerStyle={styles.modalBody}>
            {field("Name *", "name", "e.g. TRTPIT1")}
            {field("FQDN", "fqdn", "e.g. TRTPIT1.domain.com")}
            {field("IP Address", "ip", "e.g. 10.48.64.65")}
            {field("OS", "os", "e.g. Windows 11 Pro")}
            {field("OS Version", "osVer", "e.g. 25H2")}
            {field("Assigned User", "user", "username")}

            {/* Type picker */}
            <View style={styles.formField}>
              <Text style={[styles.formLabel, { color: theme.mutedText }]}>Type</Text>
              <View style={styles.optionRow}>
                {TYPE_OPTIONS.map((t) => (
                  <Pressable
                    key={t}
                    style={[
                      styles.optionBtn,
                      { borderColor: theme.border, backgroundColor: theme.background },
                      addForm.type === t && { backgroundColor: theme.primary, borderColor: theme.primary },
                    ]}
                    onPress={() => setAddForm((f) => ({ ...f, type: t }))}
                  >
                    <Text style={[styles.optionText, { color: theme.mutedText }, addForm.type === t && { color: "#fff" }]}>
                      {t}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Status picker */}
            <View style={styles.formField}>
              <Text style={[styles.formLabel, { color: theme.mutedText }]}>Status</Text>
              <View style={styles.optionRow}>
                {STATUS_OPTIONS.map((s) => (
                  <Pressable
                    key={s}
                    style={[
                      styles.optionBtn,
                      { borderColor: theme.border, backgroundColor: theme.background },
                      addForm.status === s && { backgroundColor: theme.primary, borderColor: theme.primary },
                    ]}
                    onPress={() => setAddForm((f) => ({ ...f, status: s }))}
                  >
                    <Text style={[styles.optionText, { color: theme.mutedText }, addForm.status === s && { color: "#fff" }]}>
                      {s}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </ScrollView>

          {/* Bottom action buttons */}
          <View style={[styles.modalFooter, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
            <Pressable
              style={[styles.footerBtn, styles.footerCancel, { borderColor: theme.border }]}
              onPress={() => setShowAddModal(false)}
            >
              <Text style={[styles.footerCancelText, { color: theme.mutedText }]}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.footerBtn, styles.footerSave, { backgroundColor: theme.primary }]}
              onPress={saveDevice}
              disabled={addSaving}
            >
              {addSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.footerSaveText}>Save</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Overflow action sheet ── */}
      <Modal
        visible={showOverflowMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowOverflowMenu(false)}
      >
        <Pressable style={styles.overlayCover} onPress={() => setShowOverflowMenu(false)}>
          <View style={[styles.actionSheet, { backgroundColor: theme.card, borderColor: theme.border }]}>
            {isAdmin && (
              <Pressable
                style={styles.actionItem}
                onPress={() => { setShowOverflowMenu(false); pickImportCSV(); }}
              >
                <Ionicons name="cloud-upload-outline" size={20} color={theme.primary} style={{ marginRight: 14 }} />
                <Text style={[styles.actionText, { color: theme.text }]}>Import CSV</Text>
              </Pressable>
            )}
            <Pressable
              style={styles.actionItem}
              onPress={() => { setShowOverflowMenu(false); exportCSV(); }}
            >
              <Ionicons name="download-outline" size={20} color={theme.primary} style={{ marginRight: 14 }} />
              <Text style={[styles.actionText, { color: theme.text }]}>Export CSV</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* ── FAB (admin only) ── */}
      {isAdmin && (
        <Pressable
          style={[styles.fab, { backgroundColor: theme.primary }]}
          onPress={openAddModal}
        >
          <Ionicons name="add" size={28} color="#fff" />
        </Pressable>
      )}

      {/* ── Import preview modal ── */}
      <Modal visible={showImportModal} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { backgroundColor: theme.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
            <Pressable onPress={() => { setShowImportModal(false); setImportPreview([]); }} style={styles.modalClose}>
              <Ionicons name="close" size={22} color={theme.mutedText} />
            </Pressable>
            <Text style={[styles.modalTitle, { color: theme.text }]}>
              Import Preview ({importPreview.length})
            </Text>
            <View style={styles.modalClose} />
          </View>
          <FlatList
            data={importPreview}
            keyExtractor={(_, i) => String(i)}
            contentContainerStyle={styles.modalBody}
            renderItem={({ item }) => (
              <View style={[styles.previewRow, { borderBottomColor: theme.border }]}>
                <Text style={[styles.previewName, { color: theme.text }]}>{item.name}</Text>
                <Text style={[styles.previewMeta, { color: theme.mutedText }]}>
                  {[item.os, item.osVer].filter(Boolean).join(" ")}
                  {item.ip ? ` · ${item.ip}` : ""}
                </Text>
              </View>
            )}
          />
          <View style={[styles.modalFooter, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
            <Pressable
              style={[styles.footerBtn, styles.footerCancel, { borderColor: theme.border }]}
              onPress={() => { setShowImportModal(false); setImportPreview([]); }}
            >
              <Text style={[styles.footerCancelText, { color: theme.mutedText }]}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.footerBtn, styles.footerSave, { backgroundColor: theme.primary }]}
              onPress={commitImport}
              disabled={importSaving}
            >
              {importSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.footerSaveText}>Import {importPreview.length}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },

  iconBtn: { padding: 6 },

  fab: {
    position: "absolute", bottom: 24, right: 20,
    width: 56, height: 56, borderRadius: 28,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25, shadowRadius: 6, elevation: 6,
  },

  overlayCover: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  actionSheet: {
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    borderWidth: 1, paddingTop: 8, paddingBottom: 36,
  },
  actionItem: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16 },
  actionText: { fontSize: 16 },

  searchWrap: {
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
    borderBottomWidth: 1,
  },
  filterRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  countText: { fontSize: 12, fontWeight: "600", marginHorizontal: 6 },
  searchBar: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15 },

  chip: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 99, borderWidth: 1.5, marginRight: 8,
  },
  chipText: { fontSize: 13, fontWeight: "500" },

  list: { padding: 12, gap: 10 },

  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 14, borderWidth: 1.5,
  },
  cardIcon: {
    width: 44, height: 44, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  cardInfo: { flex: 1, minWidth: 0 },
  cardName: { fontSize: 15, fontWeight: "600" },
  cardMeta: { fontSize: 12, marginTop: 2 },
  cardRight: { alignItems: "flex-end", gap: 6 },

  statusDot: { width: 10, height: 10, borderRadius: 5 },

  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  badgeDone: { backgroundColor: "#dcfce7" },
  badgeDoneText: { fontSize: 11, fontWeight: "600", color: "#16a34a" },
  badgeRepair: { backgroundColor: "#fee2e2" },
  badgeRepairText: { fontSize: 11, fontWeight: "600", color: "#dc2626" },
  badgePending: { backgroundColor: "#fff7ed" },
  badgePendingText: { fontSize: 11, fontWeight: "600", color: "#ea580c" },
  badgeNew: { backgroundColor: "#f1f5f9" },
  badgeNewText: { fontSize: 11, fontWeight: "600", color: "#475569" },
  badgeDue: { backgroundColor: "#fef3c7" },
  badgeDueText: { fontSize: 11, fontWeight: "700", color: "#d97706" },
  badgeOverdue: { backgroundColor: "#ffedd5" },
  badgeOverdueText: { fontSize: 11, fontWeight: "700", color: "#ea580c" },

  emptyText: { fontSize: 16, marginTop: 12, textAlign: "center" },
  emptyHint: { fontSize: 13, marginTop: 6, textAlign: "center" },

  modal: { flex: 1 },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingVertical: 14, borderBottomWidth: 1,
  },
  modalClose: { width: 36, alignItems: "center" },
  modalTitle: { fontSize: 17, fontWeight: "700", flex: 1, textAlign: "center" },
  modalCancel: { fontSize: 16 },
  modalSave: { fontSize: 16, fontWeight: "600" },
  modalBody: { padding: 16, gap: 12, paddingBottom: 16 },
  modalFooter: {
    flexDirection: "row", gap: 12,
    paddingHorizontal: 16, paddingVertical: 16, paddingBottom: 32,
    borderTopWidth: 1,
  },
  footerBtn: {
    flex: 1, height: 50, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  footerCancel: { borderWidth: 1.5 },
  footerCancelText: { fontSize: 16, fontWeight: "600" },
  footerSave: {},
  footerSaveText: { fontSize: 16, fontWeight: "700", color: "#fff" },

  formField: { gap: 4 },
  formLabel: { fontSize: 12, fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.4 },
  formInput: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 9, borderWidth: 1.5, fontSize: 15,
  },

  optionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  optionBtn: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1.5,
  },
  optionText: { fontSize: 13, fontWeight: "500" },

  previewRow: { paddingVertical: 10, borderBottomWidth: 1 },
  previewName: { fontSize: 14, fontWeight: "600" },
  previewMeta: { fontSize: 12, marginTop: 2 },
});
