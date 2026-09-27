/**
 * Resetting the data (SPEC 9.1), Helix's reset page without its date range:
 * the person chooses parts, sees how many records they take, and says so
 * twice — once to what goes, once with the password, since it goes from every
 * device the account holds and cannot be undone.
 */

import { useEffect, useState } from "react";
import { View } from "react-native";
import Eraser from "lucide-react-native/icons/eraser";

import { useSession } from "../auth/session";
import { countDataReset, resetData, RESET_SCOPES, type ResetScope } from "../data/reset";
import { tr } from "../i18n/tr";
import { Body, Button, Card, Divider, Screen, ToggleRow } from "../ui/components";
import { appConfirm, appError, appPrompt } from "../ui/dialog";
import { spacing } from "../ui/theme";
import { showNotice } from "../ui/undo";

export default function DataResetScreen() {
  const verifyPassword = useSession((s) => s.verifyPassword);
  const [chosen, setChosen] = useState<readonly ResetScope[]>([]);
  const [counted, setCounted] = useState<{ of: readonly ResetScope[]; count: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    countDataReset(chosen).then(
      (count) => current && setCounted({ of: chosen, count }),
      () => current && void appError(tr.errors.readFailedTitle),
    );
    return () => {
      current = false;
    };
  }, [chosen]);
  // A count of an earlier choice is no count: the button waits for this one's.
  const count = counted?.of === chosen ? counted.count : null;

  const choose = (scope: ResetScope, on: boolean) => setChosen((was) => RESET_SCOPES.filter((each) => (each === scope ? on : was.includes(each))));

  const reset = async () => {
    if (!count) return;
    setBusy(true);
    try {
      if (!(await appConfirm(tr.dataReset.confirmTitle, tr.dataReset.confirmBody(count), tr.dataReset.confirm))) return;
      const password = await appPrompt(tr.account.confirmPasswordTitle, tr.dataReset.passwordBody, { confirmLabel: tr.common.done, kind: "password" });
      if (password == null) return;
      const refused = await verifyPassword(password);
      if (refused) {
        await appError(refused);
        return;
      }
      showNotice(tr.dataReset.done(await resetData(chosen)));
      setChosen([]);
    } catch {
      await appError(tr.errors.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={tr.dataReset.title} back="/account-security">
      <View style={{ gap: spacing.md }}>
        <Body muted>{tr.dataReset.intro}</Body>
        <Card rows>
          {RESET_SCOPES.map((scope, at) => (
            <View key={scope}>
              {at > 0 ? <Divider /> : null}
              <ToggleRow
                value={chosen.includes(scope)}
                onValueChange={(on) => choose(scope, on)}
                title={tr.dataReset.scope[scope]}
                subtitle={tr.dataReset.scopeHint[scope]}
              />
            </View>
          ))}
        </Card>
        <View accessibilityLiveRegion="polite">{count == null ? null : <Body>{tr.dataReset.count(count)}</Body>}</View>
        <View style={{ alignItems: "flex-start" }}>
          <Button label={tr.dataReset.action} icon={Eraser} disabled={busy || !count} onPress={() => void reset()} />
        </View>
      </View>
    </Screen>
  );
}
