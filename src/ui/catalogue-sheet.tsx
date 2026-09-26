/**
 * The catalogue panel (`docs/SPEC.md` 2.12): an aisle at a time, each product
 * a tile that a tap puts on the list and a second tap takes off again. What
 * the list already holds, ticked or not, wears the tick, found by name as the
 * list merges an entry (2.5), so a product typed in earlier is one here too.
 * Favoriler (5.1) is the same grid over what the person starred, a product
 * outside the catalogue drawn with its initial as a list's item is. Setler
 * (5.3) lists the person's sets: one is made from the list's open items, a
 * tap puts one on the list, and both that and a delete close the panel, since
 * the undo bar they raise is drawn under it.
 */

import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import Trash from "lucide-react-native/icons/trash";

import { useFavourites, useSets } from "../data/hooks";
import { importEntries, undoSave } from "../data/items";
import { createSet, deleteSet, restoreSet, type ProductSet } from "../data/sets";
import { AISLES, CATALOGUE, catalogueProduct, type Aisle, type CatalogueProduct } from "../domain/catalogue";
import { foldName, type ListedEntry } from "../domain/items";
import { NAME_MAX } from "../domain/names";
import { tr } from "../i18n/tr";
import { useModalAccessibility } from "./accessibility";
import { Body, Button, CheckMark, IconButton, Tile, cardEdge, radioChoice, rowsOf } from "./components";
import { Actions, DialogShell, appError, appPrompt } from "./dialog";
import { selectionTap } from "./haptics";
import { showNotice, showUndo } from "./undo";
import { interactionSurface } from "./interaction";
import { webKeys } from "./keys";
import { borderWidth, catalogueSheet, controlSize, font, offset, radius, spacing, themeShadow, type, useTheme } from "./theme";

/** What a tile needs: a product outside the catalogue has no picture. */
type Shown = Pick<CatalogueProduct, "key" | "name"> & { picture?: CatalogueProduct["picture"] };

type Shelf = "catalogue" | "favourites" | "sets";

export function CatalogueSheet<T extends { name: string }>({
  items,
  listId,
  open,
  onAdd,
  onRemove,
  onClose,
}: {
  items: readonly T[];
  listId: string;
  /** What is still to buy on the list, which a new set is made from. */
  open: readonly ListedEntry[];
  onAdd: (product: Shown) => void;
  onRemove: (item: T) => void;
  onClose: () => void;
}) {
  const { palette } = useTheme();
  const titleRef = useModalAccessibility(true, "catalogue");
  const [shown, setShown] = useState<Shelf>("catalogue");
  const [aisle, setAisle] = useState<Aisle>(AISLES[0]);
  const favourites = useFavourites().data;
  const listed = new Map(items.map((item) => [foldName(item.name), item]));
  const shelf: readonly Shown[] =
    shown === "catalogue"
      ? CATALOGUE.filter((product) => product.aisle === aisle)
      : shown === "favourites"
        ? favourites.map(({ name }) => catalogueProduct(name) ?? { key: foldName(name), name })
        : [];

  return (
    <DialogShell title={tr.catalogue.title} titleRef={titleRef} onDismiss={onClose}>
      <View role="radiogroup" accessibilityLabel={tr.catalogue.title} style={{ flexDirection: "row", marginTop: spacing.sm, padding: offset.tuck, borderRadius: radius.md, backgroundColor: palette.surfaceAlt }}>
        <ShelfChoice label={tr.catalogue.title} selected={shown === "catalogue"} onPress={() => setShown("catalogue")} />
        <ShelfChoice label={tr.catalogue.favourites} selected={shown === "favourites"} onPress={() => setShown("favourites")} />
        <ShelfChoice label={tr.catalogue.sets} selected={shown === "sets"} onPress={() => setShown("sets")} />
      </View>
      {shown === "catalogue" ? (
        <ScrollView
          horizontal
          role="radiogroup"
          accessibilityLabel={tr.catalogue.aisle}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs }}
          style={{ marginTop: spacing.sm }}
        >
          {AISLES.map((each) => (
            <AisleChip key={each} label={tr.catalogue.aisles[each]} selected={each === aisle} onPress={() => setAisle(each)} />
          ))}
        </ScrollView>
      ) : shown === "sets" ? (
        <SetsShelf listId={listId} open={open} onClose={onClose} />
      ) : shelf.length === 0 ? (
        <Body muted>{tr.catalogue.noFavourites}</Body>
      ) : null}
      <View style={{ gap: spacing.md, marginTop: spacing.md }}>
        {rowsOf(shelf, catalogueSheet.columns).map((row, at) => (
          <View key={`${shown}-${aisle}-${at}`} style={{ flexDirection: "row", gap: spacing.xs }}>
            {row.map((product) => {
              const item = listed.get(product.key);
              return <ProductTile key={product.key} product={product} added={item != null} onPress={() => (item ? onRemove(item) : onAdd(product))} />;
            })}
            {Array.from({ length: catalogueSheet.columns - row.length }, (_, cell) => (
              <View key={cell} style={{ flex: 1 }} />
            ))}
          </View>
        ))}
      </View>
      <Actions>
        <Button label={tr.common.done} size="sm" onPress={onClose} />
      </Actions>
    </DialogShell>
  );
}

