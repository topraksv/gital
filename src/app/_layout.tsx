import { useEffect, useState } from "react";
import { AppState, Platform, View, useColorScheme } from "react-native";
import { Stack, router } from "expo-router";
import Head from "expo-router/head";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import DatabaseZap from "lucide-react-native/icons/database-zap";

import { migrateDb } from "../db/migrate";
import { tr } from "../i18n/tr";
import { kv } from "../services/kv";
import { createList } from "../data/lists";
import { addWish, readCollections } from "../data/wishes";
import { LINK_MAX, linkFrom } from "../domain/wishes";
import { clipboardOffer } from "../services/clipboard-link";
import { remindersAvailable, replanReminders } from "../services/reminders";
import { Button, EmptyState } from "../ui/components";
import { appError, appPrompt, DialogHost, PromptHost } from "../ui/dialog";
import { FOCUS_PROPERTY } from "../ui/focus-ring";
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
    document.documentElement.style.setProperty(FOCUS_PROPERTY, theme.palette.focus);
    // Helix's `syncThemeColorMeta`: a browser takes the first `theme-color`
    // whose media matches, so the shell's two are written over, not added to,
    // and lose their media so the system's scheme cannot pick the other.
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute("content", theme.palette.background);
      meta.removeAttribute("media");
    });
  }, [scheme, theme.palette.focus, theme.palette.background]);

  const ready = appearance != null && database !== "opening" && (fontsLoaded || fontsError != null || fontGrace);
  // On the web the document already wears the stored ground (`+html.tsx`), and
  // a colour here would differ between the static render and the first client
  // render, which hydration never repairs.
  if (!ready) {
    return (
      <>
        <WebTitle />
        <View style={{ flex: 1, backgroundColor: Platform.OS === "web" ? undefined : theme.palette.background }} />
      </>
    );
  }

  return (
    <ThemeContext.Provider value={theme}>
      <WebTitle />
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
              <>
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.palette.background } }} />
                <ReminderPlanner />
                <ClipboardLinkOffer />
              </>
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

/**
 * Expo Router's head writes a <title> ahead of the shell's, and the browser
 * shows the first: left empty, every tab read "" (2026-09-26). Rendered in
 * both of the layout's branches, since the static export renders the one that
 * is not ready.
 */
function WebTitle() {
  if (Platform.OS !== "web") return null;
  return (
    <Head>
      <title>{tr.meta.title}</title>
    </Head>
  );
}

/**
 * Reminders are planned when the database opens and each time the app goes
 * to the background (SPEC 12.1): leaving is when the lists are as they will
 * be until the next visit, so the shopping day counts what is really on them.
 * A plan that fails keeps the last one; the next trip out tries again.
 */
function ReminderPlanner() {
  useEffect(() => {
    if (!remindersAvailable) return;
    const plan = () => void replanReminders().catch(() => {});
    plan();
    const subscription = AppState.addEventListener("change", (state) => state === "background" && plan());
    return () => subscription.remove();
  }, []);
  return null;
}

/**
 * A product link on the clipboard, offered once as the app opens (SPEC 2.9):
 * it becomes a wish in the first collection, or in a new one when there is
 * none, and the collection opens on it. The field holds the link where the
 * phone let it be read, and takes a paste where it did not.
 */
function ClipboardLinkOffer() {
  useEffect(() => {
    void (async () => {
      const offer = await clipboardOffer();
      if (!offer) return;
      const typed = await appPrompt(tr.clipboard.title, offer.url ? tr.clipboard.message : tr.clipboard.pasteMessage, {
        confirmLabel: tr.clipboard.add,
        placeholder: tr.wishes.linkPlaceholder,
        initialValue: offer.url ?? "",
        maxLength: LINK_MAX,
      });
      if (typed == null || typed.trim() === "") return;
      const url = linkFrom(typed);
      if (!url) return appError(tr.wishes.linkInvalid);
      const collection = (await readCollections())[0]?.id ?? (await createList(tr.clipboard.collection, "wish"));
      await addWish(collection, url);
      router.push({ pathname: "/collection/[id]", params: { id: collection } });
    })().catch(() => appError(tr.errors.saveFailed));
  }, []);
  return null;
}
