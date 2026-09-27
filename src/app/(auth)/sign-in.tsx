import { memo, useRef, useState, type ReactNode, type Ref } from "react";
import { Image, StyleSheet, Text, View, useWindowDimensions, type TextInput } from "react-native";
import ClipboardList from "lucide-react-native/icons/clipboard-list";
import CloudOff from "lucide-react-native/icons/cloud-off";
import Refrigerator from "lucide-react-native/icons/refrigerator";
import ShoppingCart from "lucide-react-native/icons/shopping-cart";
import type { LucideIcon } from "lucide-react-native";

import { isEmail, isValidNewPassword, useSession } from "../../auth/session";
import { tr } from "../../i18n/tr";
import { Body, Button, Card, Notice, Screen, TextField } from "../../ui/components";
import { interactionSurface } from "../../ui/interaction";
import { Press } from "../../ui/press";
import { LegalConsentControl, LegalNoticeSheet } from "../../ui/legal-notice";
import { LIST_PICTURES } from "../../ui/list-look";
import { shouldSplitAuthHero } from "../../ui/responsive";
import { alpha, authHero, contentWidth, controlSize, font, maxFontScale, radius, spacing, type, useTheme } from "../../ui/theme";

type Mode = "signIn" | "signUp" | "forgot";

/** What each mode says, what its password must be, and where its second link goes (Helix's three sentences). */
const MODE: Record<Mode, { heading: string; subtitle: string; action: string; other: string; otherMode: Mode; passwordReady: (password: string) => boolean }> = {
  signIn: { heading: tr.auth.signInTitle, subtitle: tr.auth.signInSubtitle, action: tr.auth.signIn, other: tr.auth.toSignUp, otherMode: "signUp", passwordReady: (password) => password !== "" },
  signUp: { heading: tr.auth.signUpTitle, subtitle: tr.auth.signUpSubtitle, action: tr.auth.signUpTitle, other: tr.auth.toSignIn, otherMode: "signIn", passwordReady: isValidNewPassword },
  forgot: { heading: tr.auth.forgotTitle, subtitle: tr.auth.forgotSubtitle, action: tr.auth.sendResetLink, other: tr.auth.backToSignIn, otherMode: "signIn", passwordReady: () => true },
};

/** The mark that leads the greeting: Gital's own cart, as the app icon draws it. */
function BrandMark({ size }: { size: number }) {
  return <Image accessible={false} aria-hidden source={LIST_PICTURES.cart} style={{ width: size, height: size }} resizeMode="contain" />;
}

function JourneyNode({ icon: Icon, label, active = false }: { icon: LucideIcon; label: string; active?: boolean }) {
  const { palette } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", minWidth: 0 }}>
      <View
        style={{
          width: authHero.node,
          height: authHero.node,
          borderRadius: radius.xl,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: active ? palette.primary : palette.surfaceAlt,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: active ? palette.primaryStrong : palette.border,
        }}
      >
        <Icon accessible={false} size={authHero.nodeIcon} strokeWidth={authHero.nodeStroke} color={active ? palette.onPrimary : palette.textSecondary} />
      </View>
      {/* Capped: beside a disc that does not scale, the largest text size broke a word mid-way on Helix. */}
      <Text
        maxFontSizeMultiplier={maxFontScale.measuredBox}
        style={[type.small, { color: active ? palette.accentText : palette.textSecondary, fontFamily: font.semibold, textAlign: "center", marginTop: spacing.xs }]}
      >
        {label}
      </Text>
    </View>
  );
}

