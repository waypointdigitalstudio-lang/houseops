// app/signup.tsx
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import React, { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { Toast } from "../components/Toast";
import { useAppTheme } from "../constants/theme";
import { auth, db } from "../firebaseConfig";
import { useToast } from "../hooks/useToast";

const SITES = [
  { id: "ballys_tiverton", label: "Tiverton" },
  { id: "ballys_lincoln", label: "Lincoln" },
];

export default function SignUpScreen() {
  const theme = useAppTheme();
  
  // Toast hook
  const { toast, fadeAnim, showToast, hideToast } = useToast();
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [selectedSite, setSelectedSite] = useState<string>("ballys_tiverton");
  const [busy, setBusy] = useState(false);

  const signUp = async () => {
    // Validation
    if (!name.trim()) {
      showToast("Please enter your name", "error");
      return;
    }
    if (!email.trim() || !password) {
      showToast("Please enter email and password", "error");
      return;
    }
    if (password.length < 6) {
      showToast("Password must be at least 6 characters", "error");
      return;
    }
    if (password !== confirmPassword) {
      showToast("Passwords don't match", "error");
      return;
    }
    if (!selectedSite) {
      showToast("Please select your site", "error");
      return;
    }

    setBusy(true);
    try {
      // Create Firebase Auth user
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );

      // Create user profile in Firestore with selected site
      await setDoc(doc(db, "users", userCredential.user.uid), {
        name: name.trim(),
        email: email.trim(),
        role: "staff",
        siteId: selectedSite,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      showToast("✓ Account created successfully!", "success");
      
      setTimeout(() => {
        router.replace("/(tabs)");
      }, 1500);
    } catch (e: any) {
      let message = "Please try again.";
      if (e?.code === "auth/email-already-in-use") {
        message = "This email is already registered. Try logging in instead.";
      } else if (e?.code === "auth/invalid-email") {
        message = "Invalid email address.";
      }
      showToast(message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 16,
          backgroundColor: theme.background,
        }}
      >
        <StatusBar style="auto" />

      <Text style={{ color: theme.text, fontSize: 26, fontWeight: "900" }}>
        Create Account
      </Text>
      <Text style={{ color: theme.mutedText, marginTop: 6 }}>
        Sign up to get started
      </Text>

      <TextInput
        style={{
          marginTop: 14,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 12,
          padding: 12,
          color: theme.text,
        }}
        placeholder="Full Name"
        placeholderTextColor={theme.mutedText}
        value={name}
        onChangeText={setName}
      />

      <TextInput
        style={{
          marginTop: 10,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 12,
          padding: 12,
          color: theme.text,
        }}
        placeholder="Email"
        placeholderTextColor={theme.mutedText}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />

      <TextInput
        style={{
          marginTop: 10,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 12,
          padding: 12,
          color: theme.text,
        }}
        placeholder="Password (min 6 characters)"
        placeholderTextColor={theme.mutedText}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <TextInput
        style={{
          marginTop: 10,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 12,
          padding: 12,
          color: theme.text,
        }}
        placeholder="Confirm Password"
        placeholderTextColor={theme.mutedText}
        secureTextEntry
        value={confirmPassword}
        onChangeText={setConfirmPassword}
      />

      {/* Site Selection */}
      <View style={{ marginTop: 14 }}>
        <Text style={{ color: theme.text, fontSize: 14, fontWeight: "700", marginBottom: 8 }}>
          Select Your Site
        </Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {SITES.map((site) => (
            <Pressable
              key={site.id}
              onPress={() => setSelectedSite(site.id)}
              style={{
                flex: 1,
                paddingVertical: 12,
                paddingHorizontal: 16,
                borderRadius: 12,
                borderWidth: 2,
                borderColor: selectedSite === site.id ? theme.tint : theme.border,
                backgroundColor: selectedSite === site.id ? theme.card : "transparent",
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: selectedSite === site.id ? theme.tint : theme.text,
                  fontWeight: selectedSite === site.id ? "900" : "700",
                  fontSize: 15,
                }}
              >
                {site.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Pressable
        onPress={signUp}
        disabled={busy}
        style={{
          marginTop: 20,
          backgroundColor: theme.tint,
          padding: 12,
          borderRadius: 999,
          alignItems: "center",
          opacity: busy ? 0.7 : 1,
        }}
      >
        <Text style={{ fontWeight: "900", color: "#000" }}>
          {busy ? "Creating account…" : "Create Account"}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => router.back()}
        style={{ marginTop: 12 }}
      >
        <Text
          style={{
            color: theme.tint,
            textAlign: "center",
            fontWeight: "700",
          }}
        >
          Already have an account? Sign in
        </Text>
      </Pressable>
    </ScrollView>

    {/* Toast notification */}
    <Toast toast={toast} fadeAnim={fadeAnim} onDismiss={hideToast} />
  </>
  );
}