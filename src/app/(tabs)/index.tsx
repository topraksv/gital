import { useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import LogIn from "lucide-react-native/icons/log-in";
import Mail from "lucide-react-native/icons/mail";
import Plus from "lucide-react-native/icons/plus";
import ShoppingBasket from "lucide-react-native/icons/shopping-basket";

import { useSession } from "../../auth/session";
import { useFresh, useLists } from "../../data/hooks";
import { deleteLists, restoreList, type ListSummary } from "../../data/lists";
import { setListOrder } from "../../data/settings";
import { tr } from "../../i18n/tr";
import { useOffers } from "../../sync/sharing";
import { ProgressRing } from "../../ui/charts";
import { ArrivalScope, Button, Card, Divider, EmptyState, IconButton, ListRow, ReadFailed, Screen, SectionHeader, SlideUp, Tile, cardEdge } from "../../ui/components";
import { DraggableList, ReorderGrip, SortToggle } from "../../ui/draggable-list";
import { createNamedList } from "../../ui/list-sheet";
import { useShoppingNotices, useShoppingNow } from "../../ui/members-sheet";
import { OwnedCard, deleteWithUndo, selectionHeader, useSelection } from "../../ui/selection";
import { FirstRunTour } from "../../ui/tour";
import { density, font, listCard, motion, spacing, type, useTheme } from "../../ui/theme";

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

/**
 * The lists sorted by their grips, into the person's own order (SPEC 1.1):
 * any member orders a shared list among their own, for themselves.
 */
function SortLists({ lists, onDragging }: { lists: readonly ListSummary[]; onDragging: (dragging: boolean) => void }) {
  const { palette } = useTheme();
  return (
    <DraggableList
      items={lists}
      keyOf={(list) => list.id}
      gap={density.list.rowGap}
      onReorder={(keys) => setListOrder(keys)}
      onDragging={onDragging}
      renderRow={(list, handle, position) => (
        <View style={{ ...cardEdge(palette), flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.surface }}>
          <Tile id={list.id} name={list.name} size={listCard.tile} color={list.color} icon={list.icon} />
          <Text style={[type.body, { color: palette.textStrong, fontFamily: font.semibold, flex: 1 }]}>{list.name}</Text>
          <ReorderGrip handle={handle} name={list.name} position={position + 1} count={lists.length} />
        </View>
      )}
    />
  );
}

export default function Lists() {
  const lists = useLists();
  const [sorting, setSorting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const router = useRouter();
  const freshRows = useFresh(useSession((s) => s.userId) ?? "");
  const fresh = new Map(freshRows.data.map((row) => [row.listId, row.count]));
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

  const create = () => createNamedList("shop");

  const removeLists = (chosen: readonly { id: string; name: string }[]) => deleteWithUndo(chosen, tr.selection.nouns.list, deleteLists, restoreList);

  // Nothing is drawn until the query has answered once: "no lists" from a
  // query that has not run would be a lie for a frame.
  const answered = lists.updatedAt != null && freshRows.updatedAt != null;
  return (
    <Screen
      {...selectionHeader(
        selection,
        (chosen) => void removeLists(chosen),
        tr.tabs.lists,
        answered ? (
          <>
            <SortToggle sorting={sorting} canSort={lists.data.length > 1} onChange={setSorting} />
            <IconButton icon={LogIn} text={tr.sharing.joinShort} label={tr.sharing.join} onPress={() => router.push("/invite")} />
            <IconButton icon={Plus} label={tr.lists.create} tone="primary" onPress={create} />
          </>
        ) : null,
      )}
      width="workspace"
      scrollEnabled={!dragging}
    >
      {lists.status === "error" ? (
        <ReadFailed queries={[lists]} />
      ) : answered ? (
        <ArrivalScope>
          <OffersWaiting />
          {lists.data.length === 0 ? (
            <EmptyState
              icon={ShoppingBasket}
              title={tr.lists.emptyTitle}
              hint={tr.lists.emptyHint}
              action={<Button label={tr.lists.create} icon={Plus} onPress={create} />}
              skeleton={listCard.tile}
            />
          ) : sorting ? (
            <SortLists lists={lists.data} onDragging={setDragging} />
          ) : (
            <View style={{ gap: density.list.rowGap }}>
              {lists.data.map((list) => (
                <OwnedCard
                  key={list.id}
                  item={list}
                  selection={selection}
                  deleteLabel={tr.lists.delete(list.name)}
                  onDelete={() => void removeLists([list])}
                  open={() => router.push({ pathname: "/list/[id]", params: { id: list.id } })}
                  tileId={list.id}
                  look={list}
                  title={list.name}
                  detail={detail(list)}
                  badge={fresh.has(list.id) ? tr.sharing.freshCount(fresh.get(list.id)!) : null}
                  accessory={list.total > 0 ? <ProgressRing value={list.inBasket / list.total} /> : null}
                  hint={tr.lists.openHint}
                />
              ))}
            </View>
          )}
        </ArrivalScope>
      ) : null}
      <FirstRunTour />
    </Screen>
  );
}
