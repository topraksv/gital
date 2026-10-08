import { useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Platform, Text, View, type TextInput } from "react-native";
import ClipboardPaste from "lucide-react-native/icons/clipboard-paste";
import LayoutGrid from "lucide-react-native/icons/layout-grid";
import Trash from "lucide-react-native/icons/trash";
import ListPlus from "lucide-react-native/icons/list-plus";
import Minus from "lucide-react-native/icons/minus";
import Plus from "lucide-react-native/icons/plus";
import Refrigerator from "lucide-react-native/icons/refrigerator";
import Share from "lucide-react-native/icons/share";

import { useSession } from "../../auth/session";
import { useMovedAisles, usePantry } from "../../data/hooks";
import { finishPantryItem, removePantryItems, reorderPantry, setExpiry, setStock, stockPantry, takeSome, undoFinish, type Finished, type PantryItem } from "../../data/pantry";
import { listSections, type Section } from "../../domain/catalogue";
import { todayISO } from "../../domain/dates";
import { ENTRY_MAX, LIST_TEXT_MAX, foldName, formatList, parseEntry, parseList, type ListedEntry } from "../../domain/items";
import { expiryOf, leavesSome } from "../../domain/pantry";
import { shareText } from "../../services/share";
import { tr } from "../../i18n/tr";
import { useModalAccessibility } from "../../ui/accessibility";
import { QuantityFace, useCalculator } from "../../ui/calculator";
import { DateField } from "../../ui/calendar";
import { ArrivalScope, Body, Button, EmptyState, IconButton, ItemLabel, ReadFailed, Screen, SectionHeader, SlideUp, cardEdge, itemDetail, RowOpen, RowTick, TextField } from "../../ui/components";
import { CatalogueSheet } from "../../ui/catalogue-sheet";
import { Actions, DialogShell, appError, appPrompt } from "../../ui/dialog";
import { DraggableList, ReorderGrip, SortToggle } from "../../ui/draggable-list";
import { HouseholdActions } from "../../ui/members-sheet";
import { mediumImpact, selectionTap } from "../../ui/haptics";
import { isReducedMotion } from "../../ui/motion";
import { flightTo, landTab, tabCentre } from "../../ui/tab-landing";
import { ProductSuggestions } from "../../ui/suggestions";
import { RowMotion, RowSwipe } from "../../ui/list-motion";
import { deleteWithUndo, selectionHeader, useSelection } from "../../ui/selection";
import { showNotice, showUndo } from "../../ui/undo";
import { density, itemRow, motion, spacing, type, useTheme } from "../../ui/theme";

/** The Listeler tab's route, where a finished product goes back onto its list. */
const LISTS_TAB = "index";

/**
 * What is at home (SPEC 12.2, 12.8), by aisle as a list is, and worked as a
 * list is (the owner asked 2026-09-27): sorted by its grips, filled from a
 * pasted message or the catalogue, and shared as text. Kiler is one, so it
 * has no name, colour or delete of its own; its people are the household's
 * (SPEC 12.13).
 */
