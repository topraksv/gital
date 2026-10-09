import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { router } from "expo-router";
import * as Linking from "expo-linking";
import AlertCircle from "lucide-react-native/icons/circle-alert";
import CheckCircle2 from "lucide-react-native/icons/circle-check";
import KeyRound from "lucide-react-native/icons/key-round";
import type { LucideIcon } from "lucide-react-native";

import { isValidNewPassword, useSession } from "../../auth/session";
import { tr } from "../../i18n/tr";
import { Body, Button, Notice, Screen, TextField } from "../../ui/components";
import { alpha, authHero, circle, spacing, type, useTheme } from "../../ui/theme";

type State = "checking" | "ready" | "expired" | "invalid" | "offline" | "done";

const ENDED = {
  expired: [tr.auth.resetExpiredTitle, tr.auth.resetExpiredBody],
  invalid: [tr.auth.resetInvalidTitle, tr.auth.resetInvalidBody],
  offline: [tr.auth.resetOfflineTitle, tr.auth.resetOfflineBody],
  done: [tr.auth.resetSuccessTitle, tr.auth.resetSuccessBody],
} as const;

/**
 * Where a reset e-mail's link lands (SPEC 9.1). On the web this page runs
 * alone: the root layout opens no database for it, since the tab the mail app
 * opened may sit beside one that holds it, and it leaves by loading the app
 * afresh (`docs/ARCHITECTURE.md`, 2026-09-26 on accounts).
 */
export default function ResetPasswordScreen() {
  const { palette } = useTheme();
  const { preparePasswordRecovery, completePasswordRecovery } = useSession();
  const [state, setState] = useState<State>("checking");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await preparePasswordRecovery(await Linking.getInitialURL()).catch(() => "invalid" as const);
      // An older link's session, in the fragment, is held in memory now; out
      // of the address bar it cannot be bookmarked, synced or read back. The
      // token in the query stays, unspent until save, so a reload still works.
      if (result === "ready" && Platform.OS === "web") history.replaceState(null, "", location.pathname + location.search);
      if (active) setState(result);
    })();
    return () => {
      active = false;
    };
  }, [preparePasswordRecovery, attempt]);

  const valid = isValidNewPassword(password) && again === password && !busy;
  const save = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const failed = await completePasswordRecovery(password);
      if (failed === tr.auth.resetInvalidBody) setState("invalid");
      else if (failed) setError(failed);
      else setState("done");
    } catch {
      setError(tr.auth.errGeneric);
    }
    setBusy(false);
  };
  const leave = () => {
    if (Platform.OS === "web") location.assign(`${location.origin}${process.env.EXPO_BASE_URL ?? ""}/`);
    else router.replace("/sign-in");
  };

  if (state === "checking") {
    return (
      <Screen width="focus">
        <Body muted style={{ paddingTop: spacing.xl, textAlign: "center" }}>{tr.auth.resetChecking}</Body>
      </Screen>
    );
  }

  if (state !== "ready") {
    const [title, body] = ENDED[state];
    const success = state === "done";
    return (
      <Screen width="focus">
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md }}>
          <ResultMark tone={success ? "success" : "error"} icon={success ? CheckCircle2 : AlertCircle} />
          <Text accessibilityRole="header" aria-level={1} style={[type.heading, { color: palette.text, textAlign: "center" }]}>{title}</Text>
          <Body muted style={{ textAlign: "center", marginBottom: spacing.sm }}>{body}</Body>
          {state === "offline" ? (
            <Button
              label={tr.common.retry}
              onPress={() => {
                setState("checking");
                setAttempt((n) => n + 1);
              }}
            />
          ) : (
            <Button label={success ? tr.auth.signIn : tr.auth.requestNewLink} onPress={leave} />
          )}
        </View>
      </Screen>
    );
  }

  return (
    <Screen width="focus">
      <View style={{ paddingVertical: spacing.xxl }}>
        <View style={{ marginBottom: spacing.lg }}>
          <ResultMark tone="primary" icon={KeyRound} />
        </View>
        <Text accessibilityRole="header" aria-level={1} style={[type.heading, { color: palette.text, marginBottom: spacing.xs }]}>{tr.auth.resetTitle}</Text>
        <Body muted style={{ marginBottom: spacing.lg }}>{tr.auth.resetSubtitle}</Body>
        <TextField
          label={tr.auth.newPassword}
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            setError(null);
          }}
          secure
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          error={password !== "" && !isValidNewPassword(password) ? tr.auth.passwordHint : null}
          style={{ marginBottom: spacing.md }}
        />
        <TextField
          label={tr.auth.confirmNewPassword}
          value={again}
          onChangeText={(value) => {
            setAgain(value);
            setError(null);
          }}
          secure
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => void save()}
          error={again !== "" && again !== password ? tr.auth.passwordsMismatch : null}
          style={{ marginBottom: spacing.md }}
        />
        {error ? <Notice tone="error" text={error} /> : null}
        <Button label={tr.auth.resetSave} loading={busy} onPress={() => void save()} disabled={!valid} />
      </View>
    </Screen>
  );
}

/** Helix's round mark over the page's heading, tinted by what it says. */
function ResultMark({ tone, icon: Icon }: { tone: "primary" | "success" | "error"; icon: LucideIcon }) {
  const { palette } = useTheme();
  return (
    <View
      style={{
        width: authHero.resultMark,
        height: authHero.resultMark,
        borderRadius: circle(authHero.resultMark),
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: palette[tone] + alpha.noticeTint,
      }}
    >
      <Icon accessible={false} size={authHero.resultIcon} color={palette[tone]} />
    </View>
  );
}
