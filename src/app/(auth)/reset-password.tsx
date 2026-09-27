import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { router } from "expo-router";
import * as Linking from "expo-linking";

import { isValidNewPassword, useSession } from "../../auth/session";
import { tr } from "../../i18n/tr";
import { Body, Button, Card, FieldError, Notice, Screen, TextField } from "../../ui/components";
import { spacing, type, useTheme } from "../../ui/theme";

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
      // The session is held in memory now; out of the address bar, it cannot
      // be bookmarked, synced to another device or read back from history.
      if (result === "ready" && Platform.OS === "web") history.replaceState(null, "", location.pathname);
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
    } finally {
      setBusy(false);
    }
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

  return (
    <Screen width="focus">
      <View style={{ paddingTop: spacing.xl }}>
        <Card>
          <Text accessibilityRole="header" aria-level={1} style={[type.heading, { color: palette.text, marginBottom: spacing.xs }]}>
            {state === "ready" ? tr.auth.resetTitle : ENDED[state][0]}
          </Text>
          <Body muted>{state === "ready" ? tr.auth.resetSubtitle : ENDED[state][1]}</Body>
          {state === "ready" ? (
            <>
              <TextField
                value={password}
                onChangeText={(value) => {
                  setPassword(value);
                  setError(null);
                }}
                accessibilityLabel={tr.auth.newPassword}
                accessibilityHint={tr.auth.passwordHint}
                placeholder={tr.auth.newPassword}
                autoCapitalize="none"
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
                style={{ marginTop: spacing.lg }}
              />
              {password !== "" && !isValidNewPassword(password) ? <FieldError text={tr.auth.passwordHint} /> : null}
              <TextField
                value={again}
                onChangeText={(value) => {
                  setAgain(value);
                  setError(null);
                }}
                accessibilityLabel={tr.auth.confirmNewPassword}
                placeholder={tr.auth.confirmNewPassword}
                autoCapitalize="none"
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="go"
                onSubmitEditing={() => void save()}
                style={{ marginTop: spacing.sm }}
              />
              {again !== "" && again !== password ? <FieldError text={tr.auth.passwordsMismatch} /> : null}
              {error ? <Notice tone="error" text={error} /> : null}
              <View style={{ marginTop: spacing.lg }}>
                <Button label={tr.auth.resetSave} onPress={() => void save()} disabled={!valid} />
              </View>
            </>
          ) : (
            <View style={{ marginTop: spacing.lg }}>
              {state === "offline" ? (
                <Button
                  label={tr.common.retry}
                  onPress={() => {
                    setState("checking");
                    setAttempt((n) => n + 1);
                  }}
                />
              ) : (
                <Button label={state === "done" ? tr.auth.openApp : tr.auth.backToSignIn} onPress={leave} />
              )}
            </View>
          )}
        </Card>
      </View>
    </Screen>
  );
}
