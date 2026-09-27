import { router } from "expo-router";
import Check from "lucide-react-native/icons/check";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import { useRef, useState, type RefObject } from "react";
import { Text, View, type TextInput } from "react-native";

import { isValidNewPassword, useSession } from "../../auth/session";
import { tr } from "../../i18n/tr";
import { Body, Button, Card, FieldError, Notice, Screen, TextField } from "../../ui/components";
import { iconSize, iconStroke, spacing, type, useTheme } from "../../ui/theme";

type Mode = "signIn" | "signUp" | "forgot";

/** What each mode says, where its second link goes, and the password it asks for, if any. */
const MODE = {
  signIn: {
    title: tr.auth.signInTitle, subtitle: tr.auth.signInSubtitle, action: tr.auth.signIn, other: tr.auth.toSignUp, otherMode: "signUp",
    password: { placeholder: tr.auth.password, hint: undefined, fresh: false, accepts: (value: string) => value !== "" },
  },
  signUp: {
    title: tr.auth.signUpTitle, subtitle: tr.auth.signUpSubtitle, action: tr.auth.signUp, other: tr.auth.toSignIn, otherMode: "signIn",
    password: {
      placeholder: `${tr.auth.password} (${tr.auth.passwordHint.toLocaleLowerCase("tr")})`,
      hint: tr.auth.passwordHint,
      fresh: true,
      accepts: isValidNewPassword,
    },
  },
  forgot: {
    title: tr.auth.forgotTitle, subtitle: tr.auth.forgotSubtitle, action: tr.auth.sendResetLink, other: tr.auth.backToSignIn, otherMode: "signIn",
    password: null,
  },
} as const;

type Outcome = { tone: "error" | "success"; text: string };

const failed = (text: string): Outcome => ({ tone: "error", text });

/** What the mode's request answered; null is a session, which the layout's guard takes from here. */
async function attempt(mode: Mode, email: string, password: string): Promise<Outcome | null> {
  const { signIn, signUp, requestPasswordReset } = useSession.getState();
  if (mode === "signIn") {
    const error = await signIn(email, password);
    return error ? failed(error) : null;
  }
  if (mode === "forgot") {
    const error = await requestPasswordReset(email);
    return error ? failed(error) : { tone: "success", text: tr.auth.resetSent };
  }
  const result = await signUp(email, password);
  if (result.status === "error") return failed(result.message);
  return result.status === "confirmation-required" ? { tone: "success", text: tr.auth.confirmationSent } : null;
}

/**
 * Helix's sign-in, one card in three modes (SPEC 9.1). Success needs no
 * navigation: the root layout's guard swaps this screen for the lists once the
 * session names an account. Sign-up waits for the privacy notice, accepted at
 * its end (`src/app/privacy.tsx`). Helix's artwork is left out.
 */
export default function SignInScreen() {
  const { palette } = useTheme();
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Outcome | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const consented = useSession((s) => s.consented);

  const { title, subtitle, action, other, otherMode, password: asks } = MODE[mode];
  const emailValid = /.+@.+\..+/.test(email.trim());
  const ready = emailValid && (asks?.accepts(password) ?? true) && (mode !== "signUp" || consented) && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setMessage(null);
    const outcome = await attempt(mode, email.trim(), password).catch(() => failed(tr.auth.errGeneric));
    setBusy(false);
    setMessage(outcome);
    // A sign-up waiting on its e-mail comes back here to sign in.
    if (outcome?.tone === "success" && mode === "signUp") setMode("signIn");
  };

  const switchTo = (next: Mode) => {
    setMode(next);
    setMessage(null);
    setPassword("");
  };
  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    if (message?.tone === "error") setMessage(null);
  };

  return (
    <Screen width="focus">
      <View style={{ paddingTop: spacing.xl, marginBottom: spacing.lg }}>
        <Text accessibilityRole="header" aria-level={1} style={[type.title, { color: palette.textStrong, marginBottom: spacing.sm }]}>
          {tr.auth.welcomeTitle}
        </Text>
        <Body muted>{tr.auth.welcomeBody}</Body>
      </View>
      <Card>
        <Text accessibilityRole="header" aria-level={2} style={[type.heading, { color: palette.text, marginBottom: spacing.xs }]}>
          {title}
        </Text>
        <Body muted>{subtitle}</Body>
        <TextField
          value={email}
          onChangeText={edit(setEmail)}
          accessibilityLabel={tr.auth.email}
          placeholder={tr.auth.email}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType={asks ? "next" : "send"}
          onSubmitEditing={() => (asks ? passwordRef.current?.focus() : void submit())}
          style={{ marginTop: spacing.lg }}
        />
        {email.trim().length > 3 && !emailValid ? <FieldError text={tr.auth.emailInvalid} /> : null}
        {asks ? <PasswordField asks={asks} value={password} onChange={edit(setPassword)} onSubmit={() => void submit()} inputRef={passwordRef} /> : null}
        {mode === "signUp" ? <Consent given={consented} /> : null}
        {message ? <Notice {...message} /> : null}
        <View style={{ marginTop: spacing.lg }}>
          <Button label={action} onPress={() => void submit()} disabled={!ready} />
        </View>
        <View style={{ alignItems: "center", marginTop: spacing.sm }}>
          {mode === "signIn" ? <Button label={tr.auth.forgotPassword} variant="ghost" size="sm" onPress={() => switchTo("forgot")} /> : null}
          <Button label={other} variant="ghost" size="sm" disabled={busy} onPress={() => switchTo(otherMode)} />
        </View>
      </Card>
    </Screen>
  );
}

/** Why an account is a different thing from the device alone, and the way to the notice that says where. */
function Consent({ given }: { given: boolean }) {
  const { palette } = useTheme();
  return (
    <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
      <Body muted>{tr.legal.signUpNotice}</Body>
      {given ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, flexShrink: 1 }}>
            <Check accessible={false} size={iconSize.control} color={palette.successText} strokeWidth={iconStroke.regular} />
            <Text style={[type.body, { color: palette.successText, flexShrink: 1 }]}>{tr.legal.consentGiven}</Text>
          </View>
          <Button label={tr.legal.consentView} variant="ghost" size="sm" onPress={() => router.push("/privacy")} />
        </View>
      ) : (
        <Button
          label={tr.legal.consentOpen}
          icon={ShieldCheck}
          variant="ghost"
          onPress={() => router.push({ pathname: "/privacy", params: { consent: "1" } })}
        />
      )}
    </View>
  );
}

function PasswordField({ asks, value, onChange, onSubmit, inputRef }: {
  asks: NonNullable<(typeof MODE)[Mode]["password"]>;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  inputRef: RefObject<TextInput | null>;
}) {
  return (
    <>
      <TextField
        ref={inputRef}
        value={value}
        onChangeText={onChange}
        accessibilityLabel={tr.auth.password}
        accessibilityHint={asks.hint}
        placeholder={asks.placeholder}
        autoCapitalize="none"
        secureTextEntry
        autoComplete={asks.fresh ? "new-password" : "current-password"}
        textContentType={asks.fresh ? "newPassword" : "password"}
        returnKeyType="go"
        onSubmitEditing={onSubmit}
        style={{ marginTop: spacing.sm }}
      />
      {asks.hint && value !== "" && !asks.accepts(value) ? <FieldError text={asks.hint} /> : null}
    </>
  );
}
