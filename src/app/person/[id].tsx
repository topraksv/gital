/**
 * One person's access to what the signed-in person owns (SPEC 1.4): each
 * list, wish collection and the Kiler, as none, view or edit. Where they are
 * not in yet a choice is an offer, which they accept or decline in the app;
 * where they are, it is their role, and none removes them. Reached by tapping
 * someone in a list's people, so it is always someone already sharing one.
 */

import { Fragment, useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { useSession } from "../../auth/session";
import { useCollections, useHeldPantry, useLists, usePlaces, useSettings } from "../../data/hooks";
import { removeMember, setMemberRole, type Member } from "../../data/members";
import { memberNameOf } from "../../data/settings";
import { tr } from "../../i18n/tr";
import { syncNow } from "../../sync/engine";
import { listOffers, offerList, type InviteRole, type ListOffer } from "../../sync/sharing";
import { Body, Card, ChoiceTile, Divider, ListRow, Notice, Screen, SectionHeader } from "../../ui/components";
import { appConfirm, appError } from "../../ui/dialog";
import { selectionTap } from "../../ui/haptics";
import { radioGroupKeys } from "../../ui/keys";
import { controlSize, spacing } from "../../ui/theme";

type Access = InviteRole | "none";
type Owned = { id: string; name: string };
/** The offers this person has made to the one on screen; `undefined` while asked. */
type Offers = ListOffer[] | { refused: string } | undefined;

export default function PersonScreen() {
  const params = useLocalSearchParams<{ id: string; list?: string; name?: string }>();
  const person = params.id;
  // The name is the one this device holds for them in the list they were
  // tapped in. The address's is only what shows while that is read: on the
  // web anyone can write a link that puts a familiar name on their own id.
  const places = usePlaces(person);
  const held = places.data.find((place) => place.listId === params.list)?.name;
  const name = (places.updatedAt == null ? params.name : held) || tr.sharing.unnamed;
  const userId = useSession((s) => s.userId) ?? "";
  const lists = useLists().data.filter((list) => list.owner);
  const collections = useCollections().data.filter((collection) => collection.owner);
  // A household is its owner's while their own id is the Kiler they hold.
  const household = useHeldPantry(userId).data[0]?.id === userId;
  const [offers, setOffers] = useState<Offers>();
  const reload = useCallback(
    () => listOffers().then((answer) => setOffers("refused" in answer ? answer : answer.offers.filter((offer) => offer.to === person))),
    [person],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  const group = (title: string, owned: readonly Owned[], choices: readonly Access[]) =>
    owned.length === 0 ? null : (
      <View>
        <SectionHeader>{title}</SectionHeader>
        <Card rows>
          {owned.map((item, index) => (
            <Fragment key={item.id}>
              {index > 0 ? <Divider /> : null}
              <AccessRow
                owned={item}
                person={person}
                member={places.data.find((place) => place.listId === item.id)}
                name={name}
                choices={choices}
                offers={offers}
                reload={reload}
              />
            </Fragment>
          ))}
        </Card>
      </View>
    );

  return (
    <Screen back="/" title={tr.sharing.openPerson(name)} width="focus">
      <View style={{ gap: spacing.lg }}>
        <Body muted>{tr.sharing.personHint(name)}</Body>
        {offers && "refused" in offers ? <Notice tone="error" text={offers.refused} /> : null}
        {lists.length + collections.length === 0 && !household ? <Body>{tr.sharing.personNothing}</Body> : null}
        {group(tr.tabs.lists, lists, ["none", "viewer", "editor"])}
        {group(tr.tabs.wishes, collections, ["none", "viewer", "editor"])}
        {/* A household has no one who only looks. */}
        {household ? group(tr.tabs.pantry, [{ id: userId, name: tr.tabs.pantry }], ["none", "editor"]) : null}
      </View>
    </Screen>
  );
}

function AccessRow({ owned, person, member, name, choices, offers, reload }: {
  owned: Owned;
  person: string;
  member: Member | undefined;
  name: string;
  choices: readonly Access[];
  offers: Offers;
  reload: () => Promise<void>;
}) {
  const userId = useSession((s) => s.userId) ?? "";
  const ownerName = memberNameOf(useSettings().data) ?? "";
  const offer = Array.isArray(offers) ? offers.find((made) => made.listId === owned.id) : undefined;
  const [busy, setBusy] = useState(false);
  // Someone not in is unknown until the offers have answered: "none" then could hide one waiting.
  const access: Access | undefined = member ? (member.role === "viewer" ? "viewer" : "editor") : offer ? offer.role : Array.isArray(offers) ? "none" : undefined;

  const give = async (next: Access) => {
    if (member && next !== "none") {
      await setMemberRole(member.id, next);
    } else if (member) {
      if (!(await appConfirm(tr.sharing.removeTitle, tr.sharing.removeMessage(name), tr.sharing.removeConfirm))) return;
      await removeMember(member.id);
    } else {
      const answer = await offerList(owned.id, person, next === "none" ? null : next, ownerName, () => syncNow(userId));
      if ("refused" in answer) return void appError(answer.refused);
      await reload();
    }
    selectionTap();
  };
  const choose = async (next: Access) => {
    if (next === access) return;
    setBusy(true);
    await give(next).catch(() => void appError(tr.errors.saveFailed));
    setBusy(false);
  };

  return (
    <View style={{ paddingBottom: spacing.md, gap: spacing.xs }}>
      <ListRow title={owned.name} subtitle={member ? tr.sharing.member : offer ? tr.sharing.offered : undefined} />
      <View role="radiogroup" {...radioGroupKeys()} accessibilityLabel={tr.sharing.access(owned.name)} style={{ flexDirection: "row", gap: spacing.sm }}>
        {choices.map((choice) => (
          <ChoiceTile
            key={choice}
            label={choice === "none" ? tr.sharing.accessNone : tr.sharing.roles[choice]}
            selected={access === choice}
            disabled={busy || access === undefined}
            minHeight={controlSize.minimumTarget}
            onPress={() => void choose(choice)}
          />
        ))}
      </View>
    </View>
  );
}
