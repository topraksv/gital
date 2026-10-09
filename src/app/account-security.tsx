/**
 * Helix's account security screen (SPEC 9.1): the e-mail, the password, a
 * reset link to one's own address, the data reset, and the two ways an
 * account ends, all on one screen. A change asks for the current password in
 * its own card, as Helix's does, rather than in a dialog after the fact.
 */

import { useEffect, useState } from "react";
import { Redirect, router } from "expo-router";
import Eraser from "lucide-react-native/icons/eraser";
import KeyRound from "lucide-react-native/icons/key-round";
import Mail from "lucide-react-native/icons/mail";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import Snowflake from "lucide-react-native/icons/snowflake";
import Trash from "lucide-react-native/icons/trash";

import { deviceId } from "../auth/login-history";
import { isValidNewPassword, useSession } from "../auth/session";
import { isEmail } from "../domain/names";
import { useSettings } from "../data/hooks";
import { lastLogin } from "../domain/logins";
import { tr } from "../i18n/tr";
import { kv } from "../services/kv";
import { isSupabaseConfigured } from "../sync/supabase";
import { Body, Button, Card, Divider, ListRow, PanelHeader, Screen, TextField } from "../ui/components";
import { appConfirm, appError, appPrompt } from "../ui/dialog";
import { useDirtyExitGuard } from "../ui/dirty-exit";
import { spacing, type, useTheme } from "../ui/theme";
import { showNotice } from "../ui/undo";

export default function AccountSecurityScreen() {
  // A device with no project has no account to secure.
  if (!isSupabaseConfigured) return <Redirect href="/settings" />;
  return <CloudAccountSecurity />;
}

