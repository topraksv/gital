/**
 * Choosing rows to act on together (`docs/SPEC.md` 4.5, `docs/UI.md` section
 * 6). A long press chooses the first; from then on a tap toggles. The choice
 * is only ever the set of rows still on screen, so deleting the last chosen
 * one, or another device removing it, ends the selection without a handler.
 */
import { useCallback, useState, type ReactNode } from "react";
import { BackHandler, View } from "react-native";
import { useFocusEffect } from "expo-router";
import ListChecks from "lucide-react-native/icons/list-checks";
import Trash from "lucide-react-native/icons/trash";
import X from "lucide-react-native/icons/x";

import { tr } from "../i18n/tr";
import { IconButton } from "./components";
import { appError } from "./dialog";
import { mediumImpact, selectionTap } from "./haptics";
import { showUndo } from "./undo";
import { spacing } from "./theme";

export interface Selection<Row> {
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
      mediumImpact();
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

/**
 * A screen's title and header actions, which a selection takes over while it
 * is under way: the count, and select all, delete and cancel. Three icon
 * buttons, 44 points each: with a 360 dp header that leaves the count its
 * room, and each button's label is what a screen reader hears. Delete ends
 * the selection and hands over the rows it held.
 */
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
  mediumImpact();
  try {
    const snapshot = await write(rows.map((row) => row.id));
    if (!snapshot) return;
    const message = rows.length === 1 ? tr.common.deleted(rows[0]!.name) : tr.selection.deleted(rows.length, noun);
    showUndo(message, () => undo(snapshot));
  } catch {
    void appError(tr.errors.deleteFailed);
  }
}
