import { useCallback, useEffect, useState } from "react";
import { AppState, Platform, View, useColorScheme } from "react-native";
import { Stack, router } from "expo-router";
import Head from "expo-router/head";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import DatabaseZap from "lucide-react-native/icons/database-zap";

import { useSession } from "../auth/session";
import { takeDatabaseRebuilt } from "../db/client";
import { migrateDb } from "../db/migrate";
import { tr } from "../i18n/tr";
import { kv } from "../services/kv";
import { useAccountFrozen, useSharedLists } from "../data/hooks";
import { createList } from "../data/lists";
import { addWish, readCollections } from "../data/wishes";
import { LINK_MAX, linkFrom } from "../domain/wishes";
import { clipboardOffer } from "../services/clipboard-link";
import { followReminderTaps, remindersAvailable, replanReminders } from "../services/reminders";
import { scheduleSync, syncNow } from "../sync/engine";
import { followLists, startLive, stopLive } from "../sync/live";
import { heldInvite, holdInvite, inviteFromPage, inviteTokenFrom } from "../sync/sharing";
import { realtimeAccess } from "../sync/supabase";
import { Button, EmptyState } from "../ui/components";
import { appConfirm, appError, appPrompt, OverlaySlot } from "../ui/dialog";
import { FOCUS_PROPERTY } from "../ui/focus-ring";
import { KeyboardSafeRoot } from "../ui/keyboard-safe";
import { useDatabaseHandoff } from "../ui/database-handoff";
import { Launch } from "../ui/launch";
import { GestureRoot } from "../ui/list-motion";
import { APPEARANCE_KEYS, isThemePreference, PALETTES, resolvePaletteId, ThemeContext } from "../ui/theme";
import { subscribeAppearance, ThemeDissolve, type Appearance } from "../ui/theme-transition";
import { ErrorBoundary } from "../ui/error-boundary";
import { FrozenGate, OperationWait } from "../ui/operation-wait";
import { PageReaderHost, readLinkPages } from "../ui/page-reader";
import { useStayAwake } from "../ui/stay-awake";
import { clearUndo, UndoSnackbar } from "../ui/undo";

// Subset faces copied byte for byte: Gital has no subsetting script (`docs/ARCHITECTURE.md`).
const Inter_400Regular = require("../../assets/fonts/Inter_400Regular.ttf");
const Inter_500Medium = require("../../assets/fonts/Inter_500Medium.ttf");
const Inter_600SemiBold = require("../../assets/fonts/Inter_600SemiBold.ttf");
const IBMPlexSerif_600SemiBold = require("../../assets/fonts/IBMPlexSerif_600SemiBold.ttf");

/** A reset link opened on the web runs with no database or session: the mail app may open it beside a
 *  tab that holds the database, and the web's database admits one tab. */
const WEB = Platform.OS === "web" && typeof location !== "undefined";
const RECOVERY_PAGE = WEB && /\/reset-password\/?$/.test(location.pathname);

/**
 * A web invitation opened signed out: signing in sends the page to the tabs
 * and the fragment with it, so the token is held here, once, and the
 * invitation reopened after (SPEC 1.4).
 */
const invitedTo = WEB ? inviteFromPage(location) : null;
if (invitedTo) void holdInvite(invitedTo);

// At module load, as the package asks: from inside a component it can come
// after the splash has already gone. `Launch` hides it.
SplashScreen.preventAutoHideAsync().catch(() => {});

/** Every screen reads the database, so none draws until it is migrated; a failure gets its own screen.
 *  "retrying" keeps that screen up with its button busy rather than dropping to plain ground. */
