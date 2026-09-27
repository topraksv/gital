import { useEffect, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import BookOpen from "lucide-react-native/icons/book-open";
import CloudAlert from "lucide-react-native/icons/cloud-alert";
import Eraser from "lucide-react-native/icons/eraser";
import KeyRound from "lucide-react-native/icons/key-round";
import LogOut from "lucide-react-native/icons/log-out";
import Mail from "lucide-react-native/icons/mail";
import MessageSquare from "lucide-react-native/icons/message-square";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import Snowflake from "lucide-react-native/icons/snowflake";
import Trash from "lucide-react-native/icons/trash";
import Check from "lucide-react-native/icons/check";
import Monitor from "lucide-react-native/icons/monitor";
import Moon from "lucide-react-native/icons/moon";
import Sun from "lucide-react-native/icons/sun";

import { useSession } from "../../auth/session";
import type { ShoppingDay } from "../../domain/reminders";
import { tr } from "../../i18n/tr";
import { readReminderPreferences, saveShoppingDay, type ReminderPreferences } from "../../services/reminder-preferences";
import { disableReminders, enableReminders, remindersAvailable, replanReminders } from "../../services/reminders";
import { syncNow } from "../../sync/engine";
import { useSyncStatus } from "../../sync/status";
import { isSupabaseConfigured } from "../../sync/supabase";
import { Body, Button, Card, ChoiceTile, Notice, Screen, SectionHeader, Toggle, rowsOf } from "../../ui/components";
import { appConfirm, appError, appPrompt } from "../../ui/dialog";
import { TourModal } from "../../ui/tour";
import { shouldPairTiles } from "../../ui/responsive";
import { alpha, appearanceTile, borderWidth, circle, controlSize, PALETTES, radius, spacing, useTheme, type Palette, type PaletteId, type ThemePreference } from "../../ui/theme";
import { radioGroupKeys } from "../../ui/keys";
import { leaveAccount, setAppearance } from "../_layout";

const THEMES: readonly [ThemePreference, string][] = [
  ["system", tr.settings.themeSystem],
  ["light", tr.settings.themeLight],
  ["dark", tr.settings.themeDark],
];

const FAMILIES: readonly [PaletteId, string, string][] = [
  ["clay", tr.settings.paletteClay, tr.settings.paletteClayDesc],
  ["ocean", tr.settings.paletteOcean, tr.settings.paletteOceanDesc],
  ["forest", tr.settings.paletteForest, tr.settings.paletteForestDesc],
];

/** Helix's appearance card, ported as it stands (`docs/UI.md` section 1). */
export default function SettingsScreen() {
  const { palette, scheme, paletteId, preference } = useTheme();
  const { width } = useWindowDimensions();
  const stacked = !shouldPairTiles(width);
  const [touring, setTouring] = useState(false);
  return (
    <Screen title={tr.tabs.settings} width="workspace">
      {isSupabaseConfigured ? (
        <>
          <SectionHeader>{tr.account.title}</SectionHeader>
          <Card>
            <Account />
          </Card>
          <SectionHeader>{tr.sync.title}</SectionHeader>
          <Card>
            <Sync />
          </Card>
        </>
      ) : null}
      <SectionHeader>{tr.settings.appSection}</SectionHeader>
      <Card>
        <Body style={{ marginBottom: spacing.sm }}>{tr.settings.theme}</Body>
        <View role="radiogroup" {...radioGroupKeys()} accessibilityLabel={tr.settings.theme} style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg }}>
          {THEMES.map(([value, label]) => (
            <ThemeChoice
              key={value}
              value={value}
              label={label}
              selected={preference === value}
              light={PALETTES[paletteId].light}
              dark={PALETTES[paletteId].dark}
              onPress={() => setAppearance({ theme: value }, palette.background)}
            />
          ))}
        </View>
        <Body style={{ marginBottom: spacing.sm }}>{tr.settings.palette}</Body>
        <View role="radiogroup" {...radioGroupKeys()} accessibilityLabel={tr.settings.palette} style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {FAMILIES.map(([id, label, description]) => (
            <PaletteChoice
              key={id}
              label={label}
              description={description}
              swatch={PALETTES[id][scheme]}
              selected={paletteId === id}
              stacked={stacked}
              onPress={() => setAppearance({ palette: id }, palette.background)}
            />
          ))}
        </View>
      </Card>
      <SectionHeader>{tr.reminders.title}</SectionHeader>
      <Card>{remindersAvailable ? <Reminders /> : <Body muted>{tr.reminders.phoneOnly}</Body>}</Card>
      <SectionHeader>{tr.settings.helpSection}</SectionHeader>
      <Card>
        <Body muted style={{ marginBottom: spacing.md }}>{tr.tour.replayHint}</Body>
        <Button label={tr.tour.replay} icon={BookOpen} variant="ghost" onPress={() => setTouring(true)} />
        <Body muted style={{ marginVertical: spacing.md }}>{tr.feedback.hint}</Body>
        <Button label={tr.feedback.open} icon={MessageSquare} variant="ghost" onPress={() => router.push("/feedback")} />
      </Card>
      {touring ? <TourModal onClose={() => setTouring(false)} /> : null}
    </Screen>
  );
}