function CloudAccountSecurity() {
  const { email, previousLoginAt, verifyPassword, changeEmail, changePassword, requestPasswordReset, freezeAccount, deleteAccount } = useSession();
  const { palette } = useTheme();
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState<"email" | "password" | "reset" | "freeze" | "delete" | null>(null);
  // A save clears its fields, so only a draft still typed asks before leaving.
  useDirtyExitGuard([newEmail, emailPassword, currentPassword, newPassword].some(Boolean));
  const settings = useSettings();
  const [device, setDevice] = useState<string | null>(null);
  useEffect(() => void deviceId(kv).then(setDevice, () => {}), []);
  // Every device's own row, once synced; until then, this device's memory.
  const login = lastLogin(settings.data, device, previousLoginAt);
  const previous = login && tr.account.previousLogin(login.at, login.device, login.here);

  /** One change at a time, and a refusal said where it happened. */
  const run = (which: NonNullable<typeof busy>, work: () => Promise<void>) => async () => {
    if (busy) return;
    setBusy(which);
    try {
      await work();
    } catch {
      await appError(tr.auth.errGeneric);
    }
    setBusy(null);
  };

  const emailReady = isEmail(newEmail) && emailPassword !== "";
  const submitEmail = run("email", async () => {
    const refused = (await verifyPassword(emailPassword)) ?? (await changeEmail(newEmail.trim()));
    if (refused) return void (await appError(refused));
    setNewEmail("");
    setEmailPassword("");
    showNotice(tr.account.emailChangeSent);
  });

  const passwordReady = currentPassword !== "" && isValidNewPassword(newPassword);
  const submitPassword = run("password", async () => {
    const refused = (await verifyPassword(currentPassword)) ?? (await changePassword(currentPassword, newPassword));
    if (refused) return void (await appError(refused));
    setCurrentPassword("");
    setNewPassword("");
    showNotice(tr.account.passwordChanged);
  });

  const sendResetLink = run("reset", async () => {
    if (!email) return;
    const refused = await requestPasswordReset(email);
    if (refused) return void (await appError(refused));
    showNotice(tr.auth.resetSentToOwnAddress(email));
  });

  /** The last word before an ending: the password, checked before anything is touched. */
  const passwordFor = async (body: string, confirmLabel: string): Promise<boolean> => {
    const password = await appPrompt(tr.account.confirmPasswordTitle, body, { confirmLabel, kind: "password" });
    if (password == null) return false;
    const refused = await verifyPassword(password);
    if (refused) await appError(refused);
    return refused == null;
  };
  const freeze = run("freeze", async () => {
    if (!(await appConfirm(tr.account.freezeTitle, tr.account.freezeBody, tr.account.freezeConfirm))) return;
    if (!(await passwordFor(tr.account.freezePasswordBody, tr.account.freezeConfirm))) return;
    const refused = await freezeAccount();
    if (refused) await appError(refused);
  });
  const remove = run("delete", async () => {
    if (!(await appConfirm(tr.account.deleteTitle, tr.account.deleteBody, tr.account.deleteConfirm))) return;
    if (!(await passwordFor(tr.account.deletePasswordBody, tr.account.deleteConfirm))) return;
    const refused = await deleteAccount();
    if (refused) await appError(refused);
  });

  return (
    <Screen title={tr.account.security} back="/settings">
      {previous ? <Body muted style={{ marginBottom: spacing.md }}>{previous}</Body> : null}
      <Card>
        <PanelHeader icon={Mail} title={tr.account.changeEmail} description={tr.account.changeEmailSectionHint} />
        {email ? <Body muted style={{ marginBottom: spacing.md }}>{tr.account.currentEmail(email)}</Body> : null}
        <TextField
          label={tr.account.newEmail}
          value={newEmail}
          onChangeText={setNewEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          placeholder={tr.placeholders.email}
          style={{ marginBottom: spacing.md }}
        />
        <TextField
          label={tr.auth.password}
          value={emailPassword}
          onChangeText={setEmailPassword}
          secure
          autoComplete="current-password"
          textContentType="password"
          placeholder={tr.account.currentPasswordPlaceholder}
          style={{ marginBottom: spacing.md }}
        />
        <Button label={tr.account.changeEmail} loading={busy === "email"} disabled={!emailReady || busy != null} onPress={() => void submitEmail()} />
        <Body muted style={{ fontSize: type.small.fontSize, marginTop: spacing.sm }}>{tr.account.emailChangeHint}</Body>
      </Card>

      <Card>
        <PanelHeader icon={KeyRound} title={tr.account.changePassword} description={tr.account.changePasswordSectionHint} />
        <TextField
          label={tr.account.currentPassword}
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secure
          autoComplete="current-password"
          textContentType="password"
          placeholder={tr.account.currentPasswordPlaceholder}
          style={{ marginBottom: spacing.md }}
        />
        <TextField
          label={tr.auth.newPassword}
          value={newPassword}
          onChangeText={setNewPassword}
          secure
          autoComplete="new-password"
          textContentType="newPassword"
          placeholder={tr.account.newPasswordPlaceholder}
          error={newPassword !== "" && !isValidNewPassword(newPassword) ? tr.auth.passwordHint : null}
          style={{ marginBottom: spacing.md }}
        />
        <Button label={tr.account.changePassword} loading={busy === "password"} disabled={!passwordReady || busy != null} onPress={() => void submitPassword()} />
      </Card>

      <Card>
        <PanelHeader icon={RotateCcw} title={tr.auth.forgotPassword} description={tr.account.resetLinkHint} />
        <Button label={tr.auth.sendResetLink} variant="secondary" loading={busy === "reset"} disabled={!email || busy != null} onPress={() => void sendResetLink()} />
      </Card>

      {/* Erasing records sits above the two endings: the same kind of decision
          at a smaller scale, and the one reached for first when what is wanted
          is a clean slate rather than no account. */}
      <Card rows>
        <ListRow icon={Eraser} title={tr.dataReset.title} subtitle={tr.dataReset.entryDescription} chevron onPress={() => router.push("/data-reset")} />
      </Card>

      <Card rows>
        <ListRow
          icon={Snowflake}
          title={tr.account.freeze}
          subtitle={tr.account.freezeSignatureDescription}
          chevron
          onPress={busy ? undefined : () => void freeze()}
        />
        <Divider flush />
        <ListRow
          icon={Trash}
          iconColor={palette.error}
          title={tr.account.delete}
          subtitle={tr.account.deleteSignatureDescription}
          chevron
          onPress={busy ? undefined : () => void remove()}
        />
      </Card>
    </Screen>
  );
}
