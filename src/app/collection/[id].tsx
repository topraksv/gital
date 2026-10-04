import { useEffect, useRef, useState } from "react";
import { Text, View, type TextInput } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import ArrowUpDown from "lucide-react-native/icons/arrow-up-down";
import Check from "lucide-react-native/icons/check";
import Gift from "lucide-react-native/icons/gift";
import Pencil from "lucide-react-native/icons/pencil";
import Plus from "lucide-react-native/icons/plus";
import Trash from "lucide-react-native/icons/trash";
import Undo2 from "lucide-react-native/icons/undo-2";

import { useCollections, useWishes } from "../../data/hooks";
import { deleteLists, editList, restoreList } from "../../data/lists";
import { addWish, deleteWishes, restoreWish, saveWish, toggleWishBought, type Collection, type WishChange } from "../../data/wishes";
import type { ListLook } from "../../domain/lists";
import { LINK_MAX, WISH_ORDERS, leadOf, shopOf, sortWishes, type Wish, type WishOrder } from "../../domain/wishes";
import { formatMinor } from "../../domain/money";
import { tr } from "../../i18n/tr";
import { ArrivalScope, Body, EmptyState, IconButton, ReadFailed, Screen, SectionHeader, SlideUp, TextField, Tile, cardEdge, RowOpen, RowTick } from "../../ui/components";
import { appError } from "../../ui/dialog";
import { mediumImpact, selectionTap } from "../../ui/haptics";
import type { MemberRole } from "../../db/schema";
import { ListSheet } from "../../ui/list-sheet";
import { EditorsOnly, PeopleActions, emptyHintFor, useShare } from "../../ui/members-sheet";
import { RowMotion, RowSwipe } from "../../ui/list-motion";
import { useCountUp } from "../../ui/motion";
import { navigateBack } from "../../ui/navigation";
import { readLinkPages, readUnreadPages, useReadingWish } from "../../ui/page-reader";
import { density, font, itemRow, motion, offset, spacing, type, useTheme } from "../../ui/theme";
import { WishSuggestions } from "../../ui/suggestions";
import { deleteWithUndo, selectionHeader, useSelection } from "../../ui/selection";
import { showUndo } from "../../ui/undo";
import { WishSheet } from "../../ui/wish-sheet";

