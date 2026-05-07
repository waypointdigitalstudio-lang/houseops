// app/about.tsx
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useAppTheme } from "../constants/theme";

const { width } = Dimensions.get("window");

type FeatureItem = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description: string;
  color: string;
};

const FEATURES: FeatureItem[] = [
  { icon: "cube-outline",          label: "Inventory",          description: "Real-time stock tracking with low-stock alerts",       color: "#00b894" },
  { icon: "construct-outline",     label: "Preventative Maint.",description: "Quarterly PM checklists with overdue tracking",        color: "#f97316" },
  { icon: "print-outline",         label: "Printers & Toners",  description: "Printer fleet and toner level management",            color: "#6366f1" },
  { icon: "radio-outline",         label: "Radio Parts",        description: "Two-way radio parts inventory & low-stock alerts",    color: "#ec4899" },
  { icon: "notifications-outline", label: "Alerts",             description: "Push notifications with full activity analytics",     color: "#eab308" },
  { icon: "trash-outline",         label: "Asset Disposal",     description: "Auditable records of retired hardware",               color: "#ef4444" },
  { icon: "book-outline",          label: "Directory",          description: "Vendor contacts and Lincoln Tech partners",           color: "#0ea5e9" },
  { icon: "shield-checkmark-outline", label: "Secure Access",   description: "Role-based auth — admin and staff tiers",            color: "#8b5cf6" },
];

type TechItem = { label: string; detail: string };
const TECH: TechItem[] = [
  { label: "React Native + Expo SDK 54", detail: "Cross-platform mobile" },
  { label: "Firebase Firestore",         detail: "Real-time sync, multi-site" },
  { label: "Firebase Auth",             detail: "Secure email/password login" },
  { label: "Firebase Functions v2",      detail: "Cloud-side automation & push" },
  { label: "Expo Router",               detail: "File-based navigation" },
  { label: "EAS Build + EAS Update",    detail: "OTA deployments" },
];