function useDatabase() {
  const [database, setDatabase] = useState<"opening" | "ready" | "failed" | "retrying">(RECOVERY_PAGE ? "ready" : "opening");
  const [openAttempt, setOpenAttempt] = useState(0);
  const { heldElsewhere } = useDatabaseHandoff(database === "ready" && !RECOVERY_PAGE, database === "failed");

  useEffect(() => {
    if (RECOVERY_PAGE) return;
    let cancelled = false;
    migrateDb().then(
      () => {
        if (cancelled) return;
        setDatabase("ready");
        void takeDatabaseRebuilt().then((rebuilt) => {
          if (rebuilt) void appError(tr.errors.databaseRebuilt);
        });
      },
      () => !cancelled && setDatabase("failed"),
    );
    return () => {
      cancelled = true;
    };
  }, [openAttempt]);

  const retry = useCallback(() => {
    setDatabase("retrying");
    setOpenAttempt((n) => n + 1);
  }, []);
  return { database, failed: database === "failed" || database === "retrying", heldElsewhere, retry };
}

export default function RootLayout() {
  const systemScheme = useColorScheme();
  const [appearance, setAppearanceState] = useState<Appearance | null>(null);
  const [fontGrace, setFontGrace] = useState(false);
  const [fontsLoaded, fontsError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, IBMPlexSerif_600SemiBold });
  const { database, failed, heldElsewhere, retry } = useDatabase();
  // The first real screen — the routes, or a failure's own — has drawn.
  const [settled, setSettled] = useState(false);
  const settle = useCallback(() => setSettled(true), []);
  useStayAwake();

  useEffect(() => {
    // Fonts are cosmetic: a slow web fetch must not hold the app on a blank screen.
    const timer = setTimeout(() => setFontGrace(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeAppearance((next) => setAppearanceState((current) => current && { ...current, ...next }));
    Promise.all([kv.get(APPEARANCE_KEYS.theme), kv.get(APPEARANCE_KEYS.palette)])
      .catch(() => [null, null] as const)
      .then(([theme, palette]) => {
        setAppearanceState({ theme: isThemePreference(theme) ? theme : "system", palette: resolvePaletteId(palette) });
      });
    return unsubscribe;
  }, []);

  const preference = appearance?.theme ?? "system";
  const paletteId = appearance?.palette ?? resolvePaletteId(null);
  const scheme = preference === "system" ? (systemScheme === "dark" ? "dark" : "light") : preference;
  const theme = { palette: PALETTES[paletteId][scheme], scheme, paletteId, preference };

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    document.documentElement.style.colorScheme = scheme;
    document.documentElement.style.setProperty(FOCUS_PROPERTY, theme.palette.focus);
    // A browser takes the first `theme-color` whose media matches, so the shell's two are
    // overwritten and lose their media rather than a third being added.
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute("content", theme.palette.background);
      meta.removeAttribute("media");
    });
  }, [scheme, theme.palette.focus, theme.palette.background]);

  // The root view shows wherever no screen is drawn and is the system's white unset.
  // Expo Go repaints it white on each foreground; store builds do not.
  useEffect(() => {
    if (Platform.OS === "web") return;
    void SystemUI.setBackgroundColorAsync(theme.palette.background).catch(() => {});
  }, [theme.palette.background]);

  const ready = appearance != null && database !== "opening" && (fontsLoaded || fontsError != null || fontGrace);
  // Both branches keep `Launch` in one place, so becoming ready does not
  // remount it and restart the draw.
  return (
    <ThemeContext.Provider value={theme}>
      <WebTitle />
      {ready ? (
        <GestureRoot>
          <KeyboardSafeRoot>
            <View style={{ flex: 1, backgroundColor: theme.palette.background }}>
              {failed ? (
                <BootFailure
                  retrying={database === "retrying"}
                  heldElsewhere={heldElsewhere}
                  onShown={settle}
                  onRetry={retry}
                />
              ) : (
                <ErrorBoundary onShown={settle}>
                  <Routes background={theme.palette.background} onSettled={settle} />
                </ErrorBoundary>
              )}
              <StatusBar style={scheme === "dark" ? "light" : "dark"} />
              <UndoSnackbar />
              <OverlaySlot />
              <ThemeDissolve />
            </View>
          </KeyboardSafeRoot>
        </GestureRoot>
      ) : (
        // The web document already wears the stored ground (`+html.tsx`); a colour here would differ
        // between static and first client render, which hydration never repairs.
        <View style={{ flex: 1, backgroundColor: Platform.OS === "web" ? undefined : theme.palette.background }} />
      )}
      {/* Shown once the stored palette is known, so neither ground nor mark changes colour mid-draw. */}
      <Launch shown={appearance != null} ready={settled} />
    </ThemeContext.Provider>
  );
}

