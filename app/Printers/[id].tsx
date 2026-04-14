import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import {
    collection,
    doc,
    increment,
    onSnapshot,
    query,
    serverTimestamp,
    updateDoc,
    where
} from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Linking,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useAppTheme } from "../../constants/theme";
import { auth, db } from "../../firebaseConfig";

interface Printer {
  id: string;
  name: string;
  location?: string;
  ipAddress?: string;
  serial?: string;
  assetNumber?: string;
  siteId: string;
}

interface Toner {
  id: string;
  model: string;
  quantity: number;
  minQuantity: number;
  color: string;
}

export default function PrinterDetail() {
  const theme = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [printer, setPrinter] = useState<Printer | null>(null);
  const [linkedToners, setLinkedToners] = useState<Toner[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(doc(db, "printers", id), (snap) => {
      if (snap.exists()) {
        setPrinter({ id: snap.id, ...snap.data() } as Printer);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [id]);

  // Automatically find toners linked to this printer name
  useEffect(() => {
    if (!printer?.name || !printer?.siteId) return;
    const q = query(
      collection(db, "toners"),
      where("siteId", "==", printer.siteId),
      where("printer", "==", printer.name),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Toner));
      setLinkedToners(list);
    });
    return () => unsub();
  }, [printer?.name, printer?.siteId]);

  const openWebUI = () => {
    if (printer?.ipAddress) {
      Linking.openURL(`http://${printer.ipAddress}`).catch(() => 
        Alert.alert("Error", "Could not open Printer Web UI. Make sure you are on the same network.")
      );
    }
  };

  const deductToner = async (toner: Toner) => {
    if (toner.quantity <= 0) {
      Alert.alert("Out of Stock", "Cannot deduct. Stock is already 0.");
      return;
    }

    Alert.alert("Confirm", `Deduct 1 ${toner.model} for this printer?`, [
      { text: "Cancel", style: "cancel" },
      { 
        text: "Confirm", 
        onPress: async () => {
          try {
            const user = auth.currentUser;
            const userName = user?.displayName || user?.email || "Unknown Tech";
            
            // 1. Update Toner Quantity
            await updateDoc(doc(db, "toners", toner.id), {
              quantity: increment(-1),
              updatedAt: serverTimestamp()
            });

            // 2. Log the movement (Optional: you can add a movements subcollection to toners too)
            if (__DEV__) console.log(`Toner ${toner.model} deducted by ${userName}`);
            
            Alert.alert("Success", "Toner deducted from inventory.");
          } catch (e) {
            Alert.alert("Error", "Failed to update stock.");
          }
        }
      }
    ]);
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" /></View>;
  if (!printer) return <View style={styles.center}><Text style={{color: theme.text}}>Printer not found.</Text></View>;

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: printer.name, headerTintColor: theme.text }} />

      {/* Printer Info Card */}
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.label, { color: theme.mutedText }]}>Location</Text>
        <Text style={[styles.value, { color: theme.text }]}>{printer.location || "Not set"}</Text>
        
        <View style={styles.divider} />
        
        <Text style={[styles.label, { color: theme.mutedText }]}>IP Address</Text>
        <View style={styles.row}>
          <Text style={[styles.value, { color: theme.tint, flex: 1 }]}>{printer.ipAddress || "No IP"}</Text>
          {printer.ipAddress && (
            <Pressable style={styles.actionBtn} onPress={openWebUI}>
              <Ionicons name="globe-outline" size={20} color="#fff" />
              <Text style={styles.actionBtnText}>Open UI</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Toner Section */}
      <Text style={[styles.sectionTitle, { color: theme.text }]}>Linked Toners</Text>
      {linkedToners.length === 0 ? (
        <Text style={{ color: theme.mutedText, paddingHorizontal: 4 }}>No toners linked to this printer model.</Text>
      ) : (
        linkedToners.map(toner => (
          <View key={toner.id} style={[styles.card, { backgroundColor: theme.card, borderColor: toner.quantity <= toner.minQuantity ? "#ef4444" : theme.border }]}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.value, { color: theme.text }]}>{toner.model}</Text>
                <Text style={{ color: theme.mutedText, fontSize: 12 }}>Stock: {toner.quantity}</Text>
              </View>
              <Pressable 
                style={[styles.deductBtn, { backgroundColor: theme.primary }]} 
                onPress={() => deductToner(toner)}
              >
                <Text style={styles.deductBtnText}>Deduct 1</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}

      {/* Maintenance Section Placeholder */}
      <Text style={[styles.sectionTitle, { color: theme.text, marginTop: 20 }]}>Maintenance Log</Text>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border, borderStyle: 'dashed' }]}>
        <Text style={{ color: theme.mutedText, textAlign: 'center' }}>Maintenance history coming soon...</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  value: { fontSize: 18, fontWeight: '800' },
  divider: { height: 1, backgroundColor: '#333', marginVertical: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '800', marginBottom: 10, marginTop: 10 },
  actionBtn: { backgroundColor: '#007AFF', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, gap: 6 },
  actionBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  deductBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  deductBtnText: { color: '#fff', fontWeight: '900', fontSize: 13 },
});