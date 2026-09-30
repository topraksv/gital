import { useEffect, useState } from "react";
import { AppState, Platform, View, useColorScheme } from "react-native";
import { Stack, router } from "expo-router";
import Head from "expo-router/head";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import DatabaseZap from "lucide-react-native/icons/database-zap";
import LockOpen from "lucide-react-native/icons/lock-open";
import LogOut from "lucide-react-native/icons/log-out";
import Snowflake from "lucide-react-native/icons/snowflake";

import { SIGN_OUT_PENDING_CHANGES, useSession } from "../auth/session";
import { migrateDb } from "../db/migrate";
import { tr } from "../i18n/tr";
import { kv } from "../services/kv";
import { useAccountFrozen, useSharedLists } from "../data/hooks";
import { createList } from "../data/lists";
import { setAccountFrozen } from "../data/settings";
import { addWish, readCollections } from "../data/wishes";
import { LINK_MAX, linkFrom } from "../domain/wishes";
import { clipboardOffer } from "../services/clipboard-link";
import { remindersAvailable, replanReminders } from "../services/reminders";
import { scheduleSync, syncNow } from "../sync/engine";
import { followLists, startLive, stopLive } from "../sync/live";
import { inviteFromPage, inviteTokenFrom } from "../sync/sharing";
import { realtimeAccess } from "../sync/supabase";
import { Button, EmptyState } from "../ui/components";
import { appConfirm, appError, appPrompt, DialogHost, PromptHost } from "../ui/dialog";
import { FOCUS_PROPERTY } from "../ui/focus-ring";
import { KeyboardSafeRoot } from "../ui/keyboard-safe";
import { GestureRoot } from "../ui/list-motion";
import { APPEARANCE_KEYS, PALETTES, resolvePaletteId, spacing, ThemeContext, type PaletteId, type ThemePreference } from "../ui/theme";
import { applyThemeChange, ThemeDissolve } from "../ui/theme-transition";
import { CelebrationHost } from "../ui/celebration";
import { ErrorBoundary } from "../ui/error-boundary";
import { OperationWait } from "../ui/operation-wait";
import { PageReaderHost, readLinkPages } from "../ui/page-reader";
import { useStayAwake } from "../ui/stay-awake";
import { clearUndo, UndoSnackbar } from "../ui/undo";

// Helix's subset faces, byte for byte (`docs/ARCHITECTURE.md`, "The fonts are Helix's").
const Inter_400Regular = require("../../assets/fonts/Inter_400Regular.ttf");
const Inter_500Medium = require("../../assets/fonts/Inter_500Medium.ttf");
const Inter_600SemiBold = require("../../assets/fonts/Inter_600SemiBold.ttf");
const IBMPlexSerif_600SemiBold = require("../../assets/fonts/IBMPlexSerif_600SemiBold.ttf");

/**
 * A reset link opened on the web: a page of its own, with no database and no
 * session. The mail app may open it beside a tab that holds the database, and
 * the web's database admits one tab (`docs/ARCHITECTURE.md`, 2026-09-26).
 */
const RECOVERY_PAGE = Platform.OS === "web" && typeof location !== "undefined" && /\/reset-password\/?$/.test(location.pathname);
const DATABASE_AT_START = RECOVERY_PAGE ? "ready" : "opening";

/**
 * A web invitation opened signed out: signing in sends the page to the tabs
 * and the fragment with it, so the token is read here, once, and the
 * invitation reopened after (SPEC 1.4).
 */