/** One wish collection (SPEC 7): what is wished, the most wanted first, and what it comes to. */
export default function CollectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const collections = useCollections();
  const wishes = useWishes(id);
  // A collection is shared as a list is (SPEC 7.8).
  const { members, userId, role, viewer } = useShare(id);
  const queries = [collections, wishes, members];
  const [leaving, setLeaving] = useState<Collection | null>(null);
  const [editing, setEditing] = useState<Wish | null>(null);
  // How the open wishes are ordered, for this visit: a price order is a question asked now.
  const [order, setOrder] = useState<WishOrder>("wanted");
  const shown = sortWishes(wishes.data, order);
  const selection = useSelection(shown);
  const collection = leaving ?? collections.data.find((candidate) => candidate.id === id);
  // Never for a viewer, whose write the server refuses; so not before the members are read.
  const reads = members.updatedAt != null && !viewer;
  useEffect(() => {
    if (reads) readUnreadPages(wishes.data);
  }, [reads, wishes.data]);

  if (collections.updatedAt != null && !collection) return <Redirect href="/wishes" />;

  const open = shown.filter((wish) => wish.boughtAt == null);
  const bought = shown.filter((wish) => wish.boughtAt != null);

  const remove = async (current: Collection) => {
    setLeaving(current);
    mediumImpact();
    try {
      const snapshot = await deleteLists([current.id]);
      if (snapshot) showUndo(tr.common.deleted(current.name), () => restoreList(snapshot));
      navigateBack(router, "/wishes");
    } catch {
      setLeaving(null);
      void appError(tr.errors.deleteFailed);
    }
  };

  const toggle = async (wish: Wish) => {
    try {
      await toggleWishBought(wish.id);
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };

  const save = async (wish: Wish, change: WishChange) => {
    setEditing(null);
    try {
      await saveWish(wish.id, change);
      readLinkPages(wish.id);
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };

  const removeWishes = (chosen: readonly Wish[]) => {
    setEditing(null);
    return deleteWithUndo(chosen, tr.selection.nouns.wish, deleteWishes, restoreWish);
  };
  const removeWish = (wish: Wish) => removeWishes([wish]);

  const row = (wish: Wish) => {
    if (viewer) {
      return (
        <RowMotion key={wish.id}>
          <SlideUp distance={motion.travel.bar}>
            <WishRow wish={wish} onOpen={() => undefined} onToggle={() => undefined} readOnly />
          </SlideUp>
        </RowMotion>
      );
    }
    const right = { icon: wish.boughtAt != null ? Undo2 : Check, tone: "secondary" as const, label: wish.boughtAt != null ? tr.wishes.markNotBought(wish.name) : tr.wishes.markBought(wish.name), run: () => void toggle(wish) };
    const left = { icon: Trash, tone: "destructive" as const, label: tr.wishes.deleteWish(wish.name), run: () => void removeWish(wish) };
    return (
      <RowMotion key={wish.id}>
        <SlideUp distance={motion.travel.bar}>
          <RowSwipe right={selection.active ? undefined : right} left={selection.active ? undefined : left}>
            <WishRow
              wish={wish}
              onOpen={() => (selection.active ? selection.toggle(wish.id) : setEditing(wish))}
              onLongPress={() => selection.begin(wish.id)}
              selected={selection.active ? selection.has(wish.id) : undefined}
              onToggle={() => {
                if (selection.active) return selection.toggle(wish.id);
                selectionTap();
                void toggle(wish);
              }}
              readOnly={false}
            />
          </RowSwipe>
        </SlideUp>
      </RowMotion>
    );
  };

  return (
    <Screen
      back="/wishes"
      {...selectionHeader(
        selection,
        (chosen) => void removeWishes(chosen),
        collection?.name,
        <CollectionActions
          collection={leaving ? undefined : collection}
          userId={userId}
          role={role}
          viewer={viewer}
          order={order}
          canOrder={open.length >= 2}
          onOrder={setOrder}
          onRemove={remove}
        />,
      )}
      width="workspace"
    >
      {queries.some((query) => query.status === "error") ? (
        <ReadFailed queries={queries} />
      ) : collection && queries.every((query) => query.updatedAt != null) ? (
        <ArrivalScope>
          <EditorsOnly viewer={viewer} fallback={<Body muted style={{ marginBottom: spacing.lg }}>{tr.sharing.viewOnly}</Body>}>
            <AddWish listId={collection.id} open={open} />
          </EditorsOnly>
          {collection.openTotalMinor == null ? null : <OpenTotal totalMinor={collection.openTotalMinor} />}
          {wishes.data.length === 0 ? (
            <EmptyState icon={Gift} title={tr.wishes.itemsEmptyTitle} hint={emptyHintFor(viewer, tr.wishes.itemsEmptyHint)} />
          ) : (
            <View style={{ gap: density.list.rowGap }}>
              {[
                ...open.map(row),
                bought.length > 0 ? (
                  <RowMotion key="bought">
                    <SlideUp distance={motion.travel.bar}>
                      <SectionHeader>{tr.wishes.bought}</SectionHeader>
                    </SlideUp>
                  </RowMotion>
                ) : null,
                ...bought.map(row),
              ]}
            </View>
          )}
        </ArrivalScope>
      ) : null}
      {editing ? (
        <WishSheet
          key={editing.id}
          wish={editing}
          onSave={(change) => save(editing, change)}
          onDelete={() => removeWish(editing)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Screen>
  );
}

/** The header's actions outside choosing; none while the collection is not there or is going. */
function CollectionActions({
  collection,
  userId,
  role,
  viewer,
  order,
  canOrder,
  onOrder,
  onRemove,
}: {
  collection: Collection | undefined;
  userId: string;
  role: MemberRole;
  viewer: boolean;
  order: WishOrder;
  canOrder: boolean;
  onOrder: (order: WishOrder) => void;
  onRemove: (collection: Collection) => void;
}) {
  if (!collection) return null;
  return (
    <>
      <IconButton
        icon={ArrowUpDown}
        text={tr.wishes.orders[order]}
        label={tr.wishes.orderLabel(tr.wishes.orders[order])}
        disabled={!canOrder}
        onPress={() => onOrder(WISH_ORDERS[(WISH_ORDERS.indexOf(order) + 1) % WISH_ORDERS.length]!)}
      />
      <PeopleActions list={collection} userId={userId} role={role} back="/wishes" deleteLabel={tr.wishes.delete(collection.name)} onDelete={() => onRemove(collection)}>
        <EditorsOnly viewer={viewer}>
          <EditCollection collection={collection} />
        </EditorsOnly>
      </PeopleActions>
    </>
  );
}

/** What the open wishes come to, counting across each change. */
function OpenTotal({ totalMinor }: { totalMinor: number }) {
  const { palette } = useTheme();
  const shown = useCountUp(totalMinor);
  return <Text style={[type.small, { color: palette.textSecondary, marginBottom: spacing.md }]}>{tr.wishes.openTotal(shown)}</Text>;
}

/** A name or a pasted link; a link becomes a wish named after its shop (SPEC 7.1). */
function AddWish({ listId, open }: { listId: string; open: readonly { name: string }[] }) {
  const [text, setText] = useState("");
  const field = useRef<TextInput>(null);
  const add = async (typed = text) => {
    if (typed.trim() === "") return;
    setText("");
    try {
      readLinkPages(await addWish(listId, typed));
      selectionTap();
    } catch {
      setText((current) => (current === "" ? typed : current));
      void appError(tr.errors.saveFailed);
    }
  };
  return (
    <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <TextField
          ref={field}
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => void add()}
          blurOnSubmit={false}
          returnKeyType="done"
          autoCapitalize="none"
          accessibilityLabel={tr.wishes.addLabel}
          examples={tr.placeholders.wishAdd}
          maxLength={LINK_MAX}
          style={{ flex: 1 }}
        />
        <IconButton icon={Plus} label={tr.wishes.add} tone="primary" field onPress={() => void add()} />
      </View>
      {text ? (
        <WishSuggestions
          text={text}
          listed={open}
          onPick={(entries) => {
            // A wish is one name, never split at a comma: the chip's is the one added.
            void add(entries.at(-1)!.name);
            field.current?.focus();
          }}
        />
      ) : null}
    </View>
  );
}

/** What a wish's row says under its name: wanted most, where it is cheapest and for how much, or the guess. */
function detailOf(wish: Wish): { text: string; wanted?: boolean }[] {
  const lead = leadOf(wish.links);
  const parts: { text: string; wanted?: boolean }[] = [];
  if (wish.priority === 2) parts.push({ text: tr.wishes.wanted, wanted: true });
  if (lead) parts.push({ text: shopOf(lead.url) });
  if (lead?.priceMinor != null) parts.push({ text: formatMinor(lead.priceMinor) });
  else if (wish.estimateMinor != null) parts.push({ text: tr.wishes.estimated(wish.estimateMinor) });
  if (wish.dueOn && wish.boughtAt == null) parts.push({ text: tr.wishes.dueOn(wish.dueOn) });
  return parts;
}

function WishRow({
  wish,
  onOpen,
  onToggle,
  onLongPress,
  selected,
  readOnly,
}: {
  wish: Wish;
  onOpen: () => void;
  onToggle: () => void;
  onLongPress?: () => void;
  /** Defined while a selection is under way: whether this row is in it. */
  selected?: boolean;
  readOnly: boolean;
}) {
  const { palette } = useTheme();
  const done = wish.boughtAt != null;
  const parts = detailOf(wish);
  if (useReadingWish(wish.id)) parts.push({ text: tr.wishes.reading });
  return (
    <View style={{ ...cardEdge(palette), padding: 0, flexDirection: "row", backgroundColor: palette.surface, overflow: "hidden" }}>
      <RowOpen label={tr.common.withDetail(wish.name, parts.map((part) => part.text).join(", "))} hint={tr.wishes.openWishHint} onPress={onOpen} onLongPress={onLongPress} selected={selected} disabled={readOnly}>
        <Tile id={wish.id} name={wish.name} photo={wish.photo} size={itemRow.tile} />
        <View style={{ flex: 1, minWidth: 0, gap: offset.tight }}>
          <Text
            style={[
              type.body,
              { fontFamily: font.medium, color: done ? palette.textSecondary : palette.textStrong, textDecorationLine: done ? "line-through" : "none" },
            ]}
          >
            {wish.name}
          </Text>
          {parts.length > 0 ? (
            <Text style={[type.small, { color: palette.textSecondary }]}>
              {parts.map((part, at) => (
                <Text key={at} style={part.wanted ? { fontFamily: font.semibold, color: palette.warningText } : null}>
                  {at > 0 ? tr.common.separator : null}
                  {part.text}
                </Text>
              ))}
            </Text>
          ) : null}
        </View>
      </RowOpen>
      <RowTick
        checked={done}
        selected={selected}
        label={selected === undefined ? tr.common.withDetail(wish.name, tr.wishes.bought) : wish.name}
        onToggle={onToggle}
        disabled={readOnly}
      />
    </View>
  );
}

/** The pencil and the collection panel: the list panel, since a collection is a list of its own kind. */
function EditCollection({ collection }: { collection: Collection }) {
  const [open, setOpen] = useState(false);
  const save = async (look: ListLook) => {
    setOpen(false);
    try {
      await editList(collection.id, look);
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };
  return (
    <>
      <IconButton icon={Pencil} label={tr.wishes.edit(collection.name)} onPress={() => setOpen(true)} />
      {open ? <ListSheet list={collection} onSave={save} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
