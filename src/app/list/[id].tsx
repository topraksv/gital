import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, ScrollView, StyleSheet, Text, View, type TextInput } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import Check from "lucide-react-native/icons/check";
import CheckCheck from "lucide-react-native/icons/check-check";
import ClipboardPaste from "lucide-react-native/icons/clipboard-paste";
import ListPlus from "lucide-react-native/icons/list-plus";
import Pencil from "lucide-react-native/icons/pencil";
import LayoutGrid from "lucide-react-native/icons/layout-grid";
import Plus from "lucide-react-native/icons/plus";
import ScanBarcode from "lucide-react-native/icons/scan-barcode";
import Trash from "lucide-react-native/icons/trash";
import Undo2 from "lucide-react-native/icons/undo-2";
import X from "lucide-react-native/icons/x";
import Share from "lucide-react-native/icons/share";


import { useItems, useLasted, useLists, useMovedAisles, usePurchases, useSettings } from "../../data/hooks";
import { putRestockAside, restockAsideOf } from "../../data/settings";
import { addEntries, addScanned, carryNotFound, deleteItems, importEntries, readKnownProducts, reorderItems, restoreItem, toggleChecked, undoSave, updateItem, type Item, type ItemSave } from "../../data/items";
import { deleteLists, editList, restoreList, type ListSummary } from "../../data/lists";
import { markSeen, rowPeople, type Member, type RowPeople } from "../../data/members";
import { readPantry } from "../../data/pantry";
import { finishShop, reopenShop } from "../../data/shops";
import { catalogueNamed, knowsProduct, listSections, nearMiss, type Aisle, type CatalogueProduct, type Section } from "../../domain/catalogue";
import { ENTRY_MAX, LIST_TEXT_MAX, formatList, parseEntry, parseList, type Entry } from "../../domain/items";
import type { ListLook } from "../../domain/lists";
import { spentOn } from "../../domain/money";
import { atHome } from "../../domain/pantry";
import { restockDue, type Purchase } from "../../domain/restock";
import { tr } from "../../i18n/tr";
import { lookUpBarcode, type ScannedProduct } from "../../services/barcode";
import { canScan, launchScanner, onScanned } from "../../services/barcode-scan";
import { shareText } from "../../services/share";
import { ArrivalScope, Body, Button, EmptyState, IconButton, ItemLabel, itemDetail, ProgressBar, ReadFailed, Screen, SectionHeader, SlideUp, TextField, announce, cardEdge, RowOpen, RowTick } from "../../ui/components";
import { appError, appPrompt } from "../../ui/dialog";
import { mediumImpact, selectionTap, successNotice } from "../../ui/haptics";
import { FinishedCard, type ShopSummary } from "../../ui/celebration";
import { DraggableList, ReorderGrip, SortToggle } from "../../ui/draggable-list";
import { CarrySheet, ItemSheet, type ItemDestination } from "../../ui/item-sheet";
import { CatalogueSheet } from "../../ui/catalogue-sheet";
import type { MemberRole } from "../../db/schema";
import { ListSheet } from "../../ui/list-sheet";
import { EditorsOnly, PeopleActions, ShoppersNote, emptyHintFor, useShare } from "../../ui/members-sheet";
import { RowMotion, RowSwipe } from "../../ui/list-motion";
import { useCountUp, useValueFlash } from "../../ui/motion";
import { navigateBack } from "../../ui/navigation";
import { density, motion, spacing, themeShadow, type, useTheme } from "../../ui/theme";
import { deleteWithUndo, selectionHeader, useSelection } from "../../ui/selection";
import { showNotice, showUndo } from "../../ui/undo";
import { ProductSuggestions } from "../../ui/suggestions";