let heldInvite = Platform.OS === "web" && typeof location !== "undefined" ? inviteFromPage(location) : null;

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
  const [database, setDatabase] = useState<"opening" | "ready" | "failed">(DATABASE_AT_START);
  const [openAttempt, setOpenAttempt] = useState(0);
  useStayAwake();

  // Every screen reads the database, so none is drawn until it is migrated;
  // a failure gets its own screen with a retry rather than empty lists.
  useEffect(() => {
    if (RECOVERY_PAGE) return;
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
              <ErrorBoundary>
                <Routes background={theme.palette.background} />
              </ErrorBoundary>
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
 * The account decides the routes (SPEC 9.1): the lists behind a session, the
 * sign-in without one, the reset page for either. Expo Router's guard rather
 * than a redirect, which throws when it runs before the navigator mounts.
 */
function Routes({ background }: { background: string }) {
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
  // Helix's bug: an undo offered to one account ran against the next one's lists.
  useEffect(() => clearUndo(), [userId]);
  useEffect(() => {
    if (!signedIn || !heldInvite) return;
    const token = heldInvite;
    heldInvite = null;
    // Signed in already, the invitation page opened with its own fragment.
    if (!/\/invite\/?$/.test(location.pathname)) router.push({ pathname: "/invite", params: { token } });
  }, [signedIn]);
  if ((!ready || (signedIn && frozen == null)) && !RECOVERY_PAGE) return null;
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
            <Stack.Screen name="feedback" />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="(auth)/sign-in" />
          </Stack.Protected>
          <Stack.Screen name="(auth)/reset-password" />
          <Stack.Screen name="privacy" />
        </Stack>
      )}
      {signedIn ? (
        <>
          {/* Kept while locked: the reopening may come from another device. */}
          <SyncRunner userId={userId} />
          <LiveRunner userId={userId} />
          <ReminderPlanner />
          {locked ? null : <ClipboardLinkOffer />}
          <PageReaderHost />
        </>
      ) : null}
      {operation ? <OperationWait operation={operation} /> : null}
    </>
  );
}

/** Sign out, asking first when a change would be left unsent. */
export async function leaveAccount(): Promise<void> {
  const { signOut } = useSession.getState();
  let refused = await signOut();
  if (refused === SIGN_OUT_PENDING_CHANGES) {
    if (!(await appConfirm(tr.account.signOutTitle, SIGN_OUT_PENDING_CHANGES, tr.account.signOutAnyway))) return;
    refused = await signOut({ force: true });
  }
  if (refused) await appError(refused);
}

/**
 * What a frozen account shows on every device it holds (SPEC 9.1), in place
 * of the app: Helix's lock, reopened with the password rather than a
 * fingerprint, since the web has none and the password is what Gital asks for
 * everywhere else.
 */
function FrozenGate() {
  const [busy, setBusy] = useState(false);
  const act = (work: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await work();
    } catch {
      await appError(tr.auth.errGeneric);
    } finally {
      setBusy(false);
    }
  };
  const reopen = act(async () => {
    const password = await appPrompt(tr.account.confirmPasswordTitle, tr.account.reopenPasswordBody, { confirmLabel: tr.common.done, kind: "password" });
    if (password == null) return;
    const refused = await useSession.getState().verifyPassword(password);
    if (refused) await appError(refused);
    else await setAccountFrozen(false);
  });
  return (
    <View style={{ flex: 1 }}>
      <EmptyState
        icon={Snowflake}
        title={tr.account.frozenTitle}
        hint={tr.account.frozenBody}
        action={
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm }}>
            <Button label={tr.account.reopen} icon={LockOpen} disabled={busy} onPress={() => void reopen()} />
            <Button label={tr.account.signOut} icon={LogOut} variant="ghost" disabled={busy} onPress={() => void act(leaveAccount)()} />
          </View>
        }
      />
    </View>
  );
}

/** How often an open app looks for the other phone's changes (SPEC 10.2). */
const SYNC_POLL_MS = 30_000;

/**
 * When to sync; the engine decides how, and a write schedules its own. On
 * opening, on coming back to the front — the web's visibility, through
 * React Native Web — and every half minute while in front, since the other
 * phone's changes arrive with nothing here to announce them.
 */
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
      const collection = (await readCollections())[0]?.id ?? (await createList(tr.clipboard.collection, "wish"));
      readLinkPages(await addWish(collection, url));
      router.push({ pathname: "/collection/[id]", params: { id: collection } });
    })().catch(() => appError(tr.errors.saveFailed));
  }, []);
  return null;
}
