// app/(tabs)/explore.tsx
import { useIsFocused } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { collection, getDocs, query, where } from "firebase/firestore";
import { useAppTheme } from "../../constants/theme";
import { db } from "../../firebaseConfig";

type FoundItem = { id: string } & Record<string, any>;

export default function ExploreScreen() {
  const theme = useAppTheme();

  const router = useRouter();
  const isFocused = useIsFocused();

  const [permission, requestPermission] = useCameraPermissions();

  const [scanningEnabled, setScanningEnabled] = useState(true);
  const [busy, setBusy] = useState(false);

  // prevents duplicate fires (common on iOS)
  const lastScanRef = useRef<{ data: string; at: number } | null>(null);

  useEffect(() => {
    if (!isFocused) {
      setScanningEnabled(false);
      setBusy(false);
    } else {
      setScanningEnabled(true);
    }
  }, [isFocused]);

  const ensurePermission = async () => {
    const res = await requestPermission();
    if (!res.granted) {
      Alert.alert(
        "Camera permission needed",
        "Enable camera permission to use the scanner."
      );
    }
  };

  const lookupItemByBarcode = async (
    barcode: string
  ): Promise<FoundItem | null> => {
    const clean = String(barcode).trim();
    if (!clean) return null;

    const qy = query(collection(db, "items"), where("barcode", "==", clean));
    const snap = await getDocs(qy);

    if (snap.empty) return null;

    const docSnap = snap.docs[0];
    return { id: docSnap.id, ...docSnap.data() };
  };

  const handleBarcodeScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (!scanningEnabled || busy) return;

      // anti-duplicate: same code within 1.5s
      const now = Date.now();
      const last = lastScanRef.current;
      if (last && last.data === data && now - last.at < 1500) return;
      lastScanRef.current = { data, at: now };

      setBusy(true);
      setScanningEnabled(false);

      try {
        const cleanBarcode = String(data).trim();
        const found = await lookupItemByBarcode(cleanBarcode);

        if (!found?.id) {
          Alert.alert("Not found", `No item has barcode:\n${cleanBarcode}`, [
            {
              text: "Add to inventory",
              onPress: () =>
                router.push({
                  pathname: "/add-item",
                  params: { barcode: cleanBarcode },
                }),
            },
            { text: "Scan again", onPress: () => setScanningEnabled(true) },
            { text: "Cancel", style: "cancel" },
          ]);
          return;
        }

        router.push(`/item/${found.id}`);
      } catch (e) {
        console.error("Barcode lookup failed:", e);
        Alert.alert("Scan failed", "Could not look up that barcode. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [scanningEnabled, busy, router]
  );

  if (!permission) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <StatusBar style="auto" />
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={[styles.mutedText, { color: theme.mutedText }]}>
            Checking camera permission…
          </Text>
        </View>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <StatusBar style="auto" />
        <Text style={[styles.title, { color: theme.text }]}>Scan</Text>
        <Text style={[styles.subtitle, { color: theme.mutedText }]}>
          Camera permission is required.
        </Text>

        <Pressable
          style={[
            styles.button,
            { backgroundColor: theme.tint, opacity: busy ? 0.7 : 1 },
          ]}
          onPress={ensurePermission}
        >
          <Text style={[styles.buttonText, { color: "#000" }]}>Enable camera</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <StatusBar style="auto" />

      <Text style={[styles.title, { color: theme.text }]}>Scan</Text>
      <Text style={[styles.subtitle, { color: theme.mutedText }]}>
        Scan a barcode to find or add an item
      </Text>

      <View
        style={[
          styles.cameraFrame,
          {
            borderColor: theme.border,
            backgroundColor: theme.card,
          },
        ]}
      >
        {isFocused ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            onBarcodeScanned={scanningEnabled ? handleBarcodeScanned : undefined}
          />
        ) : (
          <View
            style={[
              StyleSheet.absoluteFill,
              styles.cameraPaused,
              { backgroundColor: theme.card },
            ]}
          />
        )}

        <View
          style={[
            styles.overlay,
            {
              borderColor: theme.border,
              backgroundColor: "rgba(0,0,0,0.45)", // keep readable over camera
            },
          ]}
        >
          <Text style={[styles.overlayText, { color: "#fff" }]}>
            {busy
              ? "Looking up barcode…"
              : scanningEnabled
              ? "Point at a barcode"
              : "Paused"}
          </Text>

          <Pressable
            style={[
              styles.smallButton,
              { backgroundColor: theme.tint },
              (!isFocused || busy) && { opacity: 0.5 },
            ]}
            onPress={() => {
              if (!isFocused || busy) return;
              setScanningEnabled(true);
            }}
            disabled={!isFocused || busy}
          >
            <Text style={[styles.smallButtonText, { color: "#000" }]}>
              {busy ? "Please wait…" : "Scan again"}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 16,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 12,
  },
  cameraFrame: {
    flex: 1,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
  },
  overlay: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  overlayText: {
    fontWeight: "700",
    marginBottom: 10,
  },
  smallButton: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  smallButtonText: {
    fontWeight: "800",
    fontSize: 12,
  },
  cameraPaused: {},
  center: {
    marginTop: 40,
    alignItems: "center",
  },
  mutedText: {
    marginTop: 8,
  },
  button: {
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: "center",
  },
  buttonText: {
    fontWeight: "800",
  },
});
