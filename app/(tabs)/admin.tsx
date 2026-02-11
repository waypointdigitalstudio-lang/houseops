// app/(tabs)/admin.tsx
import { sendPasswordResetEmail } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { useAppTheme } from "../../constants/theme";
import { auth, db } from "../../firebaseConfig";
import { useUserProfile } from "../../hooks/useUserProfile";

type SiteRow = {
  id: string;
  name?: string;
  label?: string;
};

type UserRow = {
  uid: string;
  siteId?: string;
  role?: "admin" | "staff";
  email?: string;
  name?: string;
  createdAt?: any;
};

function SelectModal<T>({
  visible,
  title,
  items,
  getKey,
  renderRow,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  items: T[];
  getKey: (item: T) => string;
  renderRow: (item: T) => React.ReactNode;
  onPick: (item: T) => void;
  onClose: () => void;
}) {
  const theme = useAppTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.55)",
          padding: 18,
          justifyContent: "center",
        }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: theme.card,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: theme.border,
            maxHeight: "75%",
            overflow: "hidden",
          }}
        >
          <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: theme.border }}>
            <Text style={{ color: theme.text, fontWeight: "900", fontSize: 16 }}>{title}</Text>
            <Text style={{ color: theme.mutedText, marginTop: 4, fontSize: 12 }}>
              Tap one to select
            </Text>
          </View>

          <ScrollView>
            {items.map((it) => (
              <Pressable
                key={getKey(it)}
                onPress={() => onPick(it)}
                style={({ pressed }) => ({
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.border,
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                {renderRow(it)}
              </Pressable>
            ))}
          </ScrollView>

          <Pressable
            onPress={onClose}
            style={({ pressed }) => ({
              padding: 12,
              borderTopWidth: 1,
              borderTopColor: theme.border,
              opacity: pressed ? 0.75 : 1,
              alignItems: "center",
            })}
          >
            <Text style={{ color: theme.tint, fontWeight: "900" }}>Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function AdminScreen() {
  const theme = useAppTheme();
  const { profile } = useUserProfile();

  const role = profile?.role ?? "staff";
  const isAdmin = role === "admin";

  const [sites, setSites] = useState<SiteRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [userModalOpen, setUserModalOpen] = useState(false);
  const [siteModalOpen, setSiteModalOpen] = useState(false);
  const [manageUserModalOpen, setManageUserModalOpen] = useState(false);

  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [userToManage, setUserToManage] = useState<UserRow | null>(null);

  const [alsoUpdateTokens, setAlsoUpdateTokens] = useState(true);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);

        // --- Sites ---
        const sitesSnap = await getDocs(collection(db, "sites"));
        const siteList: SiteRow[] = sitesSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        }));

        // --- Users ---
        const usersQ = query(collection(db, "users"), limit(200));
        const usersSnap = await getDocs(usersQ);

        const userList: UserRow[] = usersSnap.docs.map((d) => ({
          uid: d.id,
          ...(d.data() as any),
        }));

        if (!alive) return;
        setSites(siteList);
        setUsers(userList);
      } catch (e) {
        console.log("Admin load error:", e);
        Alert.alert("Load failed", "Could not load admin data.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const selectedSiteLabel = useMemo(() => {
    if (!selectedSiteId) return null;
    const s = sites.find((x) => x.id === selectedSiteId);
    return s?.label || s?.name || selectedSiteId;
  }, [selectedSiteId, sites]);

  const handleSaveSiteAssignment = async () => {
    if (!isAdmin) {
      Alert.alert("Not allowed", "This account is not an admin.");
      return;
    }

    if (!selectedUser) {
      Alert.alert("Pick a user", "Select a user first.");
      return;
    }

    if (!selectedSiteId) {
      Alert.alert("Pick a site", "Select a site first.");
      return;
    }

    setSaving(true);
    try {
      await updateDoc(doc(db, "users", selectedUser.uid), {
        siteId: selectedSiteId,
        updatedAt: serverTimestamp(),
      });

      if (alsoUpdateTokens) {
        const tokQ = query(
          collection(db, "devicePushTokens"),
          where("uid", "==", selectedUser.uid)
        );
        const tokSnap = await getDocs(tokQ);

        const updates = tokSnap.docs.map((d) =>
          updateDoc(doc(db, "devicePushTokens", d.id), {
            siteId: selectedSiteId,
            updatedAt: serverTimestamp(),
          })
        );

        await Promise.all(updates);
      }

      Alert.alert("Saved", `Updated ${selectedUser.email || selectedUser.uid} → ${selectedSiteId}`);

      setUsers((prev) =>
        prev.map((u) =>
          u.uid === selectedUser.uid ? { ...u, siteId: selectedSiteId } : u
        )
      );
      setSelectedUser((prev) => (prev ? { ...prev, siteId: selectedSiteId } : prev));
    } catch (e) {
      console.log("Admin save error:", e);
      Alert.alert("Save failed", "Could not update user siteId.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUser = async (user: UserRow) => {
    Alert.alert(
      "Delete User",
      `Are you sure you want to delete ${user.email || user.uid}? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              // Delete user document
              await deleteDoc(doc(db, "users", user.uid));

              // Delete associated device tokens
              const tokQ = query(
                collection(db, "devicePushTokens"),
                where("uid", "==", user.uid)
              );
              const tokSnap = await getDocs(tokQ);
              const deletions = tokSnap.docs.map((d) => deleteDoc(doc(db, "devicePushTokens", d.id)));
              await Promise.all(deletions);

              Alert.alert("Deleted", "User and associated data have been removed.");
              
              // Update local list
              setUsers((prev) => prev.filter((u) => u.uid !== user.uid));
              setManageUserModalOpen(false);
            } catch (e) {
              console.log("Delete user error:", e);
              Alert.alert("Delete failed", "Could not delete user. Note: This does not delete the Firebase Auth account, only the user profile.");
            }
          },
        },
      ]
    );
  };

  const handleChangeRole = async (user: UserRow, newRole: "admin" | "staff") => {
    try {
      await updateDoc(doc(db, "users", user.uid), {
        role: newRole,
        updatedAt: serverTimestamp(),
      });

      Alert.alert("Updated", `Role changed to ${newRole}`);
      
      // Update local list
      setUsers((prev) =>
        prev.map((u) => (u.uid === user.uid ? { ...u, role: newRole } : u))
      );
      setUserToManage((prev) => (prev ? { ...prev, role: newRole } : prev));
    } catch (e) {
      console.log("Change role error:", e);
      Alert.alert("Failed", "Could not change user role.");
    }
  };

  const handleSendPasswordReset = async (user: UserRow) => {
    if (!user.email) {
      Alert.alert("No email", "This user doesn't have an email address.");
      return;
    }

    try {
      await sendPasswordResetEmail(auth, user.email);
      Alert.alert("Sent", `Password reset email sent to ${user.email}`);
    } catch (e: any) {
      console.log("Password reset error:", e);
      Alert.alert("Failed", e.message || "Could not send password reset email.");
    }
  };

  if (!isAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, padding: 16 }}>
        <Text style={{ color: theme.text, fontSize: 22, fontWeight: "900" }}>
          Admin
        </Text>
        <Text style={{ color: theme.mutedText, marginTop: 10 }}>
          You don't have access to this screen.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, padding: 16 }}>
        <Text style={{ color: theme.text, fontSize: 22, fontWeight: "900" }}>
          Admin
        </Text>
        <View style={{ marginTop: 16, alignItems: "center" }}>
          <ActivityIndicator />
          <Text style={{ color: theme.mutedText, marginTop: 10 }}>Loading…</Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ padding: 16 }}>
        <Text style={{ color: theme.text, fontSize: 22, fontWeight: "900" }}>
          Admin
        </Text>
        <Text style={{ color: theme.mutedText, marginTop: 6 }}>
          Manage users and site assignments
        </Text>

        {/* USER LIST */}
        <View
          style={{
            marginTop: 16,
            backgroundColor: theme.card,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: theme.border,
            padding: 14,
          }}
        >
          <Text style={{ color: theme.text, fontWeight: "900", fontSize: 16 }}>
            All Users ({users.length})
          </Text>
          <Text style={{ color: theme.mutedText, fontSize: 12, marginTop: 4 }}>
            Tap a user to manage their account
          </Text>

          <View style={{ marginTop: 12 }}>
            {users.map((user) => (
              <Pressable
                key={user.uid}
                onPress={() => {
                  setUserToManage(user);
                  setManageUserModalOpen(true);
                }}
                style={({ pressed }) => ({
                  padding: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.border,
                  marginBottom: 8,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ color: theme.text, fontWeight: "900" }}>
                  {user.email || user.name || "No email"}
                </Text>
                <Text style={{ color: theme.mutedText, fontSize: 12, marginTop: 4 }}>
                  Site: {user.siteId || "Unassigned"} • Role: {user.role || "staff"}
                </Text>
                <Text style={{ color: theme.mutedText, fontSize: 10, marginTop: 2 }}>
                  UID: {user.uid}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* SITE ASSIGNMENT SECTION */}
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: "900", marginTop: 24 }}>
          Reassign User Site
        </Text>

        <View
          style={{
            marginTop: 12,
            backgroundColor: theme.card,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: theme.border,
            padding: 14,
          }}
        >
          <Text style={{ color: theme.mutedText, fontSize: 12 }}>User</Text>

          <Pressable
            onPress={() => setUserModalOpen(true)}
            style={({ pressed }) => ({
              marginTop: 10,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: theme.border,
              paddingVertical: 12,
              paddingHorizontal: 12,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ color: theme.text, fontWeight: "900" }}>
              {selectedUser
                ? selectedUser.email || selectedUser.name || selectedUser.uid
                : "Select a user…"}
            </Text>

            <Text style={{ color: theme.mutedText, marginTop: 4, fontSize: 12 }}>
              Current site: {selectedUser?.siteId ?? "Unassigned"} • Role:{" "}
              {selectedUser?.role ?? "staff"}
            </Text>
          </Pressable>
        </View>

        <View
          style={{
            marginTop: 12,
            backgroundColor: theme.card,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: theme.border,
            padding: 14,
          }}
        >
          <Text style={{ color: theme.mutedText, fontSize: 12 }}>Site</Text>

          <Pressable
            onPress={() => setSiteModalOpen(true)}
            style={({ pressed }) => ({
              marginTop: 10,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: theme.border,
              paddingVertical: 12,
              paddingHorizontal: 12,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ color: theme.text, fontWeight: "900" }}>
              {selectedSiteLabel ?? "Select a site…"}
            </Text>
            <Text style={{ color: theme.mutedText, marginTop: 4, fontSize: 12 }}>
              siteId: {selectedSiteId ?? "—"}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setAlsoUpdateTokens((v) => !v)}
            style={({ pressed }) => ({
              marginTop: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: alsoUpdateTokens ? theme.tint : theme.border,
              paddingVertical: 12,
              paddingHorizontal: 12,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ color: theme.text, fontWeight: "900" }}>
              {alsoUpdateTokens ? "✅" : "⬜"} Also update this user's device tokens
            </Text>
            <Text style={{ color: theme.mutedText, marginTop: 4, fontSize: 12 }}>
              (Recommended so push stays scoped to the new site)
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={handleSaveSiteAssignment}
          disabled={saving || !selectedUser || !selectedSiteId}
          style={({ pressed }) => ({
            marginTop: 16,
            backgroundColor: theme.tint,
            borderRadius: 999,
            paddingVertical: 12,
            alignItems: "center",
            opacity:
              saving || !selectedUser || !selectedSiteId ? 0.6 : pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: "#000", fontWeight: "900" }}>
            {saving ? "Saving…" : "Save site assignment"}
          </Text>
        </Pressable>

        <View style={{ height: 40 }} />
      </View>

      {/* USER MODAL */}
      <SelectModal<UserRow>
        visible={userModalOpen}
        title="Select User"
        items={users}
        getKey={(u) => u.uid}
        renderRow={(u) => (
          <View>
            <Text style={{ color: theme.text, fontWeight: "900" }}>
              {u.email || u.name || u.uid}
            </Text>
            <Text style={{ color: theme.mutedText, marginTop: 2, fontSize: 12 }}>
              site: {u.siteId ?? "Unassigned"} • role: {u.role ?? "staff"}
            </Text>
          </View>
        )}
        onPick={(u) => {
          setSelectedUser(u);
          setSelectedSiteId(u.siteId ?? null);
          setUserModalOpen(false);
        }}
        onClose={() => setUserModalOpen(false)}
      />

      {/* SITE MODAL */}
      <SelectModal<SiteRow>
        visible={siteModalOpen}
        title="Select Site"
        items={sites}
        getKey={(s) => s.id}
        renderRow={(s) => (
          <View>
            <Text style={{ color: theme.text, fontWeight: "900" }}>
              {s.label || s.name || s.id}
            </Text>
            <Text style={{ color: theme.mutedText, marginTop: 2, fontSize: 12 }}>
              siteId: {s.id}
            </Text>
          </View>
        )}
        onPick={(s) => {
          setSelectedSiteId(s.id);
          setSiteModalOpen(false);
        }}
        onClose={() => setSiteModalOpen(false)}
      />

      {/* MANAGE USER MODAL */}
      <Modal
        visible={manageUserModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setManageUserModalOpen(false)}
      >
        <Pressable
          onPress={() => setManageUserModalOpen(false)}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.55)",
            padding: 18,
            justifyContent: "center",
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: theme.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: theme.border,
              padding: 16,
            }}
          >
            {userToManage && (
              <>
                <Text style={{ color: theme.text, fontWeight: "900", fontSize: 18 }}>
                  {userToManage.email || userToManage.name || "User"}
                </Text>
                <Text style={{ color: theme.mutedText, fontSize: 12, marginTop: 4 }}>
                  Site: {userToManage.siteId || "Unassigned"} • Role: {userToManage.role || "staff"}
                </Text>
                <Text style={{ color: theme.mutedText, fontSize: 10, marginTop: 2 }}>
                  UID: {userToManage.uid}
                </Text>

                {/* Change Role */}
                <View style={{ marginTop: 16 }}>
                  <Text style={{ color: theme.mutedText, fontSize: 12, marginBottom: 8 }}>
                    Change Role
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable
                      onPress={() => handleChangeRole(userToManage, "staff")}
                      disabled={userToManage.role === "staff"}
                      style={({ pressed }) => ({
                        flex: 1,
                        padding: 12,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: userToManage.role === "staff" ? theme.tint : theme.border,
                        opacity: userToManage.role === "staff" ? 0.6 : pressed ? 0.7 : 1,
                        alignItems: "center",
                      })}
                    >
                      <Text style={{ color: theme.text, fontWeight: "900" }}>Staff</Text>
                    </Pressable>

                    <Pressable
                      onPress={() => handleChangeRole(userToManage, "admin")}
                      disabled={userToManage.role === "admin"}
                      style={({ pressed }) => ({
                        flex: 1,
                        padding: 12,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: userToManage.role === "admin" ? theme.tint : theme.border,
                        opacity: userToManage.role === "admin" ? 0.6 : pressed ? 0.7 : 1,
                        alignItems: "center",
                      })}
                    >
                      <Text style={{ color: theme.text, fontWeight: "900" }}>Admin</Text>
                    </Pressable>
                  </View>
                </View>

                {/* Send Password Reset */}
                {userToManage.email && (
                  <Pressable
                    onPress={() => handleSendPasswordReset(userToManage)}
                    style={({ pressed }) => ({
                      marginTop: 12,
                      padding: 12,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: theme.border,
                      alignItems: "center",
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ color: theme.text, fontWeight: "900" }}>
                      Send Password Reset Email
                    </Text>
                  </Pressable>
                )}

                {/* Delete User */}
                <Pressable
                  onPress={() => handleDeleteUser(userToManage)}
                  style={({ pressed }) => ({
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 12,
                    backgroundColor: "#ff3b30",
                    alignItems: "center",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ color: "#fff", fontWeight: "900" }}>Delete User</Text>
                </Pressable>

                {/* Close */}
                <Pressable
                  onPress={() => setManageUserModalOpen(false)}
                  style={({ pressed }) => ({
                    marginTop: 16,
                    padding: 12,
                    alignItems: "center",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ color: theme.tint, fontWeight: "900" }}>Close</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}