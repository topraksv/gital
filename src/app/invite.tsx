import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import LogIn from "lucide-react-native/icons/log-in";

import { useSession } from "../auth/session";
import { useCollections, useLists, usePantry, useSettings } from "../data/hooks";
import type { PantryItem } from "../data/pantry";
import { memberNameOf, setMemberName } from "../data/settings";
import { NAME_MAX } from "../domain/names";
import { tr } from "../i18n/tr";
import { pantryToBring, syncNow } from "../sync/engine";
import { acceptInvite, answerOffer, inviteFromPage, inviteTokenFrom, peekInvite, useOffers, type InvitePeek, type ListOffer } from "../sync/sharing";
import { Body, Button, ChoiceTile, Notice, Screen, TextField } from "../ui/components";
import { appError } from "../ui/dialog";
import { successNotice } from "../ui/haptics";
import { radioGroupKeys } from "../ui/keys";
import { navigateBack } from "../ui/navigation";
import { controlSize, spacing } from "../ui/theme";
import { showNotice } from "../ui/undo";

type Joined = { id: string; kind: InvitePeek["kind"] };
type Peeked = Awaited<ReturnType<typeof peekInvite>>;
type Accept = (name: string, bring: readonly PantryItem[] | undefined) => Promise<{ listId: string } | { refused: string }>;

/**
 * Joining by an invitation (SPEC 1.4, 12.13), in one press: the page says
 * what the link is to and from whom before anything is spent, asks the name
 * the others will see in place, and for a household whether the person's own
 * Kiler comes along. The web opens here from the link itself, the token in the
 * fragment; the phone, which runs in Expo Go and so is not the link's target,
 * gets here from Listeler with the link pasted, or from the clipboard's offer.
 * An offer in the app opens here from Listeler too, and is joined the same
 * way or declined.
 */
export default function InviteScreen() {
  const params = useLocalSearchParams<{ token?: string; offer?: string }>();
  const [linked] = useState<string | null>(
    () => (params.token ? inviteTokenFrom(params.token) : null) ?? (Platform.OS === "web" && typeof location !== "undefined" ? inviteFromPage(location) : null),
  );
  // Held as the screen opened with it, since answering takes it out of the store.
  const [offer] = useState(() => (params.offer ? (useOffers.getState().received.find((held) => held.listId === params.offer) ?? null) : undefined));
  const [joined, setJoined] = useState<Joined | null>(null);

  // Held in memory from here: in the address bar, a reload would send the
  // token to the host's logs, and history would keep it.
  useEffect(() => {
    if (Platform.OS === "web" && (location.search || location.hash)) history.replaceState(null, "", location.pathname);
  }, []);

  return (
    <Screen back="/" title={tr.sharing.joinTitle} width="focus">
      {joined ? (
        <JoinedTo joined={joined} />
      ) : offer !== undefined ? (
        <Offered offer={offer} onJoined={setJoined} />
      ) : (
        <Invitation linked={linked} onJoined={setJoined} />
      )}
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
      {token && peek && !("refused" in peek) ? <Join invite={peek} accept={(name, bring) => acceptInvite(token, name, bring)} onJoined={onJoined} /> : null}
    </View>
  );
}

/** An offer made in the app (SPEC 1.4); `null` when it was answered or withdrawn before the screen opened. */
function Offered({ offer, onJoined }: { offer: ListOffer | null; onJoined: (joined: Joined) => void }) {
  const router = useRouter();
  if (!offer) return <Notice tone="error" text={tr.sharing.errInvite} />;

  const decline = async () => {
    const answer = await answerOffer(offer.listId, false, "");
    if ("refused" in answer) return void appError(answer.refused);
    showNotice(tr.sharing.declined);
    navigateBack(router, "/");
  };
  const accept: Accept = async (name, bring) => {
    const answer = await answerOffer(offer.listId, true, name, bring);
    return "refused" in answer ? answer : { listId: offer.listId };
  };

  return (
    <View style={{ gap: spacing.lg }}>
      <Join invite={{ kind: offer.kind, name: offer.listName, inviter: offer.fromName }} accept={accept} decline={decline} onJoined={onJoined} />
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

/** `decline` is an offer's: one press waits on the other, so a join and a refusal never cross. */
function Join({ invite, accept, decline, onJoined }: { invite: InvitePeek; accept: Accept; decline?: () => Promise<void>; onJoined: (joined: Joined) => void }) {
  const userId = useSession((s) => s.userId) ?? "";
  const own = usePantry();
  const known = memberNameOf(useSettings().data);
  const [named, setNamed] = useState("");
  const [bring, setBring] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"join" | "decline" | null>(null);
  const name = known ?? named.trim();
  const choosing = invite.kind === "pantry" && own.data.length > 0;

  const hold = async (press: "join" | "decline", work: () => Promise<void>) => {
    setBusy(press);
    try {
      await work();
    } catch {
      void appError(tr.sharing.errGeneric);
    }
    setBusy(null);
  };
  const join = async () => {
    if (!known) await setMemberName(name);
    // Each product goes as the stock the device counted; joining empty sends none.
    const counted = invite.kind !== "pantry" ? undefined : bring ? await pantryToBring(userId) : [];
    if (counted === null) return void appError(tr.sharing.errGeneric);
    const answer = await accept(name, counted);
    if ("refused" in answer) return void appError(answer.refused);
    successNotice();
    await syncNow(userId).catch(() => false);
    onJoined({ id: answer.listId, kind: invite.kind });
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
        icon={LogIn}
        loading={busy === "join"}
        disabled={busy !== null || name === "" || (choosing && bring == null)}
        onPress={() => void hold("join", join)}
      />
      {decline ? (
        <Button label={tr.sharing.decline} variant="secondary" loading={busy === "decline"} disabled={busy !== null} onPress={() => void hold("decline", decline)} />
      ) : null}
    </>
  );
}
