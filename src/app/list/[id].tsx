import { useRef, useState, type ReactNode } from "react";
import { Animated, ScrollView, StyleSheet, Text, View, type TextInput } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import CheckCheck from "lucide-react-native/icons/check-check";
import ArrowUpDown from "lucide-react-native/icons/arrow-up-down";
import Check from "lucide-react-native/icons/check";
import ClipboardPaste from "lucide-react-native/icons/clipboard-paste";
import ListPlus from "lucide-react-native/icons/list-plus";
import Pencil from "lucide-react-native/icons/pencil";
import LayoutGrid from "lucide-react-native/icons/layout-grid";
import Plus from "lucide-react-native/icons/plus";
import Share from "lucide-react-native/icons/share";
import Trash from "lucide-react-native/icons/trash";

import { useItems, useKnownProducts, useLasted, useLists, useMovedAisles, usePurchases } from "../../data/hooks";
import { addEntries, deleteItem, importEntries, readKnownProducts, reorderItems, restoreItem, toggleChecked, undoSave, updateItem, type Item } from "../../data/items";
import { deleteList, editList, restoreList, type ListSummary } from "../../data/lists";
import { readPantry } from "../../data/pantry";
import { finishShop, reopenShop } from "../../data/shops";
import { catalogueNamed, listSections, nearMiss, withCatalogue, type Aisle, type CatalogueProduct, type Section } from "../../domain/catalogue";
import { ENTRY_MAX, LIST_TEXT_MAX, formatList, parseEntry, parseList, pickEntries, suggestProducts, typedProduct, type Entry, type ItemChange } from "../../domain/items";
import type { ListLook } from "../../domain/lists";
import { spentOn } from "../../domain/money";
import { atHome } from "../../domain/pantry";
import { restockDue, type Purchase } from "../../domain/restock";
import { tr } from "../../i18n/tr";
import { shareText } from "../../services/share";
import { ArrivalScope, Button, EmptyState, IconButton, ItemLabel, itemDetail, ProgressBar, ReadFailed, Screen, SectionHeader, SlideUp, TextField, cardEdge, RowOpen, RowTick } from "../../ui/components";
import { appError, appPrompt } from "../../ui/dialog";
import { mediumImpact, selectionTap, successNotice } from "../../ui/haptics";
import { celebrate, hideCelebration } from "../../ui/celebration";
import { DraggableList, ReorderGrip } from "../../ui/draggable-list";
import { ItemSheet, type ItemDestination } from "../../ui/item-sheet";
import { CatalogueSheet } from "../../ui/catalogue-sheet";
import { ListSheet } from "../../ui/list-sheet";
import { RowMotion, RowSwipe } from "../../ui/list-motion";
import { useCountUp, useValueFlash } from "../../ui/motion";
import { navigateBack } from "../../ui/navigation";
import { density, motion, spacing, themeShadow, type, useTheme } from "../../ui/theme";
import { useStayAwake } from "../../ui/stay-awake";
import { showNotice, showUndo } from "../../ui/undo";

