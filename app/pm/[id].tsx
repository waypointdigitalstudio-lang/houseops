// app/pm/[id].tsx — PM Checklist Detail Screen
import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

// ─── Types ────────────────────────────────────────────────────────────────────

type CheckValue = "OK" | "Repair Needed" | "N/A";

interface PmDevice {
  id: string;
  name: string;
  fqdn: string;
  ip: string;
  os: string;
  osVer: string;
  status: string;
  user: string;
  type: string;
  siteId: string;
}

interface LocalRecord {
  checks: Record<string, CheckValue>;
  pmDate: string;
  tech: string;
  dept: string;
  assetNo: string;
  bootErrors: string;
  notes: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function nextDueDate(pmDate: string): string {
  if (!pmDate) return "";
  const d = new Date(pmDate);
  d.setMonth(d.getMonth() + 3);
  return d.toISOString().split("T")[0];
}

function sectionDone(checks: Record<string, CheckValue>, sectionChecks: string[]): number {
  return sectionChecks.filter((c) => checks[c]).length;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PMDetail() {
  const theme = useAppTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile, siteId } = useUserProfile();

  const [device, setDevice] = useState<PmDevice | null>(null);
  const [loadingDevice, setLoadingDevice] = useState(true);
  const [loadingRecord, setLoadingRecord] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);

  // Local editable state
  const [localChecks, setLocalChecks] = useState<Record<string, CheckValue>>({});
  const [localDate, setLocalDate] = useState(today());
  const [localTech, setLocalTech] = useState("");
  const [localDept, setLocalDept] = useState("");
  const [localAssetNo, setLocalAssetNo] = useState("");
  const [localBootErrors, setLocalBootErrors] = useState("");
  const [localNotes, setLocalNotes] = useState("");

  // Ref holds always-current checks to avoid stale closures in rapid taps
  const latestChecks = useRef<Record<string, CheckValue>>({});
  const recordExists = useRef(false);

  const deviceId = String(id ?? "");
  const recordId = siteId && deviceId ? `${siteId}_${deviceId}` : null;

  // ─── Load device (real-time for status) ──────────────────────────────────

  useEffect(() => {
    if (!deviceId) return;
    return onSnapshot(doc(db, "pmDevices", deviceId), (snap) => {
      if (snap.exists()) setDevice({ id: snap.id, ...snap.data() } as PmDevice);
      setLoadingDevice(false);
    });
  }, [deviceId]);

  // ─── Load record (one-time on mount) ─────────────────────────────────────