export default function Pantry() {
  const userId = useSession((s) => s.userId) ?? "";
  const pantry = usePantry();
  const moved = useMovedAisles();
  const [sorting, setSorting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const sections = listSections(pantry.data, moved);
  const selection = useSelection(sections.flatMap((section) => section.items));

  /** Whether the product finished, so a row that flew for it knows to come back. */
  const act = async (item: PantryItem, action: (id: string) => Promise<Finished | null>) => {
    try {
      const finished = await action(item.id);
      if (!finished) {
        selectionTap();
        return false;
      }
      mediumImpact();
      landTab(LISTS_TAB);
      showUndo(tr.pantry.finished(item.name, finished.listName), () => undoFinish(finished.written));
      return true;
    } catch {
      void appError(tr.errors.saveFailed);
      return false;
    }
  };

  /** What is no longer at home was refused before the batch; it still says so. */
  const removeRows = async (ids: readonly string[]) => {
    const written = await removePantryItems(ids);
    if (!written) throw new Error("nothing removed");
    return written;
  };
  const remove = (items: readonly PantryItem[]) => deleteWithUndo(items, tr.selection.nouns.item, removeRows, undoFinish);

  // A list from a message (SPEC 6.2), taken back whole from the bar.
  const paste = async () => {
    const text = await appPrompt(tr.items.pasteTitle, tr.pantry.pasteMessage, {
      confirmLabel: tr.items.add,
      placeholder: tr.items.pastePlaceholder,
      maxLength: LIST_TEXT_MAX,
      multiline: true,
    });
    if (text == null) return;
    const entries = parseList(text);
    if (entries.length === 0) return showNotice(tr.items.pastedNothing);
    try {
      const written = await stockPantry(entries);
      selectionTap();
      showUndo(tr.pantry.pasted(entries.length), () => undoFinish(written));
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };

  const share = async () => {
    try {
      if ((await shareText(formatList(tr.tabs.pantry, pantry.data.map(listed)))) === "clipboard") showNotice(tr.pantry.copied);
    } catch {
      void appError(tr.errors.shareFailed);
    }
  };

  const row = (item: PantryItem, grip?: ReactNode) => (
    <PantryRow
      item={item}
      grip={grip}
      onLess={() => void act(item, takeSome)}
      onCount={(quantityMilli) => void act(item, (id) => setStock(id, quantityMilli))}
      onFinish={() => act(item, finishPantryItem)}
      onRemove={() => void remove([item])}
      // Choosing and sorting exclude each other: a grip row neither swipes nor is chosen.
      selected={grip || !selection.active ? undefined : selection.has(item.id)}
      onSelect={grip ? undefined : () => selection.begin(item.id)}
      onToggle={() => selection.toggle(item.id)}
    />
  );

  return (
    <Screen
      {...selectionHeader(
        selection,
        (chosen) => void remove(chosen),
        tr.tabs.pantry,
        <HouseholdActions userId={userId} crowded={sorting}>
          <SortToggle sorting={sorting} canSort={pantry.data.length > 1} onChange={setSorting} />
          <IconButton icon={ClipboardPaste} label={tr.pantry.paste} onPress={() => void paste()} />
          <IconButton icon={Share} label={tr.pantry.share} disabled={pantry.data.length === 0} onPress={() => void share()} />
        </HouseholdActions>,
      )}
      width="workspace"
      scrollEnabled={!dragging}
    >
      <PantryAdd held={pantry.data} />
      {pantry.status === "error" ? (
        <ReadFailed queries={[pantry]} />
      ) : pantry.updatedAt != null ? (
        <ArrivalScope>
          {pantry.data.length === 0 ? (
            <EmptyState icon={Refrigerator} title={tr.pantry.emptyTitle} hint={tr.pantry.emptyHint} skeleton={itemRow.tile} />
          ) : sorting ? (
            <SortPantry sections={sections} row={row} onDragging={setDragging} />
          ) : (
            <View style={{ gap: density.list.rowGap }}>
              {sections.map((section, at) => (
                <View key={section.key} style={{ gap: density.list.rowGap }}>
                  {section.aisle ? <SectionHeader flush={at === 0}>{tr.catalogue.aisles[section.aisle]}</SectionHeader> : null}
                  {section.items.map((item) => (
                    <RowMotion key={item.id}>
                      <SlideUp distance={motion.travel.bar}>{row(item)}</SlideUp>
                    </RowMotion>
                  ))}
                </View>
              ))}
            </View>
          )}
        </ArrivalScope>
      ) : null}
    </Screen>
  );
}

/** A product at home as a list's shared text and a set read it. */
const listed = (item: PantryItem): ListedEntry => ({ name: item.name, quantityMilli: item.quantityMilli, unit: item.unit, note: null, urgent: false });

/**
 * Kiler sorted by its grips, each aisle on its own as on a list; the whole
 * order is written, so the stored one is the order drawn.
 */
function SortPantry({
  sections,
  row,
  onDragging,
}: {
  sections: readonly Section<PantryItem>[];
  row: (item: PantryItem, grip: ReactNode) => ReactNode;
  onDragging: (dragging: boolean) => void;
}) {
  const reorder = (at: number, keys: string[]) =>
    reorderPantry(sections.flatMap((section, index) => (index === at ? keys : section.items.map((item) => item.id)))).catch((error: unknown) => {
      void appError(tr.errors.saveFailed);
      throw error;
    });
  return (
    <View style={{ gap: density.list.rowGap }}>
      {sections.map((section, at) => (
        <View key={section.key} style={{ gap: density.list.rowGap }}>
          {section.aisle ? <SectionHeader flush={at === 0}>{tr.catalogue.aisles[section.aisle]}</SectionHeader> : null}
          <DraggableList
            items={section.items}
            keyOf={(item) => item.id}
            gap={density.list.rowGap}
            onReorder={(keys) => reorder(at, keys)}
            onDragging={onDragging}
            renderRow={(item, handle, position) =>
              row(item, <ReorderGrip handle={handle} name={item.name} position={position + 1} count={section.items.length} />)
            }
          />
        </View>
      ))}
    </View>
  );
}

/**
 * What is already at home, typed in as a list's entry is (SPEC 12.11): "2 kg
 * un, tuz" is two products. Enter adds and keeps the keyboard up, as there.
 */
function PantryAdd({ held }: { held: readonly PantryItem[] }) {
  const [text, setText] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const field = useRef<TextInput>(null);
  const add = async (entries = parseEntry(text)) => {
    if (entries.length === 0) return;
    setText("");
    try {
      await stockPantry(entries);
      selectionTap();
    } catch {
      // Only into a field left empty: what was typed since is not overwritten.
      setText((current) => (current === "" ? text : current));
      void appError(tr.errors.saveFailed);
    }
  };
  const another = async (name: string) => {
    const again = held.some((item) => foldName(item.name) === foldName(name));
    try {
      const written = await stockPantry([{ name, quantityMilli: null, unit: null }]);
      selectionTap();
      if (again) showUndo(tr.pantry.another(name), () => undoFinish(written));
    } catch {
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
          accessibilityLabel={tr.pantry.addLabel}
          examples={tr.placeholders.pantryAdd}
          maxLength={ENTRY_MAX}
          style={{ flex: 1 }}
        />
        {/* The list's order, so the two fields read as one (the owner asked 2026-09-27). */}
        <IconButton icon={LayoutGrid} label={tr.catalogue.open} field onPress={() => setBrowsing(true)} />
        <IconButton icon={Plus} label={tr.pantry.add} tone="primary" field onPress={() => void add()} />
      </View>
      {browsing ? (
        <CatalogueSheet
          items={held}
          open={held.map(listed)}
          // A tile already at home adds another: nothing here takes one back but
          // its panel. The tile looks the same after, so the undo bar says so.
          onAdd={(product) => void another(product.name)}
          addSet={async (entries) => {
            const written = await stockPantry(entries);
            return () => undoFinish(written);
          }}
          onClose={() => setBrowsing(false)}
        />
      ) : null}
      {text ? (
        <ProductSuggestions
          text={text}
          // What is at home is still offered: a chip for it is another arrival.
          listed={[]}
          onPick={(entries) => {
            void add(entries);
            field.current?.focus();
          }}
        />
      ) : null}
    </View>
  );
}

/** The day while it is far; how near, in colour, once it is soon or past (SPEC 12.3). */
function expiryPart(expiresOn: string | null, today: string) {
  if (expiresOn == null) return undefined;
  const { days, soon } = expiryOf(expiresOn, today);
  if (!soon) return { text: tr.pantry.expiresOn(expiresOn) };
  return { text: tr.pantry.expiryLeft(days), tone: days < 0 ? ("errorText" as const) : ("warningText" as const) };
}

/**
 * A pantry row, as an item's is (`docs/UI.md` section 6): the tile and the
 * text open its panel, and − and the finish sit at the trailing edge. The
 * finish flies the row to the Listeler tab before it writes, and the tab
 * bounces as it lands (section 7); − reaching nothing only bounces the tab,
 * since the row cannot know beforehand that it will finish.
 */
function PantryRow({
  item,
  grip,
  onLess,
  onCount,
  onFinish,
  onRemove,
  selected,
  onSelect,
  onToggle,
}: {
  item: PantryItem;
  /** While Kiler is sorted, the grip takes the buttons' place: a press mid-sort would move the row away. */
  grip?: ReactNode;
  onLess: () => void;
  onCount: (quantityMilli: number) => void;
  onFinish: () => Promise<boolean>;
  onRemove: () => void;
  /** Defined while a selection is under way: whether this row is in it. */
  selected?: boolean;
  onSelect?: () => void;
  onToggle: () => void;
}) {
  const rowRef = useRef<View>(null);
  const [flight] = useState(() => new Animated.Value(0));
  const [path, setPath] = useState({ dx: 0, dy: 0 });
  // A second tap mid-flight would finish a product already finished, and its
  // "nothing to finish" would bring the leaving row back for a frame.
  const flying = useRef(false);
  const finish = () => {
    const target = tabCentre(LISTS_TAB);
    if (target == null || isReducedMotion() || !rowRef.current) return void onFinish();
    if (flying.current) return;
    flying.current = true;
    rowRef.current.measureInWindow((x, y, width, height) => {
      setPath(flightTo({ x, y, width, height }, target));
      Animated.timing(flight, { toValue: 1, duration: motion.standard, easing: Easing.in(Easing.cubic), useNativeDriver: Platform.OS !== "web" }).start(
        // The row leaves with the re-read; one that did not finish comes back.
        () =>
          void onFinish().then((gone) => {
            if (gone) return;
            flying.current = false;
            flight.setValue(0);
          }),
      );
    });
  };
  return (
    // The flight is outside the swipe: RowSwipe clips, and the row must leave the screen.
    <Animated.View
      ref={rowRef}
      style={{
        opacity: flight.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        transform: [
          { translateX: Animated.multiply(flight, path.dx) },
          { translateY: Animated.multiply(flight, path.dy) },
          { scale: flight.interpolate({ inputRange: [0, 1], outputRange: [1, motion.landing.shrink] }) },
        ],
      }}
    >
      <PantryCard item={item} grip={grip} onLess={onLess} onCount={onCount} onFinish={finish} onRemove={onRemove} selected={selected} onSelect={onSelect} onToggle={onToggle} />
    </Animated.View>
  );
}

/** The card inside the flight: swipe, tap, long press and the buttons. A part of its own so the flight's refs stay out of the accessibility actions. */
function PantryCard({
  item,
  grip,
  onLess,
  onCount,
  onFinish,
  onRemove,
  selected,
  onSelect,
  onToggle,
}: {
  item: PantryItem;
  grip?: ReactNode;
  onLess: () => void;
  onCount: (quantityMilli: number) => void;
  onFinish: () => void;
  onRemove: () => void;
  selected?: boolean;
  onSelect?: () => void;
  onToggle: () => void;
}) {
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);
  const shown = {
    ...item,
    note: null,
    urgent: false,
    notFound: false,
    boughtInstead: null,
    priceMinor: null,
    checkedAt: null,
    extra: expiryPart(item.expiresOn, todayISO()),
  };
  const choosing = selected !== undefined;
  const swipes = grip || choosing ? {} : { right: { icon: ListPlus, tone: "primary" as const, label: tr.pantry.finish(item.name), run: onFinish }, left: { icon: Trash, tone: "destructive" as const, label: tr.items.delete(item.name), run: onRemove } };
  return (
    <RowSwipe {...swipes}>
      <View style={{ ...cardEdge(palette), padding: 0, flexDirection: "row", alignItems: "center", backgroundColor: palette.surface, overflow: "hidden" }}>
        <RowOpen
          label={tr.common.withDetail(item.name, itemDetail(shown))}
          hint={tr.pantry.openHint}
          onPress={choosing ? onToggle : () => setOpen(true)}
          onLongPress={onSelect}
          selected={selected}
        >
          <ItemLabel item={shown} />
        </RowOpen>
        {choosing ? (
          <RowTick selected={selected} label={item.name} onToggle={onToggle} />
        ) : (
          <View style={{ flexDirection: "row", paddingRight: spacing.sm }}>
            {grip ?? (
              <>
                {leavesSome(item) ? <IconButton icon={Minus} label={tr.pantry.less(item.name)} onPress={onLess} /> : null}
                <IconButton icon={ListPlus} label={tr.pantry.finish(item.name)} tone="primary" onPress={onFinish} />
              </>
            )}
          </View>
        )}
        {open ? <PantrySheet item={item} onCount={onCount} onRemove={onRemove} onClose={() => setOpen(false)} /> : null}
      </View>
    </RowSwipe>
  );
}

/**
 * A product's panel: how much is at home, counted on the calculator (12.8),
 * the date printed on it, picked on the calendar or taken off (12.3), and a
 * way out of Kiler that puts it on no list, for what was never there.
 */
function PantrySheet({
  item,
  onCount,
  onRemove,
  onClose,
}: {
  item: PantryItem;
  onCount: (quantityMilli: number) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { palette } = useTheme();
  const titleRef = useModalAccessibility(true, item.id);
  const [expiresOn, setExpiresOn] = useState(item.expiresOn);
  const [quantityMilli, setQuantityMilli] = useState(item.quantityMilli);
  const [calculate, calculator] = useCalculator(item.unit, setQuantityMilli);
  const save = async () => {
    onClose();
    // Counted to nothing, it is finished, and a date on it would be the stay's.
    if (quantityMilli !== item.quantityMilli) onCount(quantityMilli);
    if (expiresOn === item.expiresOn || quantityMilli === 0) return;
    try {
      await setExpiry(item.id, expiresOn);
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };
  return (
    <DialogShell title={item.name} titleRef={titleRef} onDismiss={onClose}>
      <View style={{ marginTop: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Text style={[type.body, { color: palette.text, flex: 1 }]}>{tr.items.quantity}</Text>
        <QuantityFace quantity={{ quantityMilli, unit: item.unit }} onPress={calculate} />
      </View>
      {calculator}
      <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
        <Body>{tr.pantry.expiry}</Body>
        <DateField label={tr.pantry.expiry} value={expiresOn} onChange={setExpiresOn} />
      </View>
      <View style={{ marginTop: spacing.lg, alignItems: "flex-start" }}>
        <Button
          label={tr.pantry.remove}
          variant="ghost"
          size="sm"
          onPress={() => {
            onClose();
            onRemove();
          }}
        />
      </View>
      <Actions>
        {expiresOn != null ? <Button label={tr.pantry.clearExpiry} variant="ghost" size="sm" onPress={() => setExpiresOn(null)} /> : null}
        <Button label={tr.common.cancel} variant="ghost" size="sm" onPress={onClose} />
        <Button label={tr.common.save} size="sm" onPress={save} />
      </Actions>
    </DialogShell>
  );
}