/** On the web a failed open breaks wa-sqlite's VFS for this document, so retry reloads; native re-opens the file.
 *  While another tab holds the database there is no button: this tab opens when that one closes. */
function BootFailure({ retrying, heldElsewhere, onShown, onRetry }: { retrying: boolean; heldElsewhere: boolean; onShown: () => void; onRetry: () => void }) {
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ flex: 1 }} onLayout={onShown}>
      <EmptyState
        icon={DatabaseZap}
        title={tr.errors.bootFailedTitle}
        hint={heldElsewhere ? tr.errors.bootHeldElsewhere : tr.errors.bootFailedHint}
        action={
          heldElsewhere ? undefined : (
            <Button
              label={tr.common.retry}
              loading={retrying}
              onPress={() => (WEB ? location.reload() : onRetry())}
            />
          )
        }
      />
    </View>
  );
}

/**
 * Expo Router's head writes a <title> ahead of the shell's and the browser shows the first.
 * Rendered ready or not: the static export renders the layout before it is ready.
 */
function WebTitle() {
  if (Platform.OS !== "web") return null;
  return (
    <Head>
      <title>{tr.meta.title}</title>
    </Head>
  );
}

/** The account decides the routes (SPEC 9.1). Expo Router's guard rather than a redirect,
 *  which throws when it runs before the navigator mounts. */
function Routes({ background, onSettled }: { background: string; onSettled: () => void }) {
  const ready = useSession((s) => s.ready);
  const userId = useSession((s) => s.userId);
  const operation = useSession((s) => s.operation);
  const signedIn = userId != null;
  const frozen = useAccountFrozen(signedIn && !RECOVERY_PAGE);
  useEffect(() => {
    if (RECOVERY_PAGE) return;
    // A launch that cannot decide opens on sign-in rather than on nothing.
    useSession.getState().bootstrap().catch(() => useSession.setState({ ready: true }));
  }, []);
  // An undo offered to one account must not run against the next one's lists.
  useEffect(() => clearUndo(), [userId]);
  useEffect(() => {
    if (!signedIn || !WEB) return;
    void heldInvite({ take: true }).then((token) => {
      // Signed in already, the invitation page opened with its own fragment.
      if (token && !/\/invite\/?$/.test(location.pathname)) router.push({ pathname: "/invite", params: { token } });
    });
  }, [signedIn]);
  const settled = RECOVERY_PAGE || (ready && !(signedIn && frozen == null));
  // The launch screen stays over this gap, so it never shows as a blank frame.
  useEffect(() => {
    if (settled) onSettled();
  }, [settled, onSettled]);
  if (!settled) return null;
  // The device that freezes signs out; its own freezing is not a lock.
  const locked = frozen === true && operation !== "freeze";
  return (
    <>
      {locked ? (
        <FrozenGate />
      ) : (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: background } }}>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="list/[id]" />
            <Stack.Screen name="shop/[id]" />
            <Stack.Screen name="collection/[id]" />
            <Stack.Screen name="sync-issues" />
            <Stack.Screen name="data-reset" />
            <Stack.Screen name="account-security" />
            <Stack.Screen name="invite" />
            <Stack.Screen name="person/[id]" />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="(auth)/sign-in" />
          </Stack.Protected>
          <Stack.Screen name="(auth)/reset-password" />
          <Stack.Screen name="privacy" />
          {/* Signed out too: sign-in sends a failure here. */}
          <Stack.Screen name="feedback" />
        </Stack>
      )}
      {signedIn ? (
        <>
          {/* Kept while locked: the reopening may come from another device. */}
          <SyncRunner userId={userId} />
          <LiveRunner userId={userId} />
          <ReminderPlanner />
          {locked ? null : (
            <>
              <ClipboardLinkOffer />
              <ReminderTaps />
            </>
          )}
          <PageReaderHost />
        </>
      ) : null}
      {operation ? <OperationWait operation={operation} /> : null}
    </>
  );
}

