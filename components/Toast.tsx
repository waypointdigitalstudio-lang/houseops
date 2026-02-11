// components/Toast.tsx
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Animated, Pressable, StyleSheet, Text } from "react-native";

import { useAppTheme } from "../constants/theme";
import type { Toast as ToastType } from "../hooks/useToast";

type ToastProps = {
  toast: ToastType | null;
  fadeAnim: Animated.Value;
  onDismiss: () => void;
};

export function Toast({ toast, fadeAnim, onDismiss }: ToastProps) {
  const theme = useAppTheme();

  if (!toast) return null;

  const getToastStyle = () => {
    switch (toast.type) {
      case "success":
        return {
          backgroundColor: "rgba(34, 197, 94, 0.95)",
          borderColor: "#22c55e",
          icon: "checkmark-circle" as const,
          iconColor: "#ffffff",
        };
      case "error":
        return {
          backgroundColor: "rgba(239, 68, 68, 0.95)",
          borderColor: "#ef4444",
          icon: "close-circle" as const,
          iconColor: "#ffffff",
        };
      case "info":
        return {
          backgroundColor: theme.card,
          borderColor: theme.border,
          icon: "information-circle" as const,
          iconColor: theme.tint,
        };
      default:
        return {
          backgroundColor: theme.card,
          borderColor: theme.border,
          icon: "information-circle" as const,
          iconColor: theme.tint,
        };
    }
  };

  const style = getToastStyle();

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: fadeAnim,
          transform: [
            {
              translateY: fadeAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [-20, 0],
              }),
            },
          ],
        },
      ]}
    >
      <Pressable
        onPress={onDismiss}
        style={[
          styles.toast,
          {
            backgroundColor: style.backgroundColor,
            borderColor: style.borderColor,
          },
        ]}
      >
        <Ionicons name={style.icon} size={22} color={style.iconColor} />
        <Text
          style={[
            styles.message,
            { color: toast.type === "info" ? theme.text : "#ffffff" },
          ]}
          numberOfLines={2}
        >
          {toast.message}
        </Text>
        <Ionicons
          name="close"
          size={18}
          color={toast.type === "info" ? theme.mutedText : "#ffffff"}
        />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 60,
    left: 16,
    right: 16,
    zIndex: 9999,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
  },
});