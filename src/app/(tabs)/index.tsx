import { View } from "react-native";
import { useRouter } from "expo-router";
import LogIn from "lucide-react-native/icons/log-in";
import Mail from "lucide-react-native/icons/mail";
import Plus from "lucide-react-native/icons/plus";
import ShoppingBasket from "lucide-react-native/icons/shopping-basket";
import Trash from "lucide-react-native/icons/trash";

import { useSession } from "../../auth/session";
import { useFresh, useLists } from "../../data/hooks";
import { createList, deleteLists, restoreList } from "../../data/lists";
import { NAME_MAX } from "../../domain/names";
import { tr } from "../../i18n/tr";
import { useOffers } from "../../sync/sharing";
import { ProgressRing } from "../../ui/charts";
import { ArrivalScope, Button, Card, Divider, EmptyState, IconButton, LinkCard, ListRow, ReadFailed, Screen, SectionHeader, SlideUp } from "../../ui/components";
import { appError, appPrompt } from "../../ui/dialog";
import { selectionTap } from "../../ui/haptics";
import { RowMotion, RowSwipe } from "../../ui/list-motion";
import { useShoppingNotices, useShoppingNow } from "../../ui/members-sheet";
import { deleteWithUndo, selectionHeader, useSelection } from "../../ui/selection";
import { FirstRunTour, usePulledOnce } from "../../ui/tour";
import { density, motion } from "../../ui/theme";

/** Offers waiting on this person (SPEC 1.4); each opens the invitation screen, where it is joined or declined. */
function OffersWaiting() {
  const router = useRouter();
  const offers = useOffers((s) => s.received);
  if (offers.length === 0) return null;
  return (
    <SlideUp distance={motion.travel.bar}>
      <SectionHeader flush>{tr.sharing.offers}</SectionHeader>
      <Card rows>
        {offers.map((offer, index) => (
          <View key={offer.listId}>
            {index > 0 ? <Divider /> : null}
            <ListRow
              icon={Mail}
              title={tr.sharing.invitedTo(offer.fromName, offer.kind, offer.listName)}
              subtitle={tr.sharing.roles[offer.role]}
              chevron
              onPress={() => router.push({ pathname: "/invite", params: { offer: offer.listId } })}
            />
          </View>
        ))}
      </Card>
    </SlideUp>
  );
}

export default function Lists() {
  const pulled = usePulledOnce();
  const lists = useLists();
  const router = useRouter();
  const fresh = new Map(useFresh(useSession((s) => s.userId) ?? "").data.map((row) => [row.listId, row.count]));
  // The Lists tab is the tabs' first screen and stays mounted under every list pushed over it, so the watcher lives here.
  const shoppers = useShoppingNow();
  useShoppingNotices(shoppers);
  // Only lists the person owns can be deleted, so only they swipe or are chosen.
  const selection = useSelection(lists.data.filter((list) => list.owner));
  const detail = (list: { id: string; total: number; inBasket: number }) => {
    const here = shoppers.filter((shopper) => shopper.listId === list.id).length;
    const summary = tr.lists.summary(list.total, list.inBasket);
    return here ? `${tr.sharing.shoppingCount(here)} · ${summary}` : summary;
  };

  const create = async () => {
    const name = await appPrompt(tr.lists.createTitle, tr.lists.createMessage, {
      examples: tr.placeholders.listName,
      confirmLabel: tr.lists.createConfirm,
      maxLength: NAME_MAX,
    });
    if (name == null) return;
    try {
      await createList(name);
      selectionTap();
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };

  const removeLists = (chosen: readonly { id: string; name: string }[]) => deleteWithUndo(chosen, tr.selection.nouns.list, deleteLists, restoreList);

  // Nothing is drawn until the query has answered once: "no lists" from a
  // query that has not run would be a lie for a frame.
  const answered = lists.updatedAt != null;
  return (
    <Screen
      {...selectionHeader(
        selection,
        (chosen) => void removeLists(chosen),
        tr.tabs.lists,
        answered ? (
          <>
            <IconButton icon={LogIn} text={tr.sharing.joinShort} label={tr.sharing.join} onPress={() => router.push("/invite")} />
            <IconButton icon={Plus} label={tr.lists.create} tone="primary" onPress={create} />
          </>
        ) : null,
      )}
      width="workspace"
    >
      {lists.status === "error" ? (
        <ReadFailed queries={[lists]} />
      ) : answered ? (
        <ArrivalScope>
          <OffersWaiting />
          {lists.data.length === 0 ? (
            pulled && <EmptyState
              icon={ShoppingBasket}
              title={tr.lists.emptyTitle}
              hint={tr.lists.emptyHint}
              action={<Button label={tr.lists.create} icon={Plus} onPress={create} />}
            />
          ) : (
            <View style={{ gap: density.list.rowGap }}>
              {lists.data.map((list) => {
                const left = list.owner
                  ? { icon: Trash, tone: "destructive" as const, label: tr.lists.delete(list.name), run: () => void removeLists([list]) }
                  : undefined;
                return (
                <RowMotion key={list.id}>
                <SlideUp distance={motion.travel.bar}>
                  <RowSwipe left={selection.active ? undefined : left}>
                  <LinkCard
                    tileId={list.id}
                    look={list}
                    title={list.name}
                    detail={detail(list)}
                    badge={fresh.has(list.id) ? tr.sharing.freshCount(fresh.get(list.id)!) : null}
                    accessory={list.total > 0 ? <ProgressRing value={list.inBasket / list.total} /> : null}
                    hint={tr.lists.openHint}
                    onOpen={() => (selection.active ? (list.owner ? selection.toggle(list.id) : undefined) : router.push({ pathname: "/list/[id]", params: { id: list.id } }))}
                    onLongPress={list.owner ? () => selection.begin(list.id) : undefined}
                    selected={selection.active && list.owner ? selection.has(list.id) : undefined}
                  />
                  </RowSwipe>
                </SlideUp>
                </RowMotion>
                );
              })}
            </View>
          )}
        </ArrivalScope>
      ) : null}
      <FirstRunTour />
    </Screen>
  );
}
