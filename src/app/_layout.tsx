import { useEffect, useState } from "react";
import { Platform, View, useColorScheme } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";

import { kv } from "../services/kv";
import { APPEARANCE_KEYS, PALETTES, resolvePaletteId, ThemeContext, type PaletteId, type ThemePreference } from "../ui/theme";
import { applyThemeChange, ThemeDissolve } from "../ui/theme-transition";

// Helix's subset faces, byte for byte (`docs/ARCHITECTURE.md`, "The fonts are Helix's").
const Inter_400Regular = require("../../assets/fonts/Inter_400Regular.ttf");
const Inter_500Medium = require("../../assets/fonts/Inter_500Medium.ttf");
const Inter_600SemiBold = require("../../assets/fonts/Inter_600SemiBold.ttf");
const IBMPlexSerif_600SemiBold = require("../../assets/fonts/IBMPlexSerif_600SemiBold.ttf");

/** Fonts are cosmetic: a slow web fetch must not hold the app on a blank screen. */
const FONT_GRACE_MS = 2500;

interface Appearance {
  theme: ThemePreference;
  palette: PaletteId;
}

const appearanceListeners = new Set<(next: Partial<Appearance>) => void>();

/** The settings screen's one door into the theme. `fromBackground` is what the veil fades out of. */
export function setAppearance(next: Partial<Appearance>, fromBackground: string) {
  // A write the keychain refuses still leaves the choice applied for this run.
  if (next.theme) kv.set(APPEARANCE_KEYS.theme, next.theme).catch(() => {});
  if (next.palette) kv.set(APPEARANCE_KEYS.palette, next.palette).catch(() => {});
  applyThemeChange(() => {
    for (const listener of appearanceListeners) listener(next);
  }, fromBackground);
}

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export default function RootLayout() {
  const systemScheme = useColorScheme();
  const [appearance, setAppearanceState] = useState<Appearance | null>(null);
  const [fontGrace, setFontGrace] = useState(false);
  const [fontsLoaded, fontsError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, IBMPlexSerif_600SemiBold });

  useEffect(() => {
    const timer = setTimeout(() => setFontGrace(true), FONT_GRACE_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const listener = (next: Partial<Appearance>) => setAppearanceState((current) => current && { ...current, ...next });
    appearanceListeners.add(listener);
    Promise.all([kv.get(APPEARANCE_KEYS.theme), kv.get(APPEARANCE_KEYS.palette)])
      .catch(() => [null, null] as const)
      .then(([theme, palette]) => {
        setAppearanceState({ theme: isThemePreference(theme) ? theme : "system", palette: resolvePaletteId(palette) });
      });
    return () => {
      appearanceListeners.delete(listener);
    };
  }, []);

  const preference = appearance?.theme ?? "system";
  const paletteId = appearance?.palette ?? resolvePaletteId(null);
  const scheme = preference === "system" ? (systemScheme === "dark" ? "dark" : "light") : preference;
  const theme = { palette: PALETTES[paletteId][scheme], scheme, paletteId, preference };

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    document.documentElement.style.colorScheme = scheme;
  }, [scheme]);

  const ready = appearance != null && (fontsLoaded || fontsError != null || fontGrace);
  // On the web the document already wears the stored ground (`+html.tsx`), and
  // a colour here would differ between the static render and the first client
  // render, which hydration never repairs.
  if (!ready) return <View style={{ flex: 1, backgroundColor: Platform.OS === "web" ? undefined : theme.palette.background }} />;

  return (
    <ThemeContext.Provider value={theme}>
      <View style={{ flex: 1, backgroundColor: theme.palette.background }}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.palette.background } }} />
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        <ThemeDissolve />
      </View>
    </ThemeContext.Provider>
  );
}