function SetsShelf({ listId, open, onClose }: { listId: string; open: readonly ListedEntry[]; onClose: () => void }) {
  const sets = useSets().data;
  const make = async () => {
    const name = await appPrompt(tr.sets.makeTitle, tr.sets.makeMessage(open.length), {
      confirmLabel: tr.lists.createConfirm,
      placeholder: tr.sets.namePlaceholder,
      maxLength: NAME_MAX,
    });
    if (name == null) return;
    try {
      await createSet(name, open);
      selectionTap();
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };
  const add = async (set: ProductSet) => {
    onClose();
    try {
      const written = await importEntries(listId, set.entries);
      if (!written) return showNotice(tr.items.pastedNothing);
      selectionTap();
      showUndo(tr.sets.added(set.name, written.writes.length), () => undoSave(written, listId));
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };
  const remove = async (set: ProductSet) => {
    onClose();
    try {
      const snapshot = await deleteSet(set.id);
      if (snapshot) showUndo(tr.common.deleted(set.name), () => restoreSet(snapshot));
    } catch {
      void appError(tr.errors.deleteFailed);
    }
  };
  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
      {sets.length === 0 ? <Body muted>{tr.sets.empty}</Body> : null}
      {sets.map((set) => (
        <SetRow key={set.id} set={set} onAdd={() => void add(set)} onDelete={() => void remove(set)} />
      ))}
      {open.length > 0 ? (
        <View style={{ alignItems: "flex-start" }}>
          <Button label={tr.sets.make} variant="ghost" size="sm" onPress={() => void make()} />
        </View>
      ) : null}
    </View>
  );
}

/** A set: its name over what it holds, the whole card puts it on the list and the bin deletes it. */
function SetRow({ set, onAdd, onDelete }: { set: ProductSet; onAdd: () => void; onDelete: () => void }) {
  const { palette } = useTheme();
  const holds = set.entries.map((entry) => entry.name).join(", ");
  return (
    <View style={{ ...cardEdge(palette), padding: 0, flexDirection: "row", alignItems: "center", backgroundColor: palette.surface, overflow: "hidden" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr.common.withDetail(set.name, holds)}
        accessibilityHint={tr.sets.add(set.name)}
        onPress={onAdd}
        style={(state) => ({ flex: 1, minWidth: 0, padding: spacing.md, gap: offset.tight, ...interactionSurface(palette, state) })}
      >
        <Text numberOfLines={1} style={[type.body, { fontFamily: font.semibold, color: palette.textStrong }]}>{set.name}</Text>
        <Text numberOfLines={1} style={[type.small, { color: palette.textSecondary }]}>{holds}</Text>
      </Pressable>
      <View style={{ paddingRight: spacing.sm }}>
        <IconButton icon={Trash} label={tr.sets.delete(set.name)} tone="danger" onPress={onDelete} />
      </View>
    </View>
  );
}

/** One side of the Katalog · Favoriler · Setler switch: the chosen one lifts off the track. */
function ShelfChoice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { palette } = useTheme();
  return (
    <Pressable
      {...radioChoice({ label, selected, onPress })}
      style={(state) => ({
        flex: 1,
        minHeight: controlSize.minimumTarget,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.sm,
        ...(selected ? { backgroundColor: palette.surface, ...themeShadow.card(palette) } : interactionSurface(palette, state, { base: palette.surfaceAlt })),
      })}
    >
      <Text style={[type.small, { fontFamily: selected ? font.semibold : font.medium, color: selected ? palette.textStrong : palette.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

function AisleChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { palette } = useTheme();
  return (
    <Pressable
      {...radioChoice({ label, selected, onPress })}
      style={(state) => ({
        minHeight: controlSize.minimumTarget,
        paddingHorizontal: spacing.md,
        justifyContent: "center",
        borderRadius: radius.full,
        borderWidth: borderWidth.selected,
        borderColor: selected ? palette.primary : palette.border,
        ...interactionSurface(palette, state, { base: selected ? palette.primarySoft : palette.surface }),
      })}
    >
      <Text style={[type.small, { fontFamily: font.semibold, color: selected ? palette.primaryText : palette.text }]}>{label}</Text>
    </Pressable>
  );
}

/** A product's tile and name; on the list, the tick pops onto its corner (`docs/UI.md` section 7). */
function ProductTile({ product, added, onPress }: { product: Shown; added: boolean; onPress: () => void }) {
  const { palette } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      aria-checked={added}
      accessibilityState={{ checked: added }}
      accessibilityLabel={product.name}
      onPress={onPress}
      {...webKeys({ " ": onPress }, { repeats: false })}
      style={(state) => ({
        flex: 1,
        minWidth: 0,
        alignItems: "center",
        gap: offset.tight,
        paddingVertical: spacing.sm,
        borderRadius: radius.md,
        ...interactionSurface(palette, state),
      })}
    >
      <View>
        <Tile id={product.key} name={product.name} picture={product.picture} size={catalogueSheet.tile} />
        {added ? (
          <View style={{ position: "absolute", top: -offset.tight, right: -offset.tight }}>
            <CheckMark checked />
          </View>
        ) : null}
      </View>
      <Text numberOfLines={2} style={[type.small, { minHeight: catalogueSheet.name, textAlign: "center", color: added ? palette.textStrong : palette.text, fontFamily: added ? font.semibold : font.regular }]}>
        {product.name}
      </Text>
    </Pressable>
  );
}
