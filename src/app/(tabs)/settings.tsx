import { useEffect, useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import Bell from "lucide-react-native/icons/bell";
import BookOpen from "lucide-react-native/icons/book-open";
import CloudOff from "lucide-react-native/icons/cloud-off";
import CloudUpload from "lucide-react-native/icons/cloud-upload";
import KeyRound from "lucide-react-native/icons/key-round";
import LogOut from "lucide-react-native/icons/log-out";
import MessageSquare from "lucide-react-native/icons/message-square";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import ShoppingBasket from "lucide-react-native/icons/shopping-basket";
import Check from "lucide-react-native/icons/check";
import Monitor from "lucide-react-native/icons/monitor";
import Moon from "lucide-react-native/icons/moon";
import Sun from "lucide-react-native/icons/sun";
import SunMedium from "lucide-react-native/icons/sun-medium";

import { useSession } from "../../auth/session";
import { useSettings } from "../../data/hooks";
import { memberNameOf } from "../../data/settings";
import { partOfDay } from "../../domain/dates";
import type { ShoppingDay } from "../../domain/reminders";
import { tr } from "../../i18n/tr";
import { readReminderPreferences, saveShoppingDay, type ReminderPreferences } from "../../services/reminder-preferences";
import { disableReminders, enableReminders, remindersAvailable, replanReminders } from "../../services/reminders";
import { syncNow } from "../../sync/engine";
import { useSyncStatus } from "../../sync/status";
import { isSupabaseConfigured } from "../../sync/supabase";
import { BrandMark } from "../../ui/brand";
import { setShoppingNoticesAllowed, useShoppingNoticesAllowed } from "../../ui/members-sheet";
import { setStayAwakeAllowed, stayAwakeAvailable, useStayAwakeAllowed } from "../../ui/stay-awake";
import { Body, Button, Card, ChoiceTile, ListRow, Screen, SectionHeader, ToggleRow, rowsOf } from "../../ui/components";
import { appConfirm, appError } from "../../ui/dialog";
import { TourModal } from "../../ui/tour";
import { shouldPairTiles } from "../../ui/responsive";
import { alpha, appearanceTile, authHero, borderWidth, circle, controlSize, density, PALETTES, radius, spacing, type, useTheme, type Palette, type PaletteId, type ThemePreference } from "../../ui/theme";
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

/**
 * Helix's settings hub (`docs/UI.md` section 1): cards of rows, each a mark,
 * a name, a line under it and what it does at the trailing edge. What changes
 * the account lives a row away, on Hesap Güvenliği, as Helix's does.
 */
export default function SettingsScreen() {
  const { palette, scheme, paletteId, preference } = useTheme();
  const { width } = useWindowDimensions();
  const stacked = !shouldPairTiles(width);
  const [touring, setTouring] = useState(false);
  return (
    <Screen title={tr.tabs.settings} width="workspace">
      <Greeting />
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
        {/* Helix keeps what only a phone can do off the web page rather than
            explaining there why it is missing. */}
        {remindersAvailable ? <Reminders /> : null}
      </Card>
      <Card rows>
        {stayAwakeAvailable ? <StayAwakeRow /> : null}
        <ShoppingNoticesRow />
      </Card>
      {isSupabaseConfigured ? (
        <>
          <SectionHeader>{tr.settings.syncSection}</SectionHeader>
          <Sync />
        </>
      ) : null}
      <Card rows>
        <ListRow icon={BookOpen} title={tr.tour.replay} subtitle={tr.tour.replayDesc} chevron onPress={() => setTouring(true)} />
        <ListRow icon={ShieldCheck} title={tr.legal.title} subtitle={tr.legal.subtitle} chevron onPress={() => router.push("/privacy")} />
      </Card>
      {isSupabaseConfigured ? (
        <>
          <SectionHeader>{tr.account.section}</SectionHeader>
          <Card rows>
            <ListRow icon={KeyRound} title={tr.account.security} subtitle={tr.account.securityDesc} chevron onPress={() => router.push("/account-security")} />
          </Card>
          <Card rows>
            <ListRow icon={LogOut} title={tr.account.signOut} subtitle={tr.account.signOutDescription} chevron onPress={() => void signOut()} />
          </Card>
        </>
      ) : null}
      {/* Last: the one row here that changes nothing, and a person looking for
          it is looking for the bottom of the page. */}
      <SectionHeader>{tr.feedback.title}</SectionHeader>
      <Card rows>
        <ListRow icon={MessageSquare} title={tr.feedback.title} subtitle={tr.feedback.settingsDesc} chevron onPress={() => router.push("/feedback")} />
      </Card>
      <Body muted style={{ fontSize: type.small.fontSize, textAlign: "center", marginTop: spacing.md }}>{tr.settings.footer}</Body>
      {touring ? <TourModal onClose={() => setTouring(false)} /> : null}
    </Screen>
  );
}

/**
 * Helix's dashboard greeting, the mark beside it, under the page's own title
 * rather than in its place: the five tabs keep one title line, and a screen
 * reader still lands on Ayarlar first. The tab stays mounted, so the hour is
 * read again on the hour, as Helix's `useHourTick` learned to, and the mark
 * draws itself once, on the tab's first mount.
 */
function Greeting() {
  const { palette } = useTheme();
  const name = memberNameOf(useSettings().data);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const next = new Date(now);
    next.setHours(now.getHours() + 1, 0, 0, 0);
    const timer = setTimeout(() => setNow(new Date()), next.getTime() - now.getTime());
    return () => clearTimeout(timer);
  }, [now]);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
      <BrandMark height={authHero.mark} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text accessibilityRole="header" aria-level={2} style={[type.heading, { color: palette.textStrong }]}>
          {tr.settings.greeting[partOfDay(now)]}
        </Text>
        <Body muted>{tr.settings.welcome(name)}</Body>
      </View>
    </View>
  );
}