export default function ListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const lists = useLists();
  const items = useItems(id);
  // Read with the items, so an offer is drawn with the screen and does not rise into it.
  const purchases = usePurchases(id);
  const moved = useMovedAisles();
  const queries = [lists, items, purchases];
  // The list this screen is deleting, held so its title stays while the screen
  // animates away, and so nothing on it can be pressed a second time.
  const [leaving, setLeaving] = useState<ListSummary | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [sorting, setSorting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const list = leaving ?? lists.data.find((candidate) => candidate.id === id);
  // A list open with something still to buy is a shop under way (SPEC 3.3):
  // the phone stays on in the hand between one shelf and the next.
  useStayAwake(items.data.some((item) => item.checkedAt == null));

  // A link to a list that is not here — deleted elsewhere, or never existed.
  if (lists.updatedAt != null && !list) return <Redirect href="/" />;


  const open = items.data.filter((item) => item.checkedAt == null);
  const basket = items.data.filter((item) => item.checkedAt != null);
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
      const snapshot = await deleteList(current.id);
      if (snapshot) showUndo(tr.common.deleted(current.name), () => restoreList(snapshot));
      navigateBack(router, "/");
    } catch {
      setLeaving(null);
      void appError(tr.errors.deleteFailed);
    }
  };

  // The circle's tap plays its own touch; a swipe has already played one at its threshold.
  const toggle = async (item: Item) => {
    try {
      await toggleChecked(item.id);
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };

  // Sent elsewhere, the row leaves or is copied, so the save says where and can be taken back.
  const save = async (item: Item, change: ItemChange, to: ItemDestination | null) => {
    setEditing(null);
    try {
      const saved = await updateItem(item.id, change, to ? { listId: to.list.id, keep: to.keep } : undefined);
      if (!to) return;
      selectionTap();
      showUndo((to.keep ? tr.items.copied : tr.items.moved)(saved.name, to.list.name), () => undoSave(saved.written, id));
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };

  const removeItem = async (item: Item) => {
    setEditing(null);
    mediumImpact();
    try {
      const snapshot = await deleteItem(item.id);
      if (snapshot) showUndo(tr.common.deleted(item.name), () => restoreItem(snapshot));
    } catch {
      void appError(tr.errors.deleteFailed);
    }
  };

  // What is in the basket is filed and leaves; the rest stays on the list (SPEC 3.4).
  const finish = async () => {
    try {
      // Read before the finish: the basket leaves the list with it.
      const spentMinor = spentOn(basket);
      const stayed = open.length;
      const shop = await finishShop(id);
      if (!shop) return;
      successNotice();
      celebrate({ bought: shop.bought, spentMinor, stayed, stocked: shop.stocked });
      showUndo(tr.items.finished(shop.bought), () => {
        hideCelebration();
        return reopenShop(shop.id);
      });
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };

  const row = (item: Item) => (
    <RowMotion key={item.id}>
      <SlideUp distance={motion.travel.bar}>
        <RowSwipe checked={item.checkedAt != null} onTick={() => toggle(item)} onDelete={() => removeItem(item)}>
          <ItemRow
            item={item}
            onOpen={() => setEditing(item)}
            onToggle={() => {
              selectionTap();
              void toggle(item);
            }}
          />
        </RowSwipe>
      </SlideUp>
    </RowMotion>
  );

  return (
    <Screen
      back="/"
      title={list?.name}
      width="workspace"
      scrollEnabled={!dragging}
      actions={
        list && !leaving ? (
          <>
            <SortToggle sorting={sorting} canSort={open.length > 1} onChange={setSorting} />
            <IconButton icon={ClipboardPaste} label={tr.items.paste(list.name)} onPress={() => paste(list)} />
            <IconButton icon={Share} label={tr.lists.share(list.name)} disabled={open.length === 0} onPress={() => share(list)} />
            <EditList list={list} />
            <IconButton icon={Trash} label={tr.lists.delete(list.name)} tone="danger" onPress={() => remove(list)} />
          </>
        ) : null
      }
    >
      {queries.some((query) => query.status === "error") ? (
        <ReadFailed queries={queries} />
      ) : list && queries.every((query) => query.updatedAt != null) ? (
        <ArrivalScope>
          <QuickAdd listId={list.id} items={items.data} purchases={purchases.data} onRemove={removeItem} />
          {items.data.length === 0 ? (
            <EmptyState icon={ListPlus} title={tr.items.emptyTitle} hint={tr.items.emptyHint} />
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
                        <View style={{ marginTop: spacing.md }}>
                          <Button label={tr.items.finish} icon={CheckCheck} onPress={finish} />
                        </View>
                      </SlideUp>
                    </RowMotion>
                  ) : null,
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
          lists={lists.data}
          onSave={(change, to) => save(editing, change, to)}
          onDelete={() => removeItem(editing)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Screen>
  );
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
      if (product) return setAsking({ entries, at, product, typed });
    }
    setAsking(null);
    try {
      await addEntries(listId, entries);
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
          onSubmitEditing={() => add(parseEntry(text))}
          // Enter adds and keeps the keyboard up (SPEC 2.1). React Native Web
          // reads `blurOnSubmit` and not `submitBehavior`, so the older prop.
          blurOnSubmit={false}
          returnKeyType="done"
          accessibilityLabel={tr.items.addLabel}
          placeholder={tr.items.addPlaceholder}
          maxLength={ENTRY_MAX}
          style={{ flex: 1 }}
        />
        <IconButton icon={LayoutGrid} label={tr.catalogue.open} onPress={() => setBrowsing(true)} />
        <IconButton icon={Plus} label={tr.items.add} tone="primary" onPress={() => add(parseEntry(text))} />
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
          listId={listId}
          open={items.filter((item) => item.checkedAt == null)}
          onAdd={(product) => add([{ name: product.name, quantityMilli: null, unit: null }])}
          onRemove={onRemove}
          onClose={() => setBrowsing(false)}
        />
      ) : null}
      {/* Mounted while anything is typed rather than while a product is, so
          the products are read once an entry, not again after every comma. */}
      {text ? (
        <Suggestions
          text={text}
          items={items}
          onPick={(entries) => {
            void add(entries);
            // A pressed chip takes the web's focus; the phone's field never lost it.
            field.current?.focus();
          }}
        />
      ) : (
        <Restock purchases={purchases} items={items} onPick={(entry) => add([entry])} />
      )}
    </View>
  );
}

/**
 * What the household had before, then the catalogue, that begins with what is
 * typed or nearly does (SPEC 2.4, 2.13).
 * It offers and never takes: the field keeps its text and its focus until a
 * chip is pressed (`docs/UI.md` section 5).
 */
function Suggestions({ text, items, onPick }: { text: string; items: readonly Item[]; onPick: (entries: Entry[]) => void }) {
  const known = useKnownProducts();
  const typed = typedProduct(text);
  const picks = typed ? suggestProducts(withCatalogue(known.data), typed, items) : [];
  if (!typed || picks.length === 0) return null;
  return (
    <SlideUp distance={motion.travel.rise}>
      <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {picks.map((product) => (
          <IconButton
            key={product.key}
            icon={Plus}
            text={product.name}
            label={tr.items.suggestion(product.name)}
            tone="primary"
            onPress={() => onPick(pickEntries(typed, product.name))}
          />
        ))}
      </ScrollView>
    </SlideUp>
  );
}

/**
 * What the list's rhythm says has run out (SPEC 2.7), while nothing is typed:
 * it offers and never asks, and leaves once the product is on the list.
 */
function Restock({ purchases, items, onPick }: { purchases: readonly Purchase[]; items: readonly Item[]; onPick: (entry: Entry) => void }) {
  const { palette } = useTheme();
  // How long things last at home is the better rhythm, once measured (SPEC 12.7).
  const lasted = useLasted();
  const due = restockDue(purchases, items, new Date(), new Map(lasted.data));
  if (due.length === 0) return null;
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[type.small, { color: palette.textSecondary }]}>{tr.items.restockTitle}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {due.map(({ key, name, quantityMilli, unit, everyDays }) => (
          <IconButton
            key={key}
            icon={Plus}
            text={tr.items.restockChip(name, everyDays)}
            label={tr.items.restock(name, everyDays)}
            tone="primary"
            onPress={() => onPick({ name, quantityMilli, unit })}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const { palette } = useTheme();
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
  grip,
  lifted = false,
}: {
  item: Item;
  onOpen: () => void;
  onToggle: () => void;
  /** While the list is sorted, the grip takes the circle's place: a tick mid-sort would move the row away. */
  grip?: ReactNode;
  lifted?: boolean;
}) {
  const { palette } = useTheme();
  const checked = item.checkedAt != null;
  // What an entry can merge into a row; a tick moves the row, which says enough.
  const flash = useValueFlash(`${item.quantityMilli}|${item.unit}|${item.note}|${item.urgent}`);
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
      <RowOpen label={tr.common.withDetail(item.name, itemDetail(item))} hint={tr.items.openHint} onPress={onOpen}>
        <ItemLabel item={item} struck={checked} />
      </RowOpen>
      {grip ?? <RowTick checked={checked} label={item.name} onToggle={onToggle} />}
    </View>
  );
}

/** The basket's header, its subtotal counting across each price typed. */
function BasketHeader({ spentMinor }: { spentMinor: number | null }) {
  const shown = useCountUp(spentMinor ?? 0);
  return <SectionHeader>{tr.items.basket(spentMinor == null ? null : shown)}</SectionHeader>;
}

/** Sorting is a mode: the grips would crowd every row in the aisle. */
function SortToggle({ sorting, canSort, onChange }: { sorting: boolean; canSort: boolean; onChange: (sorting: boolean) => void }) {
  return sorting ? (
    <IconButton icon={Check} text={tr.items.sortDone} label={tr.items.sortDone} tone="primary" onPress={() => onChange(false)} />
  ) : (
    <IconButton icon={ArrowUpDown} label={tr.items.sort} disabled={!canSort} onPress={() => onChange(true)} />
  );
}

/**
 * What is left to buy, sorted by its grips (SPEC 4.1). Urgent items stay on
 * top and those not found at the bottom, so each run of them sorts on its own:
 * a row dragged past the edge of its run would jump back on release.
 */
/**
 * Each section drags on its own, so a row stays with its aisle and its kind;
 * the whole order is written, so the stored one is the order drawn.
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
                grip={<ReorderGrip handle={handle} name={item.name} position={position + 1} count={section.items.length} />}
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