/**
 * The account (SPEC 9.1): who is signed in, and every change to it. Each one
 * asks for the password first, through the brake on repeated failures; the
 * two that end the account here speak through dialogs, which outlive this
 * screen once the guard has swapped it for sign-in.
 */
function Account() {
  const { email, previousLoginAt, verifyPassword, changeEmail, changePassword, freezeAccount, deleteAccount } = useSession();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const run = (work: () => Promise<{ tone: "error" | "success"; text: string } | null>) => async () => {
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await work();
      if (outcome) setNotice(outcome);
    } catch {
      setNotice({ tone: "error", text: tr.auth.errGeneric });
    } finally {
      setBusy(false);
    }
  };
  const confirmed = async (body: string): Promise<{ ok: true; password: string } | { ok: false; refused: string } | null> => {
    const password = await appPrompt(tr.account.confirmPasswordTitle, body, { confirmLabel: tr.common.done, kind: "password" });
    if (password == null) return null;
    const refused = await verifyPassword(password);
    return refused ? { ok: false, refused } : { ok: true, password };
  };
  const failed = (text: string) => ({ tone: "error", text }) as const;

  const newEmail = run(async () => {
    const next = await appPrompt(tr.account.changeEmail, tr.account.newEmail, { confirmLabel: tr.common.save, kind: "email" });
    if (next == null) return null;
    const check = await confirmed(tr.account.confirmPasswordBody);
    if (!check) return null;
    if (!check.ok) return failed(check.refused);
    const refused = await changeEmail(next);
    return refused ? failed(refused) : { tone: "success", text: tr.account.emailChangeSent };
  });
  const newPassword = run(async () => {
    const check = await confirmed(tr.account.confirmPasswordBody);
    if (!check) return null;
    if (!check.ok) return failed(check.refused);
    const next = await appPrompt(tr.account.changePassword, tr.account.newPasswordBody, { confirmLabel: tr.common.save, kind: "new-password" });
    if (next == null) return null;
    const refused = await changePassword(check.password, next);
    return refused ? failed(refused) : { tone: "success", text: tr.account.passwordChanged };
  });
  const leave = run(async () => {
    await leaveAccount();
    return null;
  });
  const freeze = run(async () => {
    if (!(await appConfirm(tr.account.freezeTitle, tr.account.freezeBody, tr.account.freezeConfirm))) return null;
    const check = await confirmed(tr.account.freezePasswordBody);
    if (!check) return null;
    const refused = check.ok ? await freezeAccount() : check.refused;
    if (refused) await appError(refused);
    return null;
  });
  const remove = run(async () => {
    if (!(await appConfirm(tr.account.deleteTitle, tr.account.deleteBody, tr.account.deleteConfirm))) return null;
    const check = await confirmed(tr.account.deletePasswordBody);
    if (!check) return null;
    const refused = check.ok ? await deleteAccount() : check.refused;
    if (refused) await appError(refused);
    return null;
  });

  return (
    <View style={{ gap: spacing.sm }}>
      {email ? <Body>{tr.account.signedInAs(email)}</Body> : null}
      {previousLoginAt ? <Body muted>{tr.account.previousLogin(previousLoginAt)}</Body> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm }}>
        <Button label={tr.account.changeEmail} icon={Mail} variant="ghost" disabled={busy} onPress={() => void newEmail()} />
        <Button label={tr.account.changePassword} icon={KeyRound} variant="ghost" disabled={busy} onPress={() => void newPassword()} />
        <Button label={tr.account.signOut} icon={LogOut} variant="ghost" disabled={busy} onPress={() => void leave()} />
        <Button label={tr.dataReset.title} icon={Eraser} variant="ghost" disabled={busy} onPress={() => router.push("/data-reset")} />
        <Button label={tr.account.freeze} icon={Snowflake} variant="ghost" disabled={busy} onPress={() => void freeze()} />
        <Button label={tr.account.delete} icon={Trash} variant="ghost" disabled={busy} onPress={() => void remove()} />
      </View>
      {notice ? <Notice {...notice} /> : null}
    </View>
  );
}