export default function AboutScreen() {
  const theme = useAppTheme();

  const heroOpacity  = useRef(new Animated.Value(0)).current;
  const heroSlide    = useRef(new Animated.Value(24)).current;
  const cardsOpacity = useRef(new Animated.Value(0)).current;
  const cardsSlide   = useRef(new Animated.Value(32)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(heroOpacity,  { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(heroSlide,    { toValue: 0, duration: 500, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(cardsOpacity, { toValue: 1, duration: 450, useNativeDriver: true }),
        Animated.timing(cardsSlide,   { toValue: 0, duration: 450, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  const s = styles(theme);

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.text} />
        </Pressable>
        <Text style={s.headerTitle}>About</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Hero ── */}
        <Animated.View style={[s.hero, { opacity: heroOpacity, transform: [{ translateY: heroSlide }] }]}>
          <View style={s.logoRing}>
            <View style={s.logoInner}>
              <Ionicons name="globe-outline" size={40} color="#fff" />
            </View>
          </View>

          <Text style={s.appName}>Nexus</Text>
          <Text style={s.tagline}>Multi-site operations, unified.</Text>

          <View style={s.pillRow}>
            <View style={s.pill}><Text style={s.pillText}>Operations</Text></View>
            <View style={s.pill}><Text style={s.pillText}>Maintenance</Text></View>
            <View style={s.pill}><Text style={s.pillText}>Inventory</Text></View>
          </View>
        </Animated.View>

        {/* ── Feature grid ── */}
        <Animated.View style={{ opacity: cardsOpacity, transform: [{ translateY: cardsSlide }] }}>
          <Text style={s.sectionLabel}>What's inside</Text>
          <View style={s.grid}>
            {FEATURES.map((f) => (
              <View key={f.label} style={s.featureCard}>
                <View style={[s.featureIcon, { backgroundColor: f.color + "22" }]}>
                  <Ionicons name={f.icon} size={22} color={f.color} />
                </View>
                <Text style={s.featureLabel}>{f.label}</Text>
                <Text style={s.featureDesc}>{f.description}</Text>
              </View>
            ))}
          </View>

          {/* ── Highlight stat bar ── */}
          <View style={s.statBar}>
            <StatItem value="8" label="Modules" />
            <View style={s.statDivider} />
            <StatItem value="∞" label="Sites" />
            <View style={s.statDivider} />
            <StatItem value="Live" label="Sync" />
            <View style={s.statDivider} />
            <StatItem value="OTA" label="Updates" />
          </View>

          {/* ── Tech stack ── */}
          <Text style={s.sectionLabel}>Built with</Text>
          <View style={s.techCard}>
            {TECH.map((t, i) => (
              <View key={t.label} style={[s.techRow, i < TECH.length - 1 && s.techRowBorder]}>
                <Ionicons name="checkmark-circle" size={16} color="#00b894" style={{ marginTop: 1 }} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={s.techLabel}>{t.label}</Text>
                  <Text style={s.techDetail}>{t.detail}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* ── Footer credit ── */}
          <View style={s.footer}>
            <Text style={s.footerText}>Designed & built by</Text>
            <Text style={s.footerBrand}>Waypoint Digital Studio</Text>
            <Text style={s.footerSub}>© 2026 — All rights reserved</Text>
          </View>
        </Animated.View>

      </ScrollView>
    </View>
  );
}

function StatItem({ value, label }: { value: string; label: string }) {
  const theme = useAppTheme();
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={{ color: "#00b894", fontSize: 20, fontWeight: "900" }}>{value}</Text>
      <Text style={{ color: theme.mutedText, fontSize: 11, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

const styles = (theme: ReturnType<typeof useAppTheme>) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background },

    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingTop: 56,
      paddingHorizontal: 16,
      paddingBottom: 12,
      backgroundColor: theme.background,
    },
    headerTitle: { color: theme.text, fontSize: 17, fontWeight: "700" },
    backBtn: {
      width: 36, height: 36, borderRadius: 18,
      backgroundColor: theme.card,
      alignItems: "center", justifyContent: "center",
    },

    scroll: { paddingHorizontal: 16, paddingBottom: 48 },

    // Hero
    hero: { alignItems: "center", paddingTop: 24, paddingBottom: 32 },
    logoRing: {
      width: 92, height: 92, borderRadius: 46,
      borderWidth: 2, borderColor: "#00b894" + "55",
      alignItems: "center", justifyContent: "center",
      marginBottom: 20,
    },
    logoInner: {
      width: 72, height: 72, borderRadius: 36,
      backgroundColor: "#00b894",
      alignItems: "center", justifyContent: "center",
    },
    appName: {
      color: theme.text, fontSize: 38, fontWeight: "900",
      letterSpacing: -1, marginBottom: 6,
    },
    tagline: {
      color: theme.mutedText, fontSize: 15, fontWeight: "500",
      marginBottom: 20, textAlign: "center",
    },
    pillRow: { flexDirection: "row", gap: 8 },
    pill: {
      paddingHorizontal: 14, paddingVertical: 6,
      borderRadius: 999, borderWidth: 1, borderColor: "#00b894" + "55",
      backgroundColor: "#00b894" + "15",
    },
    pillText: { color: "#00b894", fontSize: 12, fontWeight: "700" },

    // Section label
    sectionLabel: {
      color: theme.mutedText, fontSize: 12, fontWeight: "700",
      textTransform: "uppercase", letterSpacing: 1,
      marginBottom: 12, marginTop: 4,
    },

    // Feature grid
    grid: {
      flexDirection: "row", flexWrap: "wrap",
      gap: 10, marginBottom: 16,
    },
    featureCard: {
      width: (width - 42) / 2,
      backgroundColor: theme.card,
      borderRadius: 16, padding: 14,
      borderWidth: 1, borderColor: theme.border,
    },
    featureIcon: {
      width: 40, height: 40, borderRadius: 12,
      alignItems: "center", justifyContent: "center",
      marginBottom: 10,
    },
    featureLabel: { color: theme.text, fontSize: 13, fontWeight: "800", marginBottom: 4 },
    featureDesc:  { color: theme.mutedText, fontSize: 11, lineHeight: 15 },

    // Stat bar
    statBar: {
      flexDirection: "row", alignItems: "center",
      backgroundColor: theme.card, borderRadius: 16,
      paddingVertical: 16, paddingHorizontal: 8,
      borderWidth: 1, borderColor: theme.border,
      marginBottom: 24,
    },
    statDivider: { width: 1, height: 28, backgroundColor: theme.border },

    // Tech stack
    techCard: {
      backgroundColor: theme.card, borderRadius: 16,
      borderWidth: 1, borderColor: theme.border,
      paddingHorizontal: 16, marginBottom: 28,
    },
    techRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 12 },
    techRowBorder: { borderBottomWidth: 1, borderBottomColor: theme.border },
    techLabel:  { color: theme.text, fontSize: 13, fontWeight: "700" },
    techDetail: { color: theme.mutedText, fontSize: 11, marginTop: 1 },

    // Footer
    footer: { alignItems: "center", paddingTop: 4 },
    footerText:  { color: theme.mutedText, fontSize: 12 },
    footerBrand: { color: theme.text, fontSize: 15, fontWeight: "800", marginTop: 4 },
    footerSub:   { color: theme.mutedText, fontSize: 11, marginTop: 4 },
  });