function StayAwakeRow() {
  const on = useStayAwakeAllowed();
  return <ToggleRow icon={SunMedium} title={tr.settings.stayAwake} subtitle={tr.settings.stayAwakeHint} value={on} onValueChange={setStayAwakeAllowed} />;
}

function ShoppingNoticesRow() {
  const on = useShoppingNoticesAllowed();
  return <ToggleRow icon={ShoppingBasket} title={tr.settings.shoppingNotices} subtitle={tr.settings.shoppingNoticesHint} value={on} onValueChange={setShoppingNoticesAllowed} />;
}

/** Helix asks before signing out, and the layout asks again only if something would be lost. */
async function signOut() {
  if (await appConfirm(tr.account.signOutTitle, tr.account.signOutDescription, tr.account.signOut)) await leaveAccount();
}

/**
 * Sync as Helix shows it (SPEC 10.3): one row with its state, when it last
 * finished and a button to run it now, and a row to what the server refused,
 * which opens on a screen of its own since nothing is lost and nothing is urgent.
 */
function Sync() {
  const { palette } = useTheme();
  const userId = useSession((s) => s.userId);
  const { state, lastSyncAt, error } = useSyncStatus();
  // Idle before a first sync has finished is not "synced": a fresh sign-in or
  // an offline device would read green for a copy that never left it.
  const never = state === "idle" && !lastSyncAt;
  const tone = never ? palette.textSecondary : state === "idle" ? palette.success : state === "error" ? palette.error : palette.warning;
  const said = never ? tr.sync.never : tr.sync[state];
  return (
    <Card rows>
      <ListRow
        icon={CloudUpload}
        iconColor={tone}
        title={tr.sync.title}
        subtitle={lastSyncAt ? tr.common.joined(said, tr.sync.lastSync(lastSyncAt)) : said}
        right={
          <Button
            label={tr.sync.now}
            variant="secondary"
            size="sm"
            loading={state === "syncing"}
            disabled={!userId || state === "syncing"}
            onPress={() => userId && void syncNow(userId)}
          />
        }
      />
      {state === "error" ? (
        <Text accessibilityRole="alert" style={[type.small, { color: palette.errorText, marginTop: spacing.xs }]}>{error ?? tr.sync.errGeneric}</Text>
      ) : null}
      <Body muted style={{ fontSize: type.small.fontSize, marginTop: spacing.xs, marginBottom: density.list.cardPadding }}>{tr.settings.syncExplain}</Body>
      {state === "attention" ? (
        <ListRow icon={CloudOff} title={tr.sync.issues} subtitle={tr.sync.errQuarantined} chevron onPress={() => router.push("/sync-issues")} />
      ) : null}
    </Card>
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
    <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
      <ToggleRow icon={Bell} title={tr.reminders.title} subtitle={tr.reminders.hint} value={on} onValueChange={turn} />
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