/**
 * Sync as Helix shows it (SPEC 10.3): its state, when it last finished, and a
 * button to run it now. What the server refused opens on a screen of its own,
 * since nothing is lost and nothing here is urgent.
 */
function Sync() {
  const userId = useSession((s) => s.userId);
  const { state, lastSyncAt, error } = useSyncStatus();
  return (
    <View style={{ gap: spacing.sm }}>
      {state === "error" ? <Notice tone="error" text={error ?? tr.sync.errGeneric} /> : <Body>{tr.sync[state]}</Body>}
      <Body muted>{lastSyncAt ? tr.sync.lastSync(lastSyncAt) : tr.sync.never}</Body>
      {state === "attention" ? <Body muted>{tr.sync.errQuarantined}</Body> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm }}>
        <Button label={tr.sync.now} icon={RefreshCw} variant="ghost" disabled={!userId || state === "syncing"} onPress={() => userId && void syncNow(userId)} />
        {state === "attention" ? <Button label={tr.sync.issues} icon={CloudAlert} variant="ghost" onPress={() => router.push("/sync-issues")} /> : null}
      </View>
    </View>
  );
}

/** The hours a shopping day can ring at: a market's morning, noon, and after work. */
const HOURS = [9, 10, 12, 17, 19] as const;
const DAY_COLUMNS = 4;

/**
 * Reminders on or off, and the shopping day (SPEC 12.1). The switch is what
 * asks the phone for permission, so it is never asked unprompted.
 */
