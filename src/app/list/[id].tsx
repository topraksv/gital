import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, View, type TextInput } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import CheckCheck from "lucide-react-native/icons/check-check";
import ListPlus from "lucide-react-native/icons/list-plus";
import Pencil from "lucide-react-native/icons/pencil";
import Plus from "lucide-react-native/icons/plus";
import Trash from "lucide-react-native/icons/trash";

import { useItems, useKnownProducts, useLists } from "../../data/hooks";
import { addEntries, deleteItem, restoreItem, toggleChecked, undoSave, updateItem, type Item } from "../../data/items";
import { deleteList, renameList, restoreList, type ListSummary } from "../../data/lists";
import { finishShop, reopenShop } from "../../data/shops";
import { ENTRY_MAX, parseEntry, pickEntries, suggestProducts, typedProduct, type Entry, type ItemChange } from "../../domain/items";
import { NAME_MAX } from "../../domain/names";
import { tr } from "../../i18n/tr";
import {
  ArrivalScope,
  Button,
  CheckMark,
  EmptyState,
  IconButton,
  ItemLabel,
  itemDetail,
  ProgressBar,
  ReadFailed,
  Screen,
  SectionHeader,
  SlideUp,
  TextField,
  cardEdge,
} from "../../ui/components";
import { appError, appPrompt } from "../../ui/dialog";
import { mediumImpact, selectionTap, successNotice } from "../../ui/haptics";
import { interactionSurface } from "../../ui/interaction";
import { ItemSheet, type ItemDestination } from "../../ui/item-sheet";
import { RowMotion, RowSwipe } from "../../ui/list-motion";
import { navigateBack } from "../../ui/navigation";
import { controlSize, density, motion, spacing, type, useTheme } from "../../ui/theme";
import { showUndo } from "../../ui/undo";

export default function ListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const lists = useLists();
  const items = useItems(id);
  // The list this screen is deleting, held so its title stays while the screen
  // animates away, and so nothing on it can be pressed a second time.
  const [leaving, setLeaving] = useState<ListSummary | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const list = leaving ?? lists.data.find((candidate) => candidate.id === id);

  // A link to a list that is not here — deleted elsewhere, or never existed.
  if (lists.updatedAt != null && !list) return <Redirect href="/" />;

  const rename = async (current: ListSummary) => {
    const name = await appPrompt(tr.lists.renameTitle, tr.lists.renameMessage, {
      initialValue: current.name,
      confirmLabel: tr.common.save,
      maxLength: NAME_MAX,
    });
    if (name == null) return;
    try {
      await renameList(current.id, name);
    } catch {
      void appError(tr.errors.saveFailed);
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
      const shop = await finishShop(id);
      if (!shop) return;
      successNotice();
      showUndo(tr.items.finished(shop.bought), () => reopenShop(shop.id));
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };

  const open = items.data.filter((item) => item.checkedAt == null);
  const basket = items.data.filter((item) => item.checkedAt != null);
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
      actions={
        list && !leaving ? (
          <>
            <IconButton icon={Pencil} label={tr.lists.rename(list.name)} onPress={() => rename(list)} />
            <IconButton icon={Trash} label={tr.lists.delete(list.name)} tone="danger" onPress={() => remove(list)} />
          </>
        ) : null
      }
    >
      {lists.status === "error" || items.status === "error" ? (
        <ReadFailed queries={[lists, items]} />
      ) : list && items.updatedAt != null ? (
        <ArrivalScope>
          <QuickAdd listId={list.id} items={items.data} />
          {items.data.length === 0 ? (
            <EmptyState icon={ListPlus} title={tr.items.emptyTitle} hint={tr.items.emptyHint} />
          ) : (
            <>
              <Progress done={basket.length} total={items.data.length} />
              <View style={{ gap: density.list.rowGap }}>
                {/* One keyed array: a tick moves its row into the basket, where
                    two would unmount it from one and mount a copy in the other. */}
                {[
                  ...open.map(row),
                  basket.length > 0 ? (
                    <RowMotion key="basket">
                      <SlideUp distance={motion.travel.bar}>
                        <SectionHeader>{tr.items.basket}</SectionHeader>
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
function QuickAdd({ listId, items }: { listId: string; items: readonly Item[] }) {
  const [text, setText] = useState("");
  const field = useRef<TextInput>(null);

  const add = async (entries: Entry[]) => {
    // An entry that names nothing — blank, or "3 adet" alone — stays in the
    // field to be finished rather than vanishing without an item.
    if (entries.length === 0) return;
    const typed = text;
    setText("");
    try {
      await addEntries(listId, entries);
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
        <IconButton icon={Plus} label={tr.items.add} tone="primary" onPress={() => add(parseEntry(text))} />
      </View>
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
      ) : null}
    </View>
  );
}

/**
 * What the household had before that begins with what is typed (SPEC 2.4).
 * It offers and never takes: the field keeps its text and its focus until a
 * chip is pressed (`docs/UI.md` section 5).
 */
function Suggestions({ text, items, onPick }: { text: string; items: readonly Item[]; onPick: (entries: Entry[]) => void }) {
  const known = useKnownProducts();
  const typed = typedProduct(text);
  const picks = typed ? suggestProducts(known.data, typed, items) : [];
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
function ItemRow({ item, onOpen, onToggle }: { item: Item; onOpen: () => void; onToggle: () => void }) {
  const { palette } = useTheme();
  const checked = item.checkedAt != null;
  return (
    <View style={{ ...cardEdge(palette), padding: 0, flexDirection: "row", backgroundColor: palette.surface, overflow: "hidden" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr.common.withDetail(item.name, itemDetail(item))}
        accessibilityHint={tr.items.openHint}
        onPress={onOpen}
        style={(state) => ({
          flex: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
          padding: density.list.cardPadding,
          ...interactionSurface(palette, state),
        })}
      >
        <ItemLabel item={item} struck={checked} />
      </Pressable>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={item.name}
        onPress={onToggle}
        style={(state) => ({
          minWidth: controlSize.minimumTarget,
          paddingHorizontal: spacing.md,
          alignItems: "center",
          justifyContent: "center",
          ...interactionSurface(palette, state),
        })}
      >
        <CheckMark checked={checked} />
      </Pressable>
    </View>
  );
}

