/**
 * Choosing rows to act on together (`docs/SPEC.md` 4.5, `docs/UI.md` section
 * 6). A long press chooses the first; from then on a tap toggles. The choice
 * is only ever the set of rows still on screen, so deleting the last chosen
 * one, or another device removing it, ends the selection without a handler.
 */
import { useCallback, useState, type ComponentProps, type ReactNode } from "react";
import { BackHandler, View } from "react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import ListChecks from "lucide-react-native/icons/list-checks";
import Trash from "lucide-react-native/icons/trash";
import X from "lucide-react-native/icons/x";

import { deleteLists, restoreList } from "../data/lists";
import { tr } from "../i18n/tr";
import { IconButton, LinkCard, SlideUp } from "./components";
import { appError } from "./dialog";
import { mediumTap, selectionTap } from "./haptics";
import { RowMotion, RowSwipe } from "./list-motion";
import { navigateBack } from "./navigation";
import { showUndo } from "./undo";
import { motion, spacing } from "./theme";

interface Selection<Row> {
  /** Whether anything is chosen; rows swap their chevron or tick for the circle. */
  active: boolean;
  count: number;
  allChosen: boolean;
  has: (id: string) => boolean;
  /** The chosen rows that are still on screen, in the order `rows` gave them. */
  chosen: Row[];
  /** Long press: chooses the row, with a medium touch. */
  begin: (id: string) => void;
  /** A tap while a selection is under way. */
  toggle: (id: string) => void;
  selectAll: () => void;
  clear: () => void;
}

export function useSelection<Row extends { id: string }>(rows: readonly Row[]): Selection<Row> {
  const [raw, setRaw] = useState<ReadonlySet<string>>(new Set());
  const chosen = rows.filter((row) => raw.has(row.id));
  // Pruned in state too: a row deleted and then restored by undo must not come back chosen.
  if (chosen.length !== raw.size) setRaw(new Set(chosen.map((row) => row.id)));

  const active = chosen.length > 0;
  const clear = useCallback(() => setRaw(new Set()), []);

  // Losing focus ends it: a selection must not wait behind a pushed screen.
  useFocusEffect(useCallback(() => clear, [clear]));
  useFocusEffect(
    useCallback(() => {
      if (!active) return undefined;
      const back = BackHandler.addEventListener("hardwareBackPress", () => {
        clear();
        return true;
      });
      const escape =
        typeof document === "undefined"
          ? null
          : (event: KeyboardEvent) => {
              // A dialog's Escape is the dialog's: react-native-web closes the Modal on keyup, after this has heard it.
              if (event.key === "Escape" && !(event.target instanceof Element && event.target.closest('[aria-modal="true"]'))) clear();
            };
      if (escape) document.addEventListener("keydown", escape);
      return () => {
        back.remove();
        if (escape) document.removeEventListener("keydown", escape);
      };
    }, [active, clear]),
  );

  return {
    active,
    count: chosen.length,
    allChosen: active && chosen.length === rows.length,
    has: (id) => raw.has(id),
    chosen,
    begin: (id) => {
      mediumTap();
      setRaw((before) => new Set(before).add(id));
    },
    toggle: (id) => {
      selectionTap();
      setRaw((before) => {
        const next = new Set(before);
        if (!next.delete(id)) next.add(id);
        return next;
      });
    },
    selectAll: () => {
      selectionTap();
      setRaw(new Set(rows.map((row) => row.id)));
    },
    clear,
  };
}

/** The header a selection takes over: the count, and select all, delete and cancel as icon buttons, so a narrow header keeps the count its room. */
export function selectionHeader<Row>(selection: Selection<Row>, onDelete: (chosen: Row[]) => void, title: string | undefined, actions: ReactNode) {
  if (!selection.active) return { title, actions };
  const remove = () => {
    selection.clear();
    onDelete(selection.chosen);
  };
  return {
    title: tr.selection.title(selection.count),
    actions: (
      <View style={{ flexDirection: "row", gap: spacing.xs }}>
        <IconButton icon={ListChecks} label={tr.selection.all} onPress={selection.selectAll} disabled={selection.allChosen} />
        <IconButton icon={Trash} label={tr.selection.delete} tone="danger" onPress={remove} />
        <IconButton icon={X} label={tr.selection.cancel} onPress={selection.clear} />
      </View>
    ),
  };
}

/**
 * Delete what was asked, once: the touch, the write, one undo bar naming it,
 * and the error dialog if the write fails. `rows` is one or many; with many,
 * the bar counts them by `noun` (`tr.selection.nouns`) and the one undo
 * restores all.
 */
export async function deleteWithUndo<Snapshot>(
  rows: readonly { id: string; name: string }[],
  noun: string,
  write: (ids: string[]) => Promise<Snapshot | null | undefined>,
  undo: (snapshot: Snapshot) => Promise<unknown>,
): Promise<void> {
  mediumTap();
  try {
    const snapshot = await write(rows.map((row) => row.id));
    if (!snapshot) return;
    const message = rows.length === 1 ? tr.common.deleted(rows[0]!.name) : tr.selection.deleted(rows.length, noun);
    showUndo(message, () => undo(snapshot));
  } catch {
    void appError(tr.errors.deleteFailed);
  }
}

/** The open list's or collection's deletion: kept as `leaving` while the screen animates away, then back to `home`. */
export function useLeaveDeleted<Row extends { id: string; name: string }>(home: Href) {
  const router = useRouter();
  const [leaving, setLeaving] = useState<Row | null>(null);
  const remove = async (current: Row) => {
    setLeaving(current);
    mediumTap();
    try {
      const snapshot = await deleteLists([current.id]);
      if (snapshot) showUndo(tr.common.deleted(current.name), () => restoreList(snapshot));
      navigateBack(router, home);
    } catch {
      setLeaving(null);
      void appError(tr.errors.deleteFailed);
    }
  };
  return { leaving, remove };
}

/** A card of Listeler or İstekler: only an owner can delete it, so only an owner swipes or chooses it. */
export function OwnedCard({
  item,
  selection,
  deleteLabel,
  onDelete,
  open,
  ...card
}: {
  item: { id: string; owner: boolean };
  selection: Selection<unknown>;
  deleteLabel: string;
  onDelete: () => void;
  open: () => void;
} & Omit<ComponentProps<typeof LinkCard>, "onOpen" | "onLongPress" | "selected">) {
  const left = item.owner ? { icon: Trash, tone: "destructive" as const, label: deleteLabel, run: onDelete } : undefined;
  return (
    <RowMotion>
      <SlideUp distance={motion.travel.bar}>
        <RowSwipe left={selection.active ? undefined : left}>
          <LinkCard
            {...card}
            onOpen={() => (selection.active ? (item.owner ? selection.toggle(item.id) : undefined) : open())}
            onLongPress={item.owner ? () => selection.begin(item.id) : undefined}
            selected={selection.active && item.owner ? selection.has(item.id) : undefined}
          />
        </RowSwipe>
      </SlideUp>
    </RowMotion>
  );
}
