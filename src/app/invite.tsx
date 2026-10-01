import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import UserPlus from "lucide-react-native/icons/user-plus";

import { useSession } from "../auth/session";
import { useCollections, useLists, usePantry, useSettings } from "../data/hooks";
import { memberNameOf, setMemberName } from "../data/settings";
import { NAME_MAX } from "../domain/names";
import { tr } from "../i18n/tr";
import { syncNow } from "../sync/engine";
import { acceptInvite, inviteFromPage, inviteTokenFrom, peekInvite, type InvitePeek } from "../sync/sharing";
import { Body, Button, ChoiceTile, Notice, Screen, TextField } from "../ui/components";
import { appError } from "../ui/dialog";
import { successNotice } from "../ui/haptics";
import { radioGroupKeys } from "../ui/keys";
import { controlSize, spacing } from "../ui/theme";

type Joined = { id: string; kind: InvitePeek["kind"] };
type Peeked = Awaited<ReturnType<typeof peekInvite>>;

/**
 * Joining by an invitation (SPEC 1.4, 12.13), in one press: the page says
 * what the link is to and from whom before anything is spent, asks the name
 * the others will see in place, and for a household whether the person's own
 * Kiler comes along. The web opens here from the link itself, the token in the
 * fragment; the phone, which runs in Expo Go and so is not the link's target,
 * gets here from Listeler with the link pasted, or from the clipboard's offer.
 */
export default function InviteScreen() {
  const params = useLocalSearchParams<{ token?: string }>();
  const [linked] = useState<string | null>(
    () => (params.token ? inviteTokenFrom(params.token) : null) ?? (Platform.OS === "web" && typeof location !== "undefined" ? inviteFromPage(location) : null),
  );
  const [joined, setJoined] = useState<Joined | null>(null);

  // Held in memory from here: in the address bar, a reload would send the
  // token to the host's logs, and history would keep it.
  useEffect(() => {
    if (Platform.OS === "web" && (location.search || location.hash)) history.replaceState(null, "", location.pathname);
  }, []);

  return (
    <Screen back="/" title={tr.sharing.joinTitle} width="focus">
      {joined ? <JoinedTo joined={joined} /> : <Invitation linked={linked} onJoined={setJoined} />}
    </Screen>
  );
}

/**
 * Kiler is the household's once the join's sync has run. A list arrives with
 * that sync, and the screen then becomes it; until then it says it will.
 */
function JoinedTo({ joined }: { joined: Joined }) {
  const router = useRouter();
  const lists = useLists();
  const collections = useCollections();
  if (joined.kind === "pantry") return <Redirect href="/pantry" />;
  if (lists.data.some((list) => list.id === joined.id)) return <Redirect href={{ pathname: "/list/[id]", params: { id: joined.id } }} />;
  if (collections.data.some((collection) => collection.id === joined.id)) return <Redirect href={{ pathname: "/collection/[id]", params: { id: joined.id } }} />;
  return (
    <View style={{ gap: spacing.lg }}>
      <Body>{tr.sharing.joinedLater}</Body>
      <Button label={tr.tabs.lists} onPress={() => router.replace("/")} />
    </View>
  );
}

/** The link the page opened with, or one pasted here, and what it is to. */
function Invitation({ linked, onJoined }: { linked: string | null; onJoined: (joined: Joined) => void }) {
  const [typed, setTyped] = useState("");
  const token = linked ?? inviteTokenFrom(typed);
  const peek = usePeek(token);
  return (
    <View style={{ gap: spacing.lg }}>
      {linked ? null : (
        <>
          <Body>{tr.sharing.joinPaste}</Body>
          <TextField
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={tr.sharing.joinLink}
            placeholder={tr.sharing.joinLink}
            error={typed.trim() !== "" && !token ? tr.sharing.joinLinkInvalid : null}
          />
        </>
      )}
      {peek === null ? <Notice tone="error" text={tr.sharing.errInvite} /> : null}
      {peek && "refused" in peek ? <Notice tone="error" text={peek.refused} /> : null}
      {token && peek && !("refused" in peek) ? <Join token={token} invite={peek} onJoined={onJoined} /> : null}
    </View>
  );
}

/** What `token` is to, asked once per token; `undefined` while it is being asked. */
function usePeek(token: string | null): Peeked | undefined {
  const [peeked, setPeeked] = useState<{ token: string; answer: Peeked } | null>(null);
  useEffect(() => {
    if (!token) return;
    let current = true;
    peekInvite(token).then(
      (answer) => current && setPeeked({ token, answer }),
      () => current && setPeeked({ token, answer: { refused: tr.sharing.errGeneric } }),
    );
    return () => {
      current = false;
    };
  }, [token]);
  // An answer about another token, while the next is being asked, is no answer.
  return peeked?.token === token ? peeked.answer : undefined;
}

function Join({ token, invite, onJoined }: { token: string; invite: InvitePeek; onJoined: (joined: Joined) => void }) {
  const userId = useSession((s) => s.userId) ?? "";
  const own = usePantry();
  const known = memberNameOf(useSettings().data);
  const [named, setNamed] = useState("");
  const [bring, setBring] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const name = known ?? named.trim();
  const choosing = invite.kind === "pantry" && own.data.length > 0;

  const join = async () => {
    setBusy(true);
    try {
      if (!known) await setMemberName(name);
      // Each product goes as the stock the device counted; joining empty sends none.
      const answer = await acceptInvite(token, name, invite.kind === "pantry" ? (bring ? own.data : []) : undefined);
      if ("refused" in answer) return void appError(answer.refused);
      successNotice();
      await syncNow(userId).catch(() => false);
      onJoined({ id: answer.listId, kind: invite.kind });
    } catch {
      void appError(tr.sharing.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Body>
        {tr.sharing.invitedTo(invite.inviter, invite.kind, invite.name)} {invite.kind === "pantry" ? tr.sharing.joinPantryBody : tr.sharing.joinBody}
      </Body>
      {known ? null : <TextField label={tr.sharing.nameTitle} value={named} onChangeText={setNamed} maxLength={NAME_MAX} examples={tr.placeholders.memberName} />}
      {choosing ? (
        <View role="radiogroup" {...radioGroupKeys()} accessibilityLabel={tr.sharing.bringChoice} style={{ gap: spacing.sm }}>
          <ChoiceTile
            label={tr.sharing.bring}
            description={tr.sharing.bringHint(own.data.length)}
            selected={bring === true}
            minHeight={controlSize.minimumTarget}
            onPress={() => setBring(true)}
          />
          <ChoiceTile
            label={tr.sharing.bringNone}
            description={tr.sharing.bringNoneHint}
            selected={bring === false}
            minHeight={controlSize.minimumTarget}
            onPress={() => setBring(false)}
          />
        </View>
      ) : null}
      <Button
        label={tr.sharing.joinAccept}
        icon={UserPlus}
        loading={busy}
        disabled={busy || name === "" || (choosing && bring == null)}
        onPress={() => void join()}
      />
    </>
  );
}