/** How often an open app looks for the other phone's changes (SPEC 10.2). */
const SYNC_POLL_MS = 30_000;

/** When to sync (a write schedules its own): on opening, on coming to the front, and every half
 *  minute in front, since the other phone's changes arrive unannounced. */
function SyncRunner({ userId }: { userId: string }) {
  useEffect(() => {
    const sync = () => void syncNow(userId);
    sync();
    const subscription = AppState.addEventListener("change", (state) => state === "active" && sync());
    const poll = setInterval(() => AppState.currentState === "active" && sync(), SYNC_POLL_MS);
    return () => {
      subscription.remove();
      clearInterval(poll);
    };
  }, [userId]);
  return null;
}

/**
 * A shared list is live (SPEC 1.3): what someone else changed is pulled
 * within seconds rather than at the next poll, which stays behind it for a
 * nudge the socket lost. A person who shares nothing never loads the socket.
 */
function LiveRunner({ userId }: { userId: string }) {
  const lists = useSharedLists(userId).data.join(",");
  const shared = lists !== "";
  useEffect(() => {
    const access = shared ? realtimeAccess() : null;
    if (!access) return;
    startLive({ ...access, userId, onMoved: () => scheduleSync(userId) }).catch(() => {});
    return stopLive;
  }, [userId, shared]);
  useEffect(() => followLists(lists ? lists.split(",") : []), [lists]);
  return null;
}

/** Planned at open and on each trip to the background (SPEC 12.1), when the lists are as they will
 *  stay; a failed plan keeps the last. */
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

/** Not while the account is frozen: a tap must not open a screen behind the lock. */
function ReminderTaps() {
  useEffect(() => (remindersAvailable ? followReminderTaps((route) => router.push(route)) : undefined), []);
  return null;
}

/** A product link on the clipboard, offered once at open (SPEC 2.9), becomes a wish in the first
 *  collection this person can add to, or in a new one. */
function ClipboardLinkOffer() {
  useEffect(() => {
    void (async () => {
      const offer = await clipboardOffer();
      if (!offer) return;
      const token = offer.url ? inviteTokenFrom(offer.url) : null;
      if (token) {
        if (await appConfirm(tr.sharing.clipboardTitle, tr.sharing.clipboardMessage, tr.sharing.clipboardOpen)) {
          router.push({ pathname: "/invite", params: { token } });
        }
        return;
      }
      const typed = await appPrompt(tr.clipboard.title, offer.url ? tr.clipboard.message : tr.clipboard.pasteMessage, {
        confirmLabel: tr.clipboard.add,
        examples: tr.placeholders.link,
        initialValue: offer.url ?? "",
        maxLength: LINK_MAX,
      });
      if (typed == null || typed.trim() === "") return;
      const url = linkFrom(typed);
      if (!url) return appError(tr.wishes.linkInvalid);
      const collection = (await readCollections()).find((held) => !held.viewer)?.id ?? (await createList(tr.clipboard.collection, "wish"));
      readLinkPages(await addWish(collection, url));
      router.push({ pathname: "/collection/[id]", params: { id: collection } });
    })().catch(() => appError(tr.errors.saveFailed));
  }, []);
  return null;
}