function Reminders() {
  const [preferences, setPreferences] = useState<ReminderPreferences | null>(null);
  useEffect(() => void readReminderPreferences().then(setPreferences, () => setPreferences({ on: false, day: null })), []);
  if (!preferences) return null;
  const { on, day } = preferences;
  // Drawn at once, and put back to what the phone ended with: refused, or failed.
  const turn = (next: boolean) => {
    setPreferences({ on: next, day });
    (next ? enableReminders() : disableReminders().then(() => false)).then(
      (allowed) => {
        if (next && !allowed) {
          setPreferences({ on: false, day });
          void appError(tr.reminders.denied);
        }
      },
      () => {
        void readReminderPreferences().then(setPreferences, () => {});
        void appError(tr.errors.saveFailed);
      },
    );
  };
  const choose = (next: ShoppingDay | null) => {
    setPreferences({ on, day: next });
    saveShoppingDay(next)
      .then(replanReminders)
      .catch(() => appError(tr.errors.saveFailed));
  };
  const days = [[null, tr.reminders.noDay, tr.reminders.noDay] as const, ...tr.reminders.weekdays];
  return (
    <View style={{ gap: spacing.sm }}>
      <Body muted>{tr.reminders.hint}</Body>
      <Toggle value={on} onValueChange={turn} label={tr.reminders.title} />
      {on ? (
        <>
          <Body>{tr.reminders.day}</Body>
          <View role="radiogroup" {...radioGroupKeys()} accessibilityLabel={tr.reminders.day} style={{ gap: spacing.sm }}>
            {rowsOf(days, DAY_COLUMNS).map((row, at) => (
              <View key={at} style={{ flexDirection: "row", gap: spacing.sm }}>
                {row.map(([weekday, short, full]) => (
                  <ChoiceTile
                    key={short}
                    label={short}
                    accessibilityLabel={full}
                    selected={(day?.weekday ?? null) === weekday}
                    minHeight={controlSize.minimumTarget}
                    basis="20%"
                    onPress={() => choose(weekday == null ? null : { weekday, hour: day?.hour ?? HOURS[1], minute: 0 })}
                  />
                ))}
              </View>
            ))}
          </View>
          {day ? (
            <>
              <Body>{tr.reminders.time}</Body>
              <View role="radiogroup" {...radioGroupKeys()} accessibilityLabel={tr.reminders.time} style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                {HOURS.map((hour) => (
                  <ChoiceTile
                    key={hour}
                    label={`${String(hour).padStart(2, "0")}:00`}
                    selected={day.hour === hour}
                    minHeight={controlSize.minimumTarget}
                    basis="15%"
                    onPress={() => choose({ ...day, hour, minute: 0 })}
                  />
                ))}
              </View>
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/** A window split in its own light and dark grounds, with the mode's mark over it. */
function ThemeChoice({ value, label, selected, light, dark, onPress }: {
  value: ThemePreference;
  label: string;
  selected: boolean;
  light: Palette;
  dark: Palette;
  onPress: () => void;
}) {
  const Icon = value === "light" ? Sun : value === "dark" ? Moon : Monitor;
  const tile = appearanceTile.theme;
  return (
    <ChoiceTile label={label} selected={selected} onPress={onPress} minHeight={tile.minHeight}>
      <View
        accessible={false}
        style={{
          width: tile.swatch.width,
          height: tile.swatch.height,
          overflow: "hidden",
          flexDirection: "row",
          borderRadius: radius.sm,
          borderWidth: borderWidth.outline,
          borderColor: selected ? light.primary : light.border + alpha.edge,
        }}
      >
        <View style={{ flex: 1, backgroundColor: value === "dark" ? dark.background : light.background }} />
        {value === "system" ? <View style={{ flex: 1, backgroundColor: dark.background }} /> : null}
        <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
          <Icon size={tile.icon} color={value === "dark" ? dark.textStrong : light.textStrong} />
        </View>
      </View>
    </ChoiceTile>
  );
}

/** A miniature of the palette's own page: a card on its ground, its accent, its status pair. */
function PaletteChoice({ label, description, swatch, selected, stacked, onPress }: {
  label: string;
  description: string;
  swatch: Palette;
  selected: boolean;
  stacked: boolean;
  onPress: () => void;
}) {
  const tile = appearanceTile.palette;
  const lineColours = [swatch.textStrong, swatch.border, swatch.surfaceStrong];
  return (
    <ChoiceTile
      label={label}
      description={description}
      selected={selected}
      onPress={onPress}
      layout={stacked ? "row" : "stack"}
      basis={stacked ? "100%" : undefined}
      minHeight={stacked ? tile.minHeight : tile.wideMinHeight}
      surface={swatch}
    >
      <View
        accessible={false}
        style={{
          width: stacked ? tile.swatch.width : "100%",
          height: stacked ? tile.swatch.height : tile.swatch.wideHeight,
          flexShrink: 0,
          overflow: "hidden",
          borderRadius: radius.md,
          borderWidth: borderWidth.outline,
          borderColor: swatch.border + alpha.edge,
          backgroundColor: swatch.background,
        }}
      >
        <View
          style={{
            position: "absolute",
            left: spacing.sm,
            top: spacing.sm,
            right: stacked ? tile.cardRight : tile.wideCardRight,
            bottom: spacing.sm,
            padding: spacing.sm,
            gap: tile.lineGap,
            borderRadius: radius.sm,
            backgroundColor: swatch.surface,
          }}
        >
          {tile.lines.map((line, i) => (
            <View key={line.width} style={{ width: line.width, height: line.height, borderRadius: line.radius, backgroundColor: lineColours[i] }} />
          ))}
        </View>
        <View style={{ position: "absolute", right: spacing.sm, top: spacing.sm, width: tile.dot, height: tile.dot, borderRadius: circle(tile.dot), backgroundColor: swatch.primary }} />
        <View style={{ position: "absolute", right: spacing.sm, bottom: spacing.sm, flexDirection: "row", gap: tile.pipGap }}>
          <View style={{ width: tile.pip, height: tile.pip, borderRadius: circle(tile.pip), backgroundColor: swatch.success }} />
          <View style={{ width: tile.pip, height: tile.pip, borderRadius: circle(tile.pip), backgroundColor: swatch.error }} />
        </View>
        {selected ? (
          <View
            style={{
              position: "absolute",
              right: spacing.sm + (tile.dot - tile.check) / 2,
              top: spacing.sm + (tile.dot - tile.check) / 2,
              width: tile.check,
              height: tile.check,
              borderRadius: circle(tile.check),
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: swatch.primary,
            }}
          >
            <Check size={tile.checkIcon} color={swatch.onPrimary} strokeWidth={tile.checkStroke} />
          </View>
        ) : null}
      </View>
    </ChoiceTile>
  );
}
