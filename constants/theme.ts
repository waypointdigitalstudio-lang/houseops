/**
 * Centralized app theme.
 * Driven by ThemeProvider (system / light / dark).
 */

import { Platform } from "react-native";
import { useThemePreference } from "../src/theme/ThemeProvider";

const tintColorLight = "#0a7ea4";
const tintColorDark = "#ffffff";

export const Colors = {
  light: {
    text: "#11181C",
    background: "#FFFFFF",

    card: "#F2F4F7",
    border: "rgba(0,0,0,0.12)",

    tint: tintColorLight,
    icon: "#687076",
    mutedText: "rgba(0,0,0,0.65)",

    tabIconDefault: "#687076",
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: "#ECEDEE",
    background: "#151718",

    card: "#1C1E22",
    border: "rgba(255,255,255,0.16)",

    tint: tintColorDark,
    icon: "#9BA1A6",
    mutedText: "rgba(255,255,255,0.70)",

    tabIconDefault: "#9BA1A6",
    tabIconSelected: tintColorDark,
  },
} as const;

export type AppColorScheme = keyof typeof Colors;
export type AppColors = (typeof Colors)[AppColorScheme];

/**
 * Use this hook everywhere to get the active theme colors.
 */
export function useAppTheme(): AppColors {
  const { resolvedScheme } = useThemePreference();
  return Colors[resolvedScheme as AppColorScheme];
}

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded:
      "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono:
      "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
