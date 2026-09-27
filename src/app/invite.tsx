import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import ScanQrCode from "lucide-react-native/icons/scan-qr-code";
import UserPlus from "lucide-react-native/icons/user-plus";

import { useSession } from "../auth/session";
import { useCollections, useLists } from "../data/hooks";
import { tr } from "../i18n/tr";
import { canScan, launchScanner, onScanned } from "../services/barcode-scan";
import { syncNow } from "../sync/engine";
import { acceptInvite, inviteFromPage, inviteTokenFrom } from "../sync/sharing";
import { Body, Button, Screen, TextField } from "../ui/components";
import { appError } from "../ui/dialog";
import { successNotice } from "../ui/haptics";
import { memberName } from "../ui/members-sheet";
import { spacing } from "../ui/theme";

/**
 * Joining a list by its invitation (SPEC 1.4). The web opens here from the
 * link itself, the token in the fragment; the phone, which runs in Expo Go and
 * so is not the link's target, gets here from Listeler with the link pasted or
 * its QR code scanned, or from the clipboard's offer.
 */
export default function InviteScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const userId = useSession((s) => s.userId) ?? "";
  const lists = useLists();
  const collections = useCollections();
  const [token, setToken] = useState<string | null>(
    () => (params.token ? inviteTokenFrom(params.token) : null) ?? (Platform.OS === "web" && typeof location !== "undefined" ? inviteFromPage(location) : null),
  );
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState<string | null>(null);

  // Held in memory from here: in the address bar, a reload would send the
  // token to the host's logs, and history would keep it.
  useEffect(() => {
    if (Platform.OS === "web" && (location.search || location.hash)) history.replaceState(null, "", location.pathname);
  }, []);

  useEffect(
    () =>
      onScanned((code) => {
        const read = inviteTokenFrom(code);
        if (read) setToken(read);
        else void appError(tr.sharing.joinLinkInvalid);
      }),
    [],
  );

  // The list arrives with the sync the join runs; the screen then becomes it.
  if (joined && lists.data.some((list) => list.id === joined)) return <Redirect href={{ pathname: "/list/[id]", params: { id: joined } }} />;
  if (joined && collections.data.some((collection) => collection.id === joined)) {
    return <Redirect href={{ pathname: "/collection/[id]", params: { id: joined } }} />;
  }

  const join = async (from: string) => {
    setBusy(true);
    try {
      const name = await memberName();
      if (name == null) return;
      const answer = await acceptInvite(from, name);
      if ("refused" in answer) return void appError(answer.refused);
      successNotice();
      await syncNow(userId).catch(() => false);
      setJoined(answer.listId);
    } catch {
      void appError(tr.sharing.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  const pasted = inviteTokenFrom(typed);
  const scan = () =>
    launchScanner("invite").then(
      (launched) => {
        if (!launched) void appError(tr.sharing.joinCamera);
      },
      () => appError(tr.barcode.failed),
    );

  return (
    <Screen back="/" title={tr.sharing.joinTitle} width="focus">
      {joined ? (
        <View style={{ gap: spacing.lg }}>
          <Body>{tr.sharing.joinedLater}</Body>
          <Button label={tr.tabs.lists} onPress={() => router.replace("/")} />
        </View>
      ) : token ? (
        <View style={{ gap: spacing.lg }}>
          <Body>{tr.sharing.joinBody}</Body>
          <Button label={tr.sharing.joinAccept} icon={UserPlus} disabled={busy} onPress={() => join(token)} />
        </View>
      ) : (
        <View style={{ gap: spacing.lg }}>
          <Body>{tr.sharing.joinPaste}</Body>
          <TextField
            value={typed}
            onChangeText={setTyped}
            onSubmitEditing={() => pasted && join(pasted)}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={tr.sharing.joinLink}
            placeholder={tr.sharing.joinLink}
          />
          <Button label={tr.sharing.joinAccept} icon={UserPlus} disabled={busy || !pasted} onPress={() => pasted && join(pasted)} />
          {canScan ? <Button label={tr.sharing.joinScan} icon={ScanQrCode} variant="ghost" onPress={() => void scan()} /> : null}
        </View>
      )}
    </Screen>
  );
}