/** Helix's picture under the greeting: three steps, told for a household's shopping. */
function AuthJourneyArtwork({ compact }: { compact: boolean }) {
  const { palette } = useTheme();
  const { bigBlob, smallBlob, link, bar } = authHero;
  const tones = [palette.primary, palette.secondary, palette.tertiary];
  const joint = <View style={{ flex: link.flex, height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginTop: link.top }} />;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={[tr.auth.journeyWrite, tr.auth.journeyShop, tr.auth.journeyRemember].join(", ")}
      style={{
        minHeight: compact ? authHero.art.height : authHero.art.heightWide,
        borderRadius: radius.lg,
        backgroundColor: palette.surfaceAlt,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border + alpha.controlEdge,
        overflow: "hidden",
        justifyContent: "center",
        padding: compact ? spacing.md : spacing.xl,
      }}
    >
      <View
        style={{
          position: "absolute",
          ...(compact ? bigBlob.compact : bigBlob.wide),
          borderRadius: radius.full,
          backgroundColor: palette.primarySoft,
          opacity: bigBlob.opacity,
        }}
      />
      <View
        style={{
          position: "absolute",
          ...(compact ? smallBlob.compact : smallBlob.wide),
          borderRadius: radius.full,
          backgroundColor: palette.secondarySoft,
          opacity: smallBlob.opacity,
        }}
      />
      <View style={{ flexDirection: "row", alignItems: "flex-start", width: "100%" }}>
        <JourneyNode icon={ClipboardList} label={tr.auth.journeyWrite} active />
        {joint}
        <JourneyNode icon={ShoppingCart} label={tr.auth.journeyShop} />
        {joint}
        <JourneyNode icon={Refrigerator} label={tr.auth.journeyRemember} />
      </View>
      {compact ? null : (
        <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
          {authHero.bars.map((share, at) => (
            <View key={share} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <View style={{ width: bar.dot, height: bar.dot, borderRadius: radius.full, backgroundColor: tones[at] }} />
              <View style={{ flex: 1, height: bar.height, borderRadius: radius.full, backgroundColor: palette.surfaceStrong + alpha.tileEdge }}>
                <View style={{ width: `${share * 100}%`, height: bar.height, borderRadius: radius.full, backgroundColor: tones[at] }} />
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * Helix's quiet action: "forgot password", "back to sign-in". Inline links
 * rather than stacked ghost buttons, which pushed the form past a phone's
 * fold; each still carries the whole 44-point target.
 */
function AuthLink({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { palette } = useTheme();
  return (
    <Press
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={(state) => ({
        minHeight: controlSize.minimumTarget,
        justifyContent: "center",
        paddingHorizontal: spacing.xs,
        borderRadius: radius.sm,
        ...interactionSurface(palette, state, { enabled: !disabled }),
      })}
    >
      <Text style={[type.small, { color: disabled ? palette.textSecondary : palette.accentText, fontFamily: font.semibold }]}>{label}</Text>
    </Press>
  );
}

type Outcome = { tone: "error" | "success"; text: string };

/** What the mode's request answered; null is a session, which the layout's guard takes from here. */
async function attempt(mode: Mode, email: string, password: string): Promise<Outcome | null> {
  const { signIn, signUp, requestPasswordReset } = useSession.getState();
  if (mode === "signIn") {
    const error = await signIn(email, password);
    return error ? { tone: "error", text: error } : null;
  }
  if (mode === "forgot") {
    const error = await requestPasswordReset(email);
    return error ? { tone: "error", text: error } : { tone: "success", text: tr.auth.resetSent };
  }
  const result = await signUp(email, password);
  if (result.status === "error") return { tone: "error", text: result.message };
  return result.status === "confirmation-required" ? { tone: "success", text: tr.auth.confirmationSent } : null;
}

/** Greeting beside the form when there is room for both, above it when not. */
function AuthSplit({ wide, children }: { wide: boolean; children: ReactNode }) {
  return (
    <View style={{ flexDirection: wide ? "row" : "column", alignItems: "flex-start", gap: wide ? spacing.xxl : spacing.lg, paddingVertical: wide ? spacing.xl : spacing.lg }}>
      {children}
    </View>
  );
}

function AuthColumn({ wide, share, children }: { wide: boolean; share: number; children: ReactNode }) {
  return <View style={{ flex: wide ? share : undefined, alignSelf: wide ? "flex-start" : "stretch", minWidth: 0 }}>{children}</View>;
}

/** The greeting beside the form, or above it on a phone; memoised, since every keystroke re-renders its parent. */
const AuthGreeting = memo(function AuthGreeting({ wide, artwork }: { wide: boolean; artwork: boolean }) {
  const { palette } = useTheme();
  return (
    <AuthColumn wide={wide} share={1.08}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.sm }}>
        <BrandMark size={wide ? authHero.markWide : authHero.mark} />
        <Text
          accessibilityRole="header"
          aria-level={1}
          style={[
            type.display,
            {
              flex: 1,
              minWidth: 0,
              color: palette.textStrong,
              lineHeight: wide ? authHero.titleLineWide : authHero.titleLine,
              fontSize: wide ? type.display.fontSize : Math.round(type.sectionTitle.fontSize * authHero.titleScale),
            },
          ]}
        >
          {tr.auth.welcomeTitle}
        </Text>
      </View>
      <Body muted style={{ marginBottom: spacing.lg, maxWidth: authHero.bodyMaxWidth, lineHeight: authHero.bodyLine }}>{tr.auth.welcomeBody}</Body>
      {/* Decoration, and the first thing to go when the form grows: a phone
          has to reach the button without scrolling. */}
      {artwork ? <AuthJourneyArtwork compact={!wide} /> : null}
    </AuthColumn>
  );
});

function OfflineNote() {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, marginTop: spacing.sm }}>
      <CloudOff accessible={false} size={authHero.noteIcon} color={palette.textSecondary} />
      <Text style={[type.small, { color: palette.textSecondary, textAlign: "center", flexShrink: 1 }]}>{tr.auth.offlineNote}</Text>
    </View>
  );
}

/** The address, which is the last field only when a reset link is all that is asked for. */
function EmailField({ value, onChangeText, last, onSubmit, onNext }: { value: string; onChangeText: (value: string) => void; last: boolean; onSubmit: () => void; onNext: () => void }) {
  return (
    <TextField
      label={tr.auth.email}
      value={value}
      onChangeText={onChangeText}
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="email"
      keyboardType="email-address"
      textContentType="emailAddress"
      placeholder={tr.placeholders.email}
      returnKeyType={last ? "send" : "next"}
      onSubmitEditing={last ? onSubmit : onNext}
      // Waits for a plausible attempt rather than the first letter.
      error={value.trim().length > 3 && !isEmail(value) ? tr.auth.emailInvalid : null}
      style={{ marginBottom: spacing.md }}
    />
  );
}

/** Sign-up's password is a new one, checked as it is typed; sign-in's is only the one already set. */
function PasswordField({ ref, creating, value, onChangeText, onSubmit }: { ref: Ref<TextInput>; creating: boolean; value: string; onChangeText: (value: string) => void; onSubmit: () => void }) {
  return (
    <TextField
      ref={ref}
      label={tr.auth.password}
      value={value}
      onChangeText={onChangeText}
      secure
      autoCapitalize="none"
      autoComplete={creating ? "new-password" : "current-password"}
      textContentType={creating ? "newPassword" : "password"}
      returnKeyType="go"
      onSubmitEditing={onSubmit}
      error={creating && value !== "" && !isValidNewPassword(value) ? tr.auth.passwordHint : null}
      style={{ marginBottom: spacing.md }}
    />
  );
}

function ModeLinks({ mode, busy, onSwitch }: { mode: Mode; busy: boolean; onSwitch: (next: Mode) => void }) {
  const { other, otherMode } = MODE[mode];
  return (
    <View style={{ alignItems: "center", marginTop: spacing.sm }}>
      {mode === "signIn" ? <AuthLink label={tr.auth.forgotPassword} onPress={() => onSwitch("forgot")} disabled={busy} /> : null}
      <AuthLink label={other} onPress={() => onSwitch(otherMode)} disabled={busy} />
    </View>
  );
}

/**
 * Helix's sign-in (SPEC 9.1): one greeting, one card in three modes with the
 * same skeleton, and the notice opened over the form rather than navigated to.
 * Success needs no navigation: the root layout's guard swaps this screen for
 * the lists once the session names an account.
 */
export default function SignInScreen() {
  const { palette } = useTheme();
  const { width } = useWindowDimensions();
  const wide = shouldSplitAuthHero(Math.min(width - 2 * spacing.xxl, contentWidth.form));
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [consented, setConsented] = useState(false);
  /** Only after a refused press: the form does not scold while it is being filled. */
  const [consentRefused, setConsentRefused] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const text = MODE[mode];
  const emailValid = isEmail(email);
  const passwordReady = text.passwordReady(password);
  // Consent is kept out of `formReady`, so the button stays pressable while it
  // is all that is missing, and pressing it says so; a greyed button never does.
  const formReady = emailValid && passwordReady && !busy;
  const canSubmit = formReady && (mode !== "signUp" || consented);
  const resent = mode === "forgot" && outcome?.tone === "success";
  const action = resent ? tr.auth.resendResetLink : text.action;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setOutcome(null);
    const answered = await attempt(mode, email.trim(), password).catch((): Outcome => ({ tone: "error", text: tr.auth.errGeneric }));
    setBusy(false);
    setOutcome(answered);
  };
  const press = () => {
    if (mode === "signUp" && !consented) setConsentRefused(true);
    else void submit();
  };
  /** Consent belongs to the attempt that was made, not to the session. */
  const switchTo = (next: Mode) => {
    setMode(next);
    setOutcome(null);
    setPassword("");
    setConsented(false);
    setConsentRefused(false);
  };
  const accept = () => {
    setConsented(true);
    setConsentRefused(false);
    setNoticeOpen(false);
  };
  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    if (outcome?.tone === "error") setOutcome(null);
  };

  return (
    <Screen width="form">
      {/* Top-aligned, not centred: centring re-laid the column on every change
          in the card's height, and the mark drifted with each mode. */}
      <AuthSplit wide={wide}>
        <AuthGreeting wide={wide} artwork={wide || mode === "signIn"} />
        {/* One skeleton for all three modes, so switching does not redraw three card sizes. */}
        <AuthColumn wide={wide} share={0.92}>
          <Card>
            <Text accessibilityRole="header" aria-level={2} style={[type.heading, { color: palette.text, marginBottom: spacing.xs }]}>{text.heading}</Text>
            <Body muted style={{ marginBottom: spacing.lg }}>{text.subtitle}</Body>
            <EmailField value={email} onChangeText={edit(setEmail)} last={mode === "forgot"} onSubmit={press} onNext={() => passwordRef.current?.focus()} />
            {mode !== "forgot" ? <PasswordField ref={passwordRef} creating={mode === "signUp"} value={password} onChangeText={edit(setPassword)} onSubmit={press} /> : null}
            {outcome ? <Notice {...outcome} /> : null}
            {/* Before the account exists, not after: creating one is when an
                address starts being held on servers abroad. */}
            {mode === "signUp" ? (
              <>
                <Body muted style={{ marginBottom: spacing.sm, fontSize: type.small.fontSize }}>{tr.legal.signUpNotice}</Body>
                <LegalConsentControl consented={consented} onOpen={() => setNoticeOpen(true)} invalid={consentRefused && !consented} />
              </>
            ) : null}
            <Button label={action} loading={busy} disabled={!formReady} onPress={press} />
            <ModeLinks mode={mode} busy={busy} onSwitch={switchTo} />
            <OfflineNote />
          </Card>
        </AuthColumn>
      </AuthSplit>
      {noticeOpen ? (
        <LegalNoticeSheet
          onClose={() => setNoticeOpen(false)}
          // Only sign-up accepts; opened from anywhere else it is a document to read.
          onAccept={mode === "signUp" ? accept : undefined}
        />
      ) : null}
    </Screen>
  );
}
