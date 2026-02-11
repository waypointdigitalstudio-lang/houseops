import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import { Appearance, ColorSchemeName } from "react-native";

export type ThemePreference = "system" | "light" | "dark";

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedScheme: "light" | "dark";
  setPreference: (value: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "theme_preference_v1";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] =
    useState<ThemePreference>("system");

  const [systemScheme, setSystemScheme] = useState<ColorSchemeName>(
    Appearance.getColorScheme()
  );

  // Load saved preference + listen for system changes
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved === "system" || saved === "light" || saved === "dark") {
          setPreferenceState(saved);
        }
      } catch {
        // ignore
      }
    })();

    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme);
    });

    return () => sub.remove();
  }, []);

  const setPreference = async (value: ThemePreference) => {
    setPreferenceState(value);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, value);
    } catch {
      // ignore
    }
  };

  const resolvedScheme: "light" | "dark" =
    preference === "system"
      ? systemScheme ?? "light"
      : preference;

  const contextValue = useMemo(
    () => ({
      preference,
      resolvedScheme,
      setPreference,
    }),
    [preference, resolvedScheme]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemePreference() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error(
      "useThemePreference must be used within ThemeProvider"
    );
  }
  return ctx;
}
