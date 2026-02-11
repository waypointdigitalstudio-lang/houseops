// app/login.tsx
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from "firebase/auth";
import React, { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import { useAppTheme } from "../constants/theme";
import { auth } from "../firebaseConfig";

export default function LoginScreen() {
  const theme = useAppTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const login = async () => {
    if (!email.trim() || !password) {
      Alert.alert("Missing info", "Enter email and password.");
      return;
    }

    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      router.replace("/(tabs)");
    } catch (e: any) {
      Alert.alert("Login failed", e?.message ?? "Try again.");
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      Alert.alert("Enter email", "Type your email first, then tap reset.");
      return;
    }

    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      Alert.alert(
        "Email sent",
        "Check your inbox for a password reset link."
      );
    } catch (e: any) {
      Alert.alert("Reset failed", e?.message ?? "Try again.");
    }
  };

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        padding: 16,
        backgroundColor: theme.background,
      }}
    >
      <StatusBar style="auto" />

      <Text style={{ color: theme.text, fontSize: 26, fontWeight: "900" }}>
        Sign in
      </Text>
      <Text style={{ color: theme.mutedText, marginTop: 6 }}>
        Use your staff login.
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
        placeholder="Password"
        placeholderTextColor={theme.mutedText}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <Pressable
        onPress={login}
        disabled={busy}
        style={{
          marginTop: 14,
          backgroundColor: theme.tint,
          padding: 12,
          borderRadius: 999,
          alignItems: "center",
          opacity: busy ? 0.7 : 1,
        }}
      >
        <Text style={{ fontWeight: "900", color: "#000" }}>
          {busy ? "Signing in…" : "Sign in"}
        </Text>
      </Pressable>

      {/* Forgot password */}
      <Pressable onPress={resetPassword} style={{ marginTop: 12 }}>
        <Text
          style={{
            color: theme.tint,
            textAlign: "center",
            fontWeight: "700",
          }}
        >
          Forgot password?
        </Text>
      </Pressable>

      {/* Sign up link */}
      <Pressable
        onPress={() => router.push("signup" as any)}
        style={{ marginTop: 12 }}
      >
        <Text
          style={{
            color: theme.tint,
            textAlign: "center",
            fontWeight: "700",
          }}
        >
          Don't have an account? Sign up
        </Text>
      </Pressable>
    </View>
  );
}