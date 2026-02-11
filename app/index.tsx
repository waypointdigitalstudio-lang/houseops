// app/index.tsx
import { useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { auth } from "../firebaseConfig";

export default function Index() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      // If signed in -> go to tabs
      if (user) {
        router.replace("/(tabs)");
      } else {
        // If signed out -> go to login
        router.replace("/login");
      }
      setChecking(false);
    });

    return () => unsub();
  }, [router]);

  if (!checking) return null;

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );
}
