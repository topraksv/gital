import { useEffect, useState } from "react";
import { Platform, View, useColorScheme } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import DatabaseZap from "lucide-react-native/icons/database-zap";

import { migrateDb } from "../db/migrate";
import { tr } from "../i18n/tr";
import { kv } from "../services/kv";
import { Button, EmptyState } from "../ui/components";
import { DialogHost, PromptHost } from "../ui/dialog";
import { KeyboardSafeRoot } from "../ui/keyboard-safe";
import { GestureRoot } from "../ui/list-motion";
import { APPEARANCE_KEYS, PALETTES, resolvePaletteId, ThemeContext, type PaletteId, type ThemePreference } from "../ui/theme";
import { applyThemeChange, ThemeDissolve } from "../ui/theme-transition";
import { CelebrationHost } from "../ui/celebration";
import { UndoSnackbar } from "../ui/undo";

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
  const [database, setDatabase] = useState<"opening" | "ready" | "failed">("opening");
  const [openAttempt, setOpenAttempt] = useState(0);

  // Every screen reads the database, so none is drawn until it is migrated;
  // a failure gets its own screen with a retry rather than empty lists.
  useEffect(() => {
    let cancelled = false;
    migrateDb().then(
      () => !cancelled && setDatabase("ready"),
      () => !cancelled && setDatabase("failed"),
    );
    return () => {
      cancelled = true;
    };
  }, [openAttempt]);

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

  const ready = appearance != null && database !== "opening" && (fontsLoaded || fontsError != null || fontGrace);
  // On the web the document already wears the stored ground (`+html.tsx`), and
  // a colour here would differ between the static render and the first client
  // render, which hydration never repairs.
  if (!ready) return <View style={{ flex: 1, backgroundColor: Platform.OS === "web" ? undefined : theme.palette.background }} />;

  return (
    <ThemeContext.Provider value={theme}>
      <GestureRoot>
        <KeyboardSafeRoot>
          <View style={{ flex: 1, backgroundColor: theme.palette.background }}>
            {database === "failed" ? (
              <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ flex: 1 }}>
                <EmptyState
                  icon={DatabaseZap}
                  title={tr.errors.bootFailedTitle}
                  hint={tr.errors.bootFailedHint}
                  action={
                    <Button
                      label={tr.common.retry}
                      onPress={() => {
                        // Helix measured that on the web a failed open leaves
                        // wa-sqlite's VFS in "Invalid VFS state" for this
                        // document: opening again in the same page fails the
                        // same way for ever, while a reload (new realm, new
                        // worker) succeeds. Native re-opens the file for real.
                        if (Platform.OS === "web" && typeof window !== "undefined") {
                          window.location.reload();
                          return;
                        }
                        setDatabase("opening");
                        setOpenAttempt((n) => n + 1);
                      }}
                    />
                  }
                />
              </View>
            ) : (
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.palette.background } }} />
            )}
            <StatusBar style={scheme === "dark" ? "light" : "dark"} />
            <CelebrationHost />
            <UndoSnackbar />
            <PromptHost />
            <DialogHost />
            <ThemeDissolve />
          </View>
        </KeyboardSafeRoot>
      </GestureRoot>
    </ThemeContext.Provider>
  );
}