export default function ListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const lists = useLists();
  const items = useItems(id);
  // Read with the items, so an offer is drawn with the screen and does not rise into it.
  const purchases = usePurchases(id);
  const moved = useMovedAisles();
  const { members, userId, role, viewer } = useShare(id);
  const queries = [lists, items, purchases, members];
  useSeenOnLeave(id, userId, items.data, members.data);
  // The list this screen is deleting, held so its title stays while the screen
  // animates away, and so nothing on it can be pressed a second time.
  const [leaving, setLeaving] = useState<ListSummary | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [sorting, setSorting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const list = leaving ?? lists.data.find((candidate) => candidate.id === id);
  const open = items.data.filter((item) => item.checkedAt == null);
  const basket = items.data.filter((item) => item.checkedAt != null);
  const selection = useSelection(items.data);
  const ticking = useTicking();
  // Where an item can be sent: never a list this person only views, whose server refuses it.
  const destinations = lists.data.filter((candidate) => !candidate.viewer || candidate.id === id);
  const finishing = useFinish(id, open, basket, destinations);

  // A link to a list that is not here — deleted elsewhere, or never existed.
  if (lists.updatedAt != null && !list) return <Redirect href="/" />;


  const sections = listSections(open, moved);

  // A list from a message (SPEC 6.2), taken back whole from the bar.
  const paste = async (current: ListSummary) => {
    const text = await appPrompt(tr.items.pasteTitle, tr.items.pasteMessage, {
      confirmLabel: tr.items.add,
      placeholder: tr.items.pastePlaceholder,
      maxLength: LIST_TEXT_MAX,
      multiline: true,
    });
    if (text == null) return;
    try {
      const written = await importEntries(current.id, parseList(text));
      if (!written) return showNotice(tr.items.pastedNothing);
      selectionTap();
      showUndo(tr.items.pasted(written.writes.length), () => undoSave(written, current.id));
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };

  // What is still to buy: the basket is already bought, and would only be read out.
  const share = async (current: ListSummary) => {
    try {
      if ((await shareText(formatList(current.name, open))) === "clipboard") showNotice(tr.lists.copied);
    } catch {
      void appError(tr.errors.shareFailed);
    }
  };

  const remove = async (current: ListSummary) => {
    setLeaving(current);
    mediumImpact();
    try {
      const snapshot = await deleteLists([current.id]);
      if (snapshot) showUndo(tr.common.deleted(current.name), () => restoreList(snapshot));
      navigateBack(router, "/");
    } catch {
      setLeaving(null);
      void appError(tr.errors.deleteFailed);
    }
  };

  // The circle's tap plays its own touch; a swipe has already played one at its threshold.
  const toggle = async (item: Item) => {
    ticking.press(item);
    try {
      const taken = await toggleChecked(item.id);
      if (taken) showUndo(tr.items.unticked(item.name), () => restoreItem(taken));
    } catch {
      ticking.release(item.id);
      void appError(tr.errors.saveFailed);
    }
  };

  // Sent elsewhere, the row leaves or is copied, so the save says where and can be taken back.
  const save = async (item: Item, change: ItemSave, to: ItemDestination | null) => {
    setEditing(null);
    // Decided before `try`: the React Compiler lowers no conditional inside one.
    const destination = to ? { listId: to.list.id, keep: to.keep } : undefined;
    const said = to && ((name: string) => (to.keep ? tr.items.copied : tr.items.moved)(name, to.list.name));
    try {
      const saved = await updateItem(item.id, change, destination, item);
      if (!said) return;
      selectionTap();
      showUndo(said(saved.name), () => undoSave(saved.written, id));
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };

  const removeItems = (chosen: readonly Item[]) => {
    setEditing(null);
    return deleteWithUndo(chosen, tr.selection.nouns.item, deleteItems, restoreItem);
  };
  const removeItem = (item: Item) => removeItems([item]);

  const row = (item: Item) => {
    const checked = item.checkedAt != null;
    const right = { icon: checked ? Undo2 : Check, tone: "secondary" as const, label: (checked ? tr.items.fromBasket : tr.items.toBasket)(item.name), run: () => void toggle(item) };
    const left = { icon: Trash, tone: "destructive" as const, label: tr.items.delete(item.name), run: () => void removeItem(item) };
    return (
    <RowMotion key={item.id}>
      <SlideUp distance={motion.travel.bar}>
        {viewer ? (
          <ItemRow item={item} people={rowPeople(item, members.data, userId)} onOpen={() => undefined} onToggle={() => undefined} readOnly />
        ) : (
          <RowSwipe right={selection.active ? undefined : right} left={selection.active ? undefined : left}>
            <ItemRow
              item={ticking.shown(item)}
              people={rowPeople(item, members.data, userId)}
              onOpen={() => (selection.active ? selection.toggle(item.id) : setEditing(item))}
              // Choosing and sorting exclude each other, as on Kiler: the grips draw no circle.
              onLongPress={sorting ? undefined : () => selection.begin(item.id)}
              selected={selection.active ? selection.has(item.id) : undefined}
              onToggle={() => {
                if (selection.active) return selection.toggle(item.id);
                selectionTap();
                void toggle(item);
              }}
            />
          </RowSwipe>
        )}
      </SlideUp>
    </RowMotion>
    );
  };

  return (
    <Screen
      back="/"
      {...selectionHeader(
        selection,
        (chosen) => void removeItems(chosen),
        list?.name,
        <ListActions
          list={leaving ? undefined : list}
          roleKnown={members.updatedAt != null}
          userId={userId}
          role={role}
          viewer={viewer}
          sorting={sorting}
          canSort={open.length > 1}
          canShare={open.length > 0}
          onSorting={setSorting}
          onPaste={paste}
          onShare={share}
          onRemove={remove}
        />,
      )}
      width="workspace"
      scrollEnabled={!dragging}
    >
      {queries.some((query) => query.status === "error") ? (
        <ReadFailed queries={queries} />
      ) : list && queries.every((query) => query.updatedAt != null) ? (
        <ArrivalScope>
          <ShoppersNote listId={list.id} />
          <EditorsOnly viewer={viewer} fallback={<Body muted style={{ marginBottom: spacing.lg }}>{tr.sharing.viewOnly}</Body>}>
            <QuickAdd listId={list.id} items={items.data} purchases={purchases.data} onRemove={removeItem} />
          </EditorsOnly>
          {/* The card stays in the one keyed array when the finish empties the list, so a last row deleted under it never mounts it again. */}
          {items.data.length === 0 && !finishing.card ? (
            <EmptyState icon={ListPlus} title={tr.items.emptyTitle} hint={emptyHintFor(viewer, tr.items.emptyHint)} />
          ) : (
            <>
              <Progress done={basket.length} total={items.data.length} />
              <View style={{ gap: density.list.rowGap }}>
                {/* One keyed array: a tick moves its row into the basket, where
                    two would unmount it from one and mount a copy in the other. */}
                {[
                  ...(sorting
                    ? [<SortOpen key="sort" listId={list.id} sections={sections} onOpen={setEditing} onDragging={setDragging} />]
                    : sections.flatMap((section, at) => [
                        section.aisle ? (
                          <RowMotion key={`aisle-${section.key}`}>
                            <SlideUp distance={motion.travel.bar}>
                              <AisleHeader aisle={section.aisle} first={at === 0} />
                            </SlideUp>
                          </RowMotion>
                        ) : null,
                        ...section.items.map(row),
                      ])),
                  basket.length > 0 ? (
                    <RowMotion key="basket">
                      <SlideUp distance={motion.travel.bar}>
                        <BasketHeader spentMinor={spentOn(basket)} />
                      </SlideUp>
                    </RowMotion>
                  ) : null,
                  ...basket.map(row),
                  basket.length > 0 ? (
                    <RowMotion key="finish">
                      <SlideUp distance={motion.travel.bar}>
                        <EditorsOnly viewer={viewer}>
                          <View style={{ marginTop: spacing.md }}>
                            <Button label={tr.items.finish} icon={CheckCheck} onPress={finishing.ask} />
                          </View>
                        </EditorsOnly>
                      </SlideUp>
                    </RowMotion>
                  ) : null,
                  finishing.card,
                ]}
              </View>
            </>
          )}
        </ArrivalScope>
      ) : null}
      {editing ? (
        <ItemSheet
          key={editing.id}
          item={editing}
          listId={id}
          lists={destinations}
          onSave={(change, to) => save(editing, change, to)}
          onDelete={() => removeItem(editing)}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {finishing.question}
    </Screen>
  );
}

/** The header's actions outside choosing; none while the list is not there or is going, or its people are unread: everyone would be drawn as its owner. */
function ListActions({
  list,
  roleKnown,
  userId,
  role,
  viewer,
  sorting,
  canSort,
  canShare,
  onSorting,
  onPaste,
  onShare,
  onRemove,
}: {
  list: ListSummary | undefined;
  roleKnown: boolean;
  userId: string;
  role: MemberRole;
  viewer: boolean;
  sorting: boolean;
  canSort: boolean;
  canShare: boolean;
  onSorting: (sorting: boolean) => void;
  onPaste: (list: ListSummary) => void;
  onShare: (list: ListSummary) => void;
  onRemove: (list: ListSummary) => void;
}) {
  if (!list || !roleKnown) return null;
  return (
    <>
      <EditorsOnly viewer={viewer}>
        <SortToggle sorting={sorting} canSort={canSort} onChange={onSorting} />
        <IconButton icon={ClipboardPaste} label={tr.items.paste(list.name)} onPress={() => onPaste(list)} />
      </EditorsOnly>
      <IconButton icon={Share} label={tr.lists.share(list.name)} disabled={!canShare} onPress={() => onShare(list)} />
      <PeopleActions list={list} userId={userId} role={role} back="/" crowded={sorting} deleteLabel={tr.lists.delete(list.name)} onDelete={() => onRemove(list)}>
        <EditorsOnly viewer={viewer}>
          <EditList list={list} />
        </EditorsOnly>
      </PeopleActions>
    </>
  );
}

/**
 * Leaving a shared list, what was new on it has been seen (SPEC 1.9). Written
 * only when something was, or the person had never looked, so an ordinary
 * visit sends nothing.
 */
/**
 * The circle fills at the touch: the write and its read-back took about 60 ms,
 * felt in the aisle. A press is shown while the item still reads as it did when
 * pressed; the read-back, or any other change, ends it, and the row moves to
 * the basket then. A write that fails ends it at once.
 */
function useTicking() {
  const [pressed, setPressed] = useState<Readonly<Record<string, string | null>>>({});
  return {
    shown: (item: Item): Item =>
      Object.hasOwn(pressed, item.id) && pressed[item.id] === item.checkedAt ? { ...item, checkedAt: item.checkedAt == null ? new Date().toISOString() : null } : item,
    press: (item: Item) => setPressed((held) => ({ ...held, [item.id]: item.checkedAt })),
    release: (id: string) => setPressed((held) => Object.fromEntries(Object.entries(held).filter(([key]) => key !== id))),
  };
}

function useSeenOnLeave(listId: string, userId: string, items: readonly Item[], members: readonly Member[]) {
  const mine = members.find((member) => member.userId === userId);
  const due = mine != null && (mine.seenAt == null || items.some((item) => rowPeople(item, members, userId).fresh));
  const latest = useRef(due);
  useEffect(() => {
    latest.current = due;
  });
  useEffect(
    () => () => {
      if (latest.current) void markSeen(listId, userId).catch(() => {});
    },
    [listId, userId],
  );
}

/**
 * Finishing a shop: what is in the basket is filed and leaves, the rest stays
 * on the list (SPEC 3.4), and what was not found waits for the next shop, on
 * whichever list the question names (SPEC 3.15). Returns the press, the
 * question for the screen to draw beside its other sheets, and the card that
 * celebrates the finish where the basket was. The card holds the finish's
 * undo, and stands while the list holds only what the finish left on it (less
 * what is deleted): an item added or ticked afterwards begins the next shop,
 * and the card steps aside for good, even if that item goes again.
 */
function useFinish(listId: string, open: readonly Item[], basket: readonly Item[], lists: readonly ListSummary[]) {
  const [asking, setAsking] = useState(false);
  const [finished, setFinished] = useState<{ summary: ShopSummary; stayed: ReadonlySet<string>; undo: () => Promise<void> } | null>(null);
  const missed = open.filter((item) => item.notFound);
  // Carried first: a finish that then fails can be pressed again, and finds
  // nothing left to carry. One that finds the basket emptied on another
  // device meanwhile finished nothing, so what it carried goes back.
  const finish = async (carryTo: string) => {
    setAsking(false);
    try {
      const carried = await carryNotFound(listId, carryTo);
      const shop = await finishShop(listId);
      if (!shop) {
        if (carried) await undoSave(carried, listId);
        return;
      }
      successNotice();
      const undo = async () => {
        try {
          await reopenShop(shop.id);
          if (carried) await undoSave(carried, listId);
          setFinished(null);
        } catch {
          void appError(tr.errors.undoFailed);
        }
      };
      setFinished({ summary: { bought: shop.bought, spentMinor: shop.spentMinor, stayed: shop.stayed.length, stocked: shop.stocked }, stayed: new Set(shop.stayed), undo });
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };
  const settled = finished != null && basket.length === 0 && open.every((item) => finished.stayed.has(item.id));
  // Until the screen has caught up with the finish the card is not yet due;
  // once it has stood, the list moving on is final.
  const stood = useRef(false);
  useEffect(() => {
    if (settled) stood.current = true;
    else if (stood.current) {
      stood.current = false;
      setFinished(null);
    }
  }, [settled]);
  return {
    ask: () => (missed.length > 0 && lists.length > 1 ? setAsking(true) : void finish(listId)),
    question:
      asking && missed.length > 0 ? (
        <CarrySheet
          names={missed.map((item) => item.name)}
          listId={listId}
          lists={lists}
          onFinish={(to) => void finish(to)}
          onClose={() => setAsking(false)}
        />
      ) : null,
    card: settled ? <FinishedCard key="finished" summary={finished.summary} onUndo={finished.undo} /> : null,
  };
}

/**
 * The one field items are added through (`docs/SPEC.md` 2.1). Enter adds and
 * keeps the keyboard up for the next item; the field empties at once, so the
 * next can be typed while the last is still being written.
 */
function QuickAdd({
  listId,
  items,
  purchases,
  onRemove,
}: {
  listId: string;
  items: readonly Item[];
  purchases: readonly Purchase[];
  onRemove: (item: Item) => void;
}) {
  const { palette } = useTheme();
  const [text, setText] = useState("");
  const [browsing, setBrowsing] = useState(false);
  // An entry held while one of its items is asked about (SPEC 2.14).
  const [asking, setAsking] = useState<{ entries: Entry[]; at: number; product: CatalogueProduct; typed: string } | null>(null);
  const field = useRef<TextInput>(null);

  // The household's products are read only for a name the catalogue nearly
  // is: they are watched only while suggestions are shown.
  const settle = async (entries: Entry[], from: number, typed: string) => {
    for (let at = from; at < entries.length; at++) {
      if (!nearMiss(entries[at]!.name, [])) continue;
      const product = nearMiss(entries[at]!.name, await readKnownProducts());
      if (product) {
        announce(tr.catalogue.didYouMean(product.name));
        return setAsking({ entries, at, product, typed });
      }
    }
    setAsking(null);
    try {
      const { unchanged } = await addEntries(listId, entries);
      if (unchanged.length === entries.length) return showNotice(tr.items.alreadyListed(unchanged));
      selectionTap();
      // Read once the add is written, so a slow read never holds it up, and
      // a failed one costs only the sentence.
      const held = atHome(await readPantry().catch(() => []), entries);
      if (held.length > 0) showNotice(tr.pantry.atHome(held));
    } catch {
      setText((current) => (current === "" ? typed : current));
      void appError(tr.errors.saveFailed);
    }
  };

  const add = (entries: Entry[]) => {
    // An entry that names nothing — blank, or "3 adet" alone — stays in the
    // field to be finished rather than vanishing without an item.
    if (entries.length === 0) return;
    const typed = text;
    setText("");
    const named = entries.map(catalogueNamed);
    // Added while a question is open, it joins the held entry, which is asked again.
    void (asking ? settle([...asking.entries, ...named], asking.at, typed) : settle(named, 0, typed));
  };

  const answer = (take: boolean) => {
    if (!asking) return;
    const { entries, at, product, typed } = asking;
    void settle(take ? entries.map((entry, index) => (index === at ? { ...entry, name: product.name } : entry)) : entries, at + 1, typed);
  };

  return (
    <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <TextField
          ref={field}
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => add(parseEntry(text, knowsProduct([...items, ...purchases])))}
          // Enter adds and keeps the keyboard up (SPEC 2.1). React Native Web
          // reads `blurOnSubmit` and not `submitBehavior`, so the older prop.
          blurOnSubmit={false}
          returnKeyType="done"
          accessibilityLabel={tr.items.addLabel}
          examples={tr.placeholders.itemAdd}
          maxLength={ENTRY_MAX}
          style={{ flex: 1 }}
        />
        {canScan ? <ScanButton listId={listId} /> : null}
        <IconButton icon={LayoutGrid} label={tr.catalogue.open} field onPress={() => setBrowsing(true)} />
        <IconButton icon={Plus} label={tr.items.add} tone="primary" field onPress={() => add(parseEntry(text, knowsProduct([...items, ...purchases])))} />
      </View>
      {asking ? (
        <SlideUp distance={motion.travel.rise}>
          <View accessibilityLiveRegion="polite" style={{ gap: spacing.sm }}>
            <Text style={[type.small, { color: palette.textSecondary }]}>{tr.catalogue.didYouMean(asking.product.name)}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              <Button label={asking.product.name} size="sm" onPress={() => answer(true)} />
              <Button label={tr.catalogue.keep(asking.entries[asking.at]!.name)} variant="ghost" size="sm" onPress={() => answer(false)} />
            </View>
          </View>
        </SlideUp>
      ) : null}
      {browsing ? (
        <CatalogueSheet
          items={items}
          open={items.filter((item) => item.checkedAt == null)}
          addSet={async (entries) => {
            const written = await importEntries(listId, entries);
            return written && { count: written.writes.length, undo: () => undoSave(written, listId) };
          }}
          onAdd={(product) => add([{ name: product.name, quantityMilli: null, unit: null }])}
          onRemove={onRemove}
          onClose={() => setBrowsing(false)}
        />
      ) : null}
      {/* Mounted while anything is typed rather than while a product is, so
          the products are read once an entry, not again after every comma. */}
      {text ? (
        <ProductSuggestions
          text={text}
          listed={items}
          onPick={(entries) => {
            void add(entries);
            // A pressed chip takes the web's focus; the phone's field never lost it.
            field.current?.focus();
          }}
        />
      ) : (
        <Restock listId={listId} purchases={purchases} items={items} onPick={(entry) => add([entry])} />
      )}
    </View>
  );
}

/**
 * A product added by its barcode (SPEC 2.8): the name Open Food Facts gives
 * is offered to correct, and one it does not give is typed. Its brand becomes
 * the note and its picture the photo.
 */
function ScanButton({ listId }: { listId: string }) {
  // One code at a time: iOS's scanner can read the same packet twice before it closes.
  const busy = useRef(false);
  useEffect(
    () =>
      onScanned(async (code) => {
        if (busy.current) return;
        busy.current = true;
        showNotice(tr.barcode.looking);
        const found: ScannedProduct | null | "offline" = await lookUpBarcode(code).catch(() => "offline" as const);
        const product = found === "offline" ? null : found;
        const message = found === "offline" ? tr.barcode.offline : product ? tr.barcode.found(product.brand) : tr.barcode.unknown;
        const name = await appPrompt(tr.barcode.title, message, { confirmLabel: tr.barcode.add, initialValue: product?.name, maxLength: ENTRY_MAX });
        busy.current = false;
        if (name == null) return;
        await addScanned(listId, { name, note: product?.brand ?? null, photo: product?.photo ?? null }).then(selectionTap, () => appError(tr.errors.saveFailed));
      }),
    [listId],
  );
  const scan = () =>
    launchScanner().then(
      (launched) => {
        if (!launched) void appError(tr.barcode.denied);
      },
      () => appError(tr.barcode.failed),
    );
  return <IconButton icon={ScanBarcode} label={tr.barcode.scan} field onPress={() => void scan()} />;
}

/**
 * What the list's rhythm says has run out (SPEC 2.7), while nothing is typed:
 * it offers and never asks, and leaves once the product is on the list, or
 * once put aside until it is next bought.
 */
function Restock({ listId, purchases, items, onPick }: { listId: string; purchases: readonly Purchase[]; items: readonly Item[]; onPick: (entry: Entry) => void }) {
  const { palette } = useTheme();
  // How long things last at home is the better rhythm, once measured (SPEC 12.7).
  const lasted = useLasted();
  const aside = restockAsideOf(useSettings().data, listId);
  const due = restockDue(purchases, items, new Date(), new Map(lasted.data), aside);
  const putAside = (key: string) => {
    selectionTap();
    putRestockAside(listId, key).catch(() => void appError(tr.errors.saveFailed));
  };
  if (due.length === 0) return null;
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[type.small, { color: palette.textSecondary }]}>{tr.items.restockTitle}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {due.map(({ key, name, quantityMilli, unit, everyDays }) => (
          <View key={key} style={{ flexDirection: "row" }}>
            <IconButton
              icon={Plus}
              text={tr.items.restockChip(name, everyDays)}
              label={tr.items.restock(name, everyDays)}
              tone="primary"
              onPress={() => onPick({ name, quantityMilli, unit })}
            />
            <IconButton icon={X} label={tr.items.restockAside(name)} onPress={() => putAside(key)} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const { palette } = useTheme();
  // A finish that empties the list has nothing left to count; its card does.
  if (total === 0) return null;
  return (
    <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
      <Text accessibilityLiveRegion="polite" style={[type.small, { color: palette.textSecondary }]}>
        {tr.items.progress(done, total)}
      </Text>
      <ProgressBar value={done / total} />
    </View>
  );
}

/**
 * An item's row (`docs/UI.md` section 6): the tile and the text open the item
 * panel; the check is its own control at the trailing edge, the row's full
 * height, so a thumb in the aisle cannot open what it meant to tick.
 */
function ItemRow({
  item,
  onOpen,
  onToggle,
  trailing,
  onLongPress,
  selected,
  lifted = false,
  readOnly = false,
  people,
}: {
  item: Item;
  /** On a shared list: whether it is new here, and who added and ticked it (SPEC 1.5, 1.9). */
  people?: RowPeople;
  onOpen: () => void;
  onToggle: () => void;
  /** Takes the circle's place: the grip while sorting, as a tick mid-sort would move the row away. */
  trailing?: ReactNode;
  onLongPress?: () => void;
  /** Defined while a selection is under way: whether this row is in it. */
  selected?: boolean;
  lifted?: boolean;
  readOnly?: boolean;
}) {
  const { palette } = useTheme();
  const checked = item.checkedAt != null;
  // What an entry can merge into a row; a tick moves the row, which says enough.
  const flash = useValueFlash(`${item.quantityMilli}|${item.unit}|${item.note}|${item.urgent}`);
  const shown = people ? { ...item, fresh: people.fresh, people: tr.sharing.by(people.added, people.checked) } : item;
  return (
    <View
      style={{
        ...cardEdge(palette),
        ...(lifted && themeShadow.overlay(palette)),
        padding: 0,
        flexDirection: "row",
        backgroundColor: palette.surface,
        overflow: lifted ? "visible" : "hidden",
      }}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: palette.primarySoft, opacity: flash }]} />
      <RowOpen label={tr.common.withDetail(item.name, itemDetail(shown))} hint={tr.items.openHint} onPress={onOpen} onLongPress={onLongPress} selected={selected} disabled={readOnly}>
        <ItemLabel item={shown} struck={checked} />
      </RowOpen>
      {trailing ?? <RowTick checked={checked} selected={selected} label={item.name} onToggle={onToggle} disabled={readOnly} />}
    </View>
  );
}

/** The basket's header, its subtotal counting across each price typed. */
function BasketHeader({ spentMinor }: { spentMinor: number | null }) {
  const shown = useCountUp(spentMinor ?? 0);
  return <SectionHeader>{tr.items.basket(spentMinor == null ? null : shown)}</SectionHeader>;
}


/**
 * What is left to buy, sorted by its grips (SPEC 4.1). Urgent items stay on
 * top and those not found at the bottom, so each run of them sorts on its own:
 * a row dragged past the edge of its run would jump back on release. Each
 * section drags on its own, so a row stays with its aisle and its kind; the
 * whole order is written, so the stored one is the order drawn.
 */
function SortOpen({
  listId,
  sections,
  onOpen,
  onDragging,
}: {
  listId: string;
  sections: readonly Section<Item>[];
  onOpen: (item: Item) => void;
  onDragging: (dragging: boolean) => void;
}) {
  const reorder = (at: number, keys: string[]) =>
    reorderItems(listId, sections.flatMap((section, index) => (index === at ? keys : section.items.map(keyOf)))).catch((error: unknown) => {
      void appError(tr.errors.saveFailed);
      throw error;
    });
  return (
    <View style={{ gap: density.list.rowGap }}>
      {sections.map((section, at) => (
        <View key={section.key} style={{ gap: density.list.rowGap }}>
          {section.aisle ? <AisleHeader aisle={section.aisle} first={at === 0} /> : null}
          <DraggableList
            items={section.items}
            keyOf={keyOf}
            gap={density.list.rowGap}
            onReorder={(keys) => reorder(at, keys)}
            onDragging={onDragging}
            renderRow={(item, handle, position) => (
              <ItemRow
                item={item}
                onOpen={() => onOpen(item)}
                onToggle={() => undefined}
                lifted={handle.lifted}
                trailing={<ReorderGrip handle={handle} name={item.name} position={position + 1} count={section.items.length} />}
              />
            )}
          />
        </View>
      ))}
    </View>
  );
}

const keyOf = (item: Item) => item.id;

function AisleHeader({ aisle, first }: { aisle: Aisle | "other"; first: boolean }) {
  return <SectionHeader flush={first}>{tr.catalogue.aisles[aisle]}</SectionHeader>;
}

/** The pencil and the list panel it opens: a list's name, colour and picture (SPEC 1.8). */
function EditList({ list }: { list: ListSummary }) {
  const [open, setOpen] = useState(false);
  const save = async (look: ListLook) => {
    setOpen(false);
    try {
      await editList(list.id, look);
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };
  return (
    <>
      <IconButton icon={Pencil} label={tr.lists.edit(list.name)} onPress={() => setOpen(true)} />
      {open ? <ListSheet list={list} onSave={save} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