  useEffect(() => {
    if (!recordId) { setLoadingRecord(false); return; }
    getDoc(doc(db, "pmRecords", recordId)).then((snap) => {
      if (snap.exists()) {
        const d = snap.data() as any;
        const checks = (d.checks || {}) as Record<string, CheckValue>;
        latestChecks.current = checks;
        recordExists.current = true;
        setLocalChecks(checks);
        setLocalDate(d.pmDate || today());
        setLocalTech(d.tech || profile?.name || "");
        setLocalDept(d.dept || "");
        setLocalAssetNo(d.assetNo || "");
        setLocalBootErrors(d.bootErrors || "");
        setLocalNotes(d.notes || "");
      } else {
        setLocalDate(today());
        setLocalTech(profile?.name || "");
      }
      setLoadingRecord(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  // ─── Save helpers ─────────────────────────────────────────────────────────

  const flashSaved = () => {
    setSaveFlash(true);
    setTimeout(() => setSaveFlash(false), 1200);
  };

  const ensureRecord = useCallback(
    async (withChecks: Record<string, CheckValue>) => {
      if (!recordId || !siteId || !deviceId) return;
      if (!recordExists.current) {
        await setDoc(doc(db, "pmRecords", recordId), {
          deviceId,
          deviceName: device?.name || "",
          siteId,
          checks: withChecks,
          pmDate: localDate,
          tech: localTech,
          dept: localDept,
          assetNo: localAssetNo,
          bootErrors: localBootErrors,
          notes: localNotes,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        recordExists.current = true;
      }
    },
    [recordId, siteId, deviceId, device, localDate, localTech, localDept, localAssetNo, localBootErrors, localNotes]
  );

  // ─── Check button press — auto-saves immediately ──────────────────────────

  const setCheck = useCallback(
    async (checkName: string, val: CheckValue) => {
      if (!recordId || !siteId) return;
      const toggling = latestChecks.current[checkName] === val;
      const newChecks = { ...latestChecks.current };
      if (toggling) {
        delete newChecks[checkName];
      } else {
        newChecks[checkName] = val;
      }
      latestChecks.current = newChecks;
      setLocalChecks(newChecks);

      try {
        if (!recordExists.current) {
          await ensureRecord(newChecks);
        } else {
          await updateDoc(doc(db, "pmRecords", recordId), {
            [`checks.${checkName}`]: toggling ? deleteField() : val,
            updatedAt: serverTimestamp(),
          });
        }
        flashSaved();
      } catch {
        Alert.alert("Error", "Failed to save check. Try again.");
      }
    },
    [recordId, siteId, ensureRecord]
  );

  // ─── Save admin info fields ───────────────────────────────────────────────

  const saveAdminInfo = useCallback(async () => {
    if (!recordId || !siteId) return;
    setSaving(true);
    try {
      const payload = {
        deviceId,
        deviceName: device?.name || "",
        siteId,
        pmDate: localDate,
        tech: localTech,
        dept: localDept,
        assetNo: localAssetNo,
        updatedAt: serverTimestamp(),
      };
      if (!recordExists.current) {
        await setDoc(doc(db, "pmRecords", recordId), {
          ...payload,
          checks: latestChecks.current,
          bootErrors: localBootErrors,
          notes: localNotes,
          createdAt: serverTimestamp(),
        });
        recordExists.current = true;
      } else {
        await updateDoc(doc(db, "pmRecords", recordId), payload);
      }
      flashSaved();
    } catch {
      Alert.alert("Error", "Failed to save.");
    }
    setSaving(false);
  }, [recordId, siteId, deviceId, device, localDate, localTech, localDept, localAssetNo, localBootErrors, localNotes]);

  const saveNotes = useCallback(async () => {
    if (!recordId || !siteId || !recordExists.current) return;
    try {
      await updateDoc(doc(db, "pmRecords", recordId), {
        bootErrors: localBootErrors,
        notes: localNotes,
        updatedAt: serverTimestamp(),
      });
      flashSaved();
    } catch {}
  }, [recordId, siteId, localBootErrors, localNotes]);

  // ─── CSV export (single device) ───────────────────────────────────────────

  const exportCSV = async () => {
    if (!device) return;
    try {
      const headers = [
        "Device", "FQDN", "IP", "OS", "OS Version", "User",
        "PM Date", "Tech", "Dept", "Asset No",
        ...ALL_CHECKS, "Boot Errors", "PM Notes",
      ];
      const row = [
        device.name, device.fqdn || "", device.ip || "", device.os || "",
        device.osVer || "", device.user || "",
        localDate, localTech, localDept, localAssetNo,
        ...ALL_CHECKS.map((c) => localChecks[c] || ""),
        localBootErrors, localNotes,
      ];
      const csv = [headers, row]
        .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
        .join("\n");
      const uri = FileSystem.cacheDirectory + `PM_${device.name}_${localDate}.csv`;
      await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: `PM — ${device.name}` });
    } catch {
      Alert.alert("Error", "Export failed.");
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  const loading = loadingDevice || loadingRecord;

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  if (!device) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Text style={{ color: theme.mutedText }}>Device not found.</Text>
      </View>
    );
  }

  const totalChecked = ALL_CHECKS.filter((c) => localChecks[c]).length;
  const repairCount = ALL_CHECKS.filter((c) => localChecks[c] === "Repair Needed").length;

  return (
    <>
      <Stack.Screen
        options={{
          title: device.name,
          headerBackTitle: "PM",
          headerStyle: { backgroundColor: theme.background },
          headerTitleStyle: { color: theme.text, fontWeight: "700" },
          headerRight: () => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              {saveFlash && (
                <Ionicons name="checkmark-circle" size={18} color={theme.primary} />
              )}
              <Pressable onPress={exportCSV}>
                <Ionicons name="download-outline" size={20} color={theme.primary} />
              </Pressable>
            </View>
          ),
        }}
      />

      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Progress summary ── */}
        <View style={[styles.progressCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={styles.progressRow}>
            <Text style={[styles.progressLabel, { color: theme.mutedText }]}>Progress</Text>
            <Text style={[styles.progressCount, { color: theme.text }]}>
              {totalChecked} / {ALL_CHECKS.length}
            </Text>
          </View>
          <View style={[styles.progressBg, { backgroundColor: theme.border }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: repairCount > 0 ? "#ef4444" : theme.primary,
                  width: `${(totalChecked / ALL_CHECKS.length) * 100}%`,
                },
              ]}
            />
          </View>
          {repairCount > 0 && (
            <Text style={styles.repairNote}>
              {repairCount} item{repairCount !== 1 ? "s" : ""} need repair
            </Text>
          )}
          <Text style={[styles.deviceMeta, { color: theme.mutedText }]}>
            {[device.os, device.osVer].filter(Boolean).join(" ")}
            {device.ip ? ` · ${device.ip}` : ""}
            {device.user ? ` · ${device.user}` : ""}
          </Text>
        </View>

        {/* ── Admin info ── */}
        <View style={[styles.section, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.sectionLabel, { color: theme.mutedText }]}>Admin Info</Text>
          <View style={styles.infoGrid}>
            <View style={styles.infoField}>
              <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Date of PM</Text>
              <TextInput
                style={[styles.fieldInput, { backgroundColor: theme.background, borderColor: theme.border, color: theme.text }]}
                value={localDate}
                onChangeText={setLocalDate}
                onBlur={saveAdminInfo}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.mutedText}
              />
            </View>
            <View style={styles.infoField}>
              <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Tech Name</Text>
              <TextInput
                style={[styles.fieldInput, { backgroundColor: theme.background, borderColor: theme.border, color: theme.text }]}
                value={localTech}
                onChangeText={setLocalTech}
                onBlur={saveAdminInfo}
                placeholder="Your name"
                placeholderTextColor={theme.mutedText}
              />
            </View>
            <View style={styles.infoField}>
              <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Department</Text>
              <TextInput
                style={[styles.fieldInput, { backgroundColor: theme.background, borderColor: theme.border, color: theme.text }]}
                value={localDept}
                onChangeText={setLocalDept}
                onBlur={saveAdminInfo}
                placeholder="Dept"
                placeholderTextColor={theme.mutedText}
              />
            </View>
            <View style={styles.infoField}>
              <Text style={[styles.fieldLabel, { color: theme.mutedText }]}>Asset No.</Text>
              <TextInput
                style={[styles.fieldInput, { backgroundColor: theme.background, borderColor: theme.border, color: theme.text }]}
                value={localAssetNo}
                onChangeText={setLocalAssetNo}
                onBlur={saveAdminInfo}
                placeholder="Asset tag"
                placeholderTextColor={theme.mutedText}
              />
            </View>
          </View>
          {localDate ? (
            <Text style={[styles.nextDue, { color: theme.mutedText }]}>
              Next PM due: {nextDueDate(localDate)}
            </Text>
          ) : null}
        </View>

        {/* ── PM Sections ── */}
        {PM_SECTIONS.map((sec, secIdx) => {
          const done = sectionDone(localChecks, sec.checks);
          return (
            <View
              key={sec.title}
              style={[styles.section, { backgroundColor: theme.card, borderColor: theme.border, overflow: "hidden" }]}
            >
              {/* Section header */}
              <View style={[styles.sectionHeader, { backgroundColor: sec.color }]}>
                <Text style={styles.sectionTitle}>{sec.title}</Text>
                <Text style={styles.sectionProgress}>
                  {done}/{sec.checks.length}
                </Text>
              </View>

              {/* Check items */}
              {sec.checks.map((checkName) => {
                const val = localChecks[checkName];
                return (
                  <View
                    key={checkName}
                    style={[
                      styles.checkRow,
                      { borderTopColor: theme.border },
                      val === "Repair Needed" && styles.checkRowRepair,
                    ]}
                  >
                    <Text style={[styles.checkLabel, { color: theme.text }, val === "Repair Needed" && { color: "#dc2626" }]}>
                      {checkName}
                    </Text>
                    <View style={styles.btnGroup}>
                      <Pressable
                        style={[styles.checkBtn, { borderColor: theme.border, backgroundColor: theme.background }, val === "OK" && styles.btnOK]}
                        onPress={() => setCheck(checkName, "OK")}
                      >
                        <Text style={[styles.checkBtnText, { color: theme.mutedText }, val === "OK" && styles.btnOKText]}>
                          OK
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.checkBtn, { borderColor: theme.border, backgroundColor: theme.background }, val === "Repair Needed" && styles.btnRepair]}
                        onPress={() => setCheck(checkName, "Repair Needed")}
                      >
                        <Ionicons
                          name="warning-outline"
                          size={14}
                          color={val === "Repair Needed" ? "#fff" : theme.mutedText}
                        />
                      </Pressable>
                      <Pressable
                        style={[styles.checkBtn, { borderColor: theme.border, backgroundColor: theme.background }, val === "N/A" && styles.btnNA]}
                        onPress={() => setCheck(checkName, "N/A")}
                      >
                        <Text style={[styles.checkBtnText, { color: theme.mutedText }, val === "N/A" && styles.btnNAText]}>
                          N/A
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}

              {/* Boot errors textarea in section 1 */}
              {secIdx === 0 && (
                <View style={[styles.notesWrap, { borderTopColor: theme.border }]}>
                  <Text style={[styles.fieldLabel, { color: theme.mutedText, marginBottom: 6 }]}>
                    Boot Errors Noted (if any)
                  </Text>
                  <TextInput
                    style={[styles.textarea, { backgroundColor: theme.background, borderColor: theme.border, color: theme.text }]}
                    value={localBootErrors}
                    onChangeText={setLocalBootErrors}
                    onBlur={saveNotes}
                    placeholder="Describe any boot errors…"
                    placeholderTextColor={theme.mutedText}
                    multiline
                    numberOfLines={3}
                  />
                </View>
              )}
            </View>
          );
        })}

        {/* ── General PM Notes ── */}
        <View style={[styles.section, { backgroundColor: theme.card, borderColor: theme.border, overflow: "hidden" }]}>
          <View style={[styles.sectionHeader, { backgroundColor: "#3D3D3D" }]}>
            <Text style={styles.sectionTitle}>PM Notes</Text>
          </View>
          <View style={[styles.notesWrap, { borderTopWidth: 0 }]}>
            <TextInput
              style={[styles.textarea, { backgroundColor: theme.background, borderColor: theme.border, color: theme.text, height: 120 }]}
              value={localNotes}
              onChangeText={setLocalNotes}
              onBlur={saveNotes}
              placeholder="General notes, issues found, actions taken…"
              placeholderTextColor={theme.mutedText}
              multiline
            />
          </View>
        </View>

        {/* ── Save button (manual, for admin info) ── */}
        <Pressable
          style={[styles.saveBtn, { backgroundColor: theme.primary }, saving && { opacity: 0.7 }]}
          onPress={saveAdminInfo}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>Save Admin Info</Text>
          )}
        </Pressable>
      </ScrollView>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scrollContent: { padding: 14, gap: 12, paddingBottom: 40 },

  progressCard: {
    borderRadius: 14, borderWidth: 1.5,
    padding: 14,
  },
  progressRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  progressLabel: { fontSize: 13, fontWeight: "500" },
  progressCount: { fontSize: 13, fontWeight: "700" },
  progressBg: { height: 6, borderRadius: 99, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 99 },
  repairNote: { fontSize: 12, color: "#dc2626", marginTop: 6, fontWeight: "600" },
  deviceMeta: { fontSize: 12, marginTop: 6 },

  section: { borderRadius: 14, borderWidth: 1.5 },
  sectionLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, padding: 12, paddingBottom: 10 },

  sectionHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 10,
  },
  sectionTitle: { color: "#fff", fontSize: 13, fontWeight: "700" },
  sectionProgress: { color: "rgba(255,255,255,0.8)", fontSize: 12 },

  checkRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 12,
    borderTopWidth: 1, gap: 10,
  },
  checkRowRepair: { backgroundColor: "#fff1f2" },
  checkLabel: { flex: 1, fontSize: 14 },

  btnGroup: { flexDirection: "row", gap: 6 },
  checkBtn: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 7, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
    minWidth: 36,
  },
  checkBtnText: { fontSize: 12, fontWeight: "600" },

  btnOK: { backgroundColor: "#dcfce7", borderColor: "#22c55e" },
  btnOKText: { color: "#16a34a" },
  btnRepair: { backgroundColor: "#ef4444", borderColor: "#ef4444" },
  btnNA: { backgroundColor: "#e2e8f0", borderColor: "#94a3b8" },
  btnNAText: { color: "#475569" },

  notesWrap: { padding: 14, borderTopWidth: 1 },
  fieldLabel: { fontSize: 12, fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.4 },
  textarea: {
    borderWidth: 1.5, borderRadius: 9, padding: 10,
    fontSize: 14, minHeight: 80, textAlignVertical: "top",
  },

  infoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, padding: 12, paddingTop: 0 },
  infoField: { width: "47%" },
  fieldInput: {
    borderWidth: 1.5, borderRadius: 9, padding: 10,
    fontSize: 14,
  },
  nextDue: { fontSize: 12, paddingHorizontal: 12, paddingBottom: 12 },

  saveBtn: {
    padding: 14, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
    marginTop: 4,
  },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
