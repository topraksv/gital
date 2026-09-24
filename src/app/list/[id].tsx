import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import Check from "lucide-react-native/icons/check";
import DatabaseZap from "lucide-react-native/icons/database-zap";
import ListPlus from "lucide-react-native/icons/list-plus";
import Pencil from "lucide-react-native/icons/pencil";
import Plus from "lucide-react-native/icons/plus";
import Trash from "lucide-react-native/icons/trash";

import { useItems, useLists } from "../../data/hooks";
import { addItems, deleteItem, restoreItem, toggleChecked, updateItem, type Item } from "../../data/items";
import { deleteList, renameList, restoreList, type ListSummary } from "../../data/lists";
import { ENTRY_MAX, formatQuantity, parseEntry, type Entry } from "../../domain/items";
import { NAME_MAX } from "../../domain/names";
import { tr } from "../../i18n/tr";
import {
  ArrivalScope,
  Button,
  EmptyState,
  IconButton,
  LetterTile,
  ProgressBar,
  Screen,
  SectionHeader,
  SlideUp,
  SuccessPop,
  TextField,
  cardEdge,
} from "../../ui/components";
import { appError, appPrompt } from "../../ui/dialog";
import { mediumImpact, selectionTap } from "../../ui/haptics";
import { interactionSurface } from "../../ui/interaction";
import { ItemSheet } from "../../ui/item-sheet";
import { RowMotion, RowSwipe } from "../../ui/list-motion";
import { navigateBack } from "../../ui/navigation";
import {
  borderWidth,
  circle,
  controlSize,
  density,
  font,
  iconSize,
  iconStroke,
  itemRow,
  motion,
  offset,
  spacing,
  type,
  useTheme,
} from "../../ui/theme";
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

  const save = async (item: Item, change: Entry) => {
    setEditing(null);
    try {
      await updateItem(item.id, change);
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
        <EmptyState
          icon={DatabaseZap}
          title={tr.errors.readFailedTitle}
          hint={tr.errors.readFailedHint}
          action={
            <Button
              label={tr.common.retry}
              onPress={() => {
                lists.retry();
                items.retry();
              }}
            />
          }
        />
      ) : list && items.updatedAt != null ? (
        <ArrivalScope>
          <QuickAdd listId={list.id} />
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
          onSave={(change) => save(editing, change)}
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
function QuickAdd({ listId }: { listId: string }) {
  const [text, setText] = useState("");

  const submit = async () => {
    // An entry that names nothing — blank, or "3 adet" alone — stays in the
    // field to be finished rather than vanishing without an item.
    if (parseEntry(text).length === 0) return;
    const entry = text;
    setText("");
    try {
      await addItems(listId, entry);
      selectionTap();
    } catch {
      setText((current) => (current === "" ? entry : current));
      void appError(tr.errors.saveFailed);
    }
  };

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.lg }}>
      <TextField
        value={text}
        onChangeText={setText}
        onSubmitEditing={submit}
        // Enter adds and keeps the keyboard up (SPEC 2.1). React Native Web
        // reads `blurOnSubmit` and not `submitBehavior`, so the older prop.
        blurOnSubmit={false}
        returnKeyType="done"
        accessibilityLabel={tr.items.addLabel}
        placeholder={tr.items.addPlaceholder}
        maxLength={ENTRY_MAX}
        style={{ flex: 1 }}
      />
      <IconButton icon={Plus} label={tr.items.add} tone="primary" onPress={submit} />
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
function ItemRow({ item, onOpen, onToggle }: { item: Item; onOpen: () => void; onToggle: () => void }) {
  const { palette } = useTheme();
  const checked = item.checkedAt != null;
  const quantity = formatQuantity(item);
  return (
    <View style={{ ...cardEdge(palette), padding: 0, flexDirection: "row", backgroundColor: palette.surface, overflow: "hidden" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr.items.open(item.name, quantity)}
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
        <LetterTile id={item.id} name={item.name} size={itemRow.tile} />
        <View style={{ flex: 1, minWidth: 0, gap: offset.tight }}>
          <Text
            style={[
              type.body,
              {
                fontFamily: font.medium,
                color: checked ? palette.textSecondary : palette.textStrong,
                textDecorationLine: checked ? "line-through" : "none",
              },
            ]}
          >
            {item.name}
          </Text>
          {quantity ? <Text style={[type.small, { color: palette.textSecondary }]}>{quantity}</Text> : null}
        </View>
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
        {checked ? (
          <SuccessPop>
            <View style={[checkCircle, { backgroundColor: palette.secondary }]}>
              <Check accessible={false} size={iconSize.compact} color={palette.onSecondary} strokeWidth={iconStroke.mark} />
            </View>
          </SuccessPop>
        ) : (
          <View style={[checkCircle, { borderWidth: borderWidth.selected, borderColor: palette.controlBorder }]} />
        )}
      </Pressable>
    </View>
  );
}

const checkCircle = {
  width: itemRow.check,
  height: itemRow.check,
  borderRadius: circle(itemRow.check),
  alignItems: "center",
  justifyContent: "center",
} as const;
