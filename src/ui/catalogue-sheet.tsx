/**
 * The catalogue panel (SPEC 2.12, 5.1, 5.3). A product is on the list by name, as the list merges
 * an entry (2.5); adding or deleting a set closes the panel, since its undo bar is drawn under it.
 */

import { useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType, type StyleProp, type ViewStyle } from "react-native";

import Plus from "lucide-react-native/icons/plus";
import Search from "lucide-react-native/icons/search";
import Trash from "lucide-react-native/icons/trash";
import X from "lucide-react-native/icons/x";

import { useKnownProducts, useProducts, useSets } from "../data/hooks";
import { createSet, deleteSet, restoreSet, type ProductSet } from "../data/sets";
import { AISLES, CATALOGUE, catalogueProduct, searchCatalogue, type Aisle, type CatalogueProduct } from "../domain/catalogue";
import { foldName, type ListedEntry } from "../domain/items";
import { NAME_MAX, nameFrom } from "../domain/names";
import { tr } from "../i18n/tr";
import { useModalAccessibility } from "./accessibility";
import { Body, Button, CheckMark, IconButton, TextField, Tile, cardEdge, fieldAccessoryStyle, radioChoice, rowsOf } from "./components";
import { Actions, DialogShell, appError, appPrompt } from "./dialog";
import { selectionTap } from "./haptics";
import { showNotice, showUndo } from "./undo";
import { interactionSurface } from "./interaction";
import { radioGroupKeys, webKeys } from "./keys";
import { borderWidth, catalogueSheet, controlSize, font, iconSize, iconStroke, offset, radius, spacing, themeShadow, type, useTheme } from "./theme";
import { Press } from "./press";

/** What a tile needs: a product outside the catalogue has no picture. */
type Shown = Pick<CatalogueProduct, "key" | "name"> & { picture?: CatalogueProduct["picture"] };

type Shelf = "catalogue" | "favourites" | "sets";

type Chip = { label: string; selected: boolean; onPress: () => void };

const shownAs = ({ name }: { name: string }): Shown => catalogueProduct(name) ?? { key: foldName(name), name };

export function CatalogueSheet<T extends { name: string }>({
  items,
  open,
  onAdd,
  onRemove,
  addSet,
  onClose,
}: {
  items: readonly T[];
  open: readonly ListedEntry[];
  onAdd: (product: Shown) => void;
  /** Left out where a second tap has nothing to take back, and adds again. */
  onRemove?: (item: T) => void;
  /** Puts a set's entries where they go, and hands back its undo, or null when nothing was new. */
  addSet: (entries: readonly ListedEntry[]) => Promise<{ count: number; undo: () => Promise<unknown> } | null>;
  onClose: () => void;
}) {
  const { palette } = useTheme();
  const titleRef = useModalAccessibility(true, "catalogue");
  const [shown, setShown] = useState<Shelf>("catalogue");
  const [aisle, setAisle] = useState<Aisle>(AISLES[0]);
  const [query, setQuery] = useState("");
  const favourites = useProducts().data.filter((product) => product.starred);
  const listed = new Map(items.map((item) => [foldName(item.name), item]));
  const shelf: readonly Shown[] =
    shown === "catalogue" ? CATALOGUE.filter((product) => product.aisle === aisle) : shown === "favourites" ? favourites.map(shownAs) : [];
  const tile = (product: Shown) => {
    const item = listed.get(product.key);
    return <ProductTile key={product.key} product={product} added={item != null} onPress={() => (item && onRemove ? onRemove(item) : onAdd(product))} />;
  };

  return (
    <DialogShell title={tr.catalogue.title} titleRef={titleRef} onDismiss={onClose}>
      <SearchField value={query} onChangeText={setQuery} />
      {/* The same fold the search uses, so a field of spaces is no search. */}
      {foldName(query) !== "" ? (
        <Found typed={query} favourites={favourites} tile={tile} onAdd={(product) => { onAdd(product); setQuery(""); }} />
      ) : (
        <>
          <View role="radiogroup" {...radioGroupKeys()} accessibilityLabel={tr.catalogue.title} style={{ flexDirection: "row", marginTop: spacing.sm, padding: offset.tuck, borderRadius: radius.md, backgroundColor: palette.surfaceAlt }}>
            <ShelfChoice label={tr.catalogue.title} selected={shown === "catalogue"} onPress={() => setShown("catalogue")} />
            <ShelfChoice label={tr.catalogue.favourites} selected={shown === "favourites"} onPress={() => setShown("favourites")} />
            <ShelfChoice label={tr.catalogue.sets} selected={shown === "sets"} onPress={() => setShown("sets")} />
          </View>
          {shown === "catalogue" ? (
            <ScrollView
              horizontal
              role="radiogroup" {...radioGroupKeys()}
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
            <SetsShelf addSet={addSet} open={open} onClose={onClose} />
          ) : shelf.length === 0 ? (
            <Body muted style={{ marginTop: spacing.lg }}>{tr.catalogue.noFavourites}</Body>
          ) : null}
          <ProductGrid products={shelf} id={`${shown}-${aisle}`} tile={tile} style={{ marginTop: shown === "favourites" && shelf.length === 0 ? 0 : spacing.md }} />
        </>
      )}
      <Actions>
        <Button label={tr.common.done} size="sm" onPress={onClose} />
      </Actions>
    </DialogShell>
  );
}

function SearchField({ value, onChangeText }: { value: string; onChangeText: (typed: string) => void }) {
  const { palette } = useTheme();
  return (
    <View style={{ marginTop: spacing.sm }}>
      <TextField
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={tr.catalogue.search}
        placeholder={tr.catalogue.search}
        returnKeyType="search"
        // What is typed can be added as it stands, so it is held to a name's length.
        maxLength={NAME_MAX}
        style={{ paddingRight: controlSize.minimumTarget }}
      />
      {value ? (
        <Press accessibilityRole="button" accessibilityLabel={tr.catalogue.clearSearch} onPress={() => onChangeText("")} style={(state) => fieldAccessoryStyle(palette, state)}>
          <X accessible={false} size={iconSize.compact} color={palette.textSecondary} strokeWidth={iconStroke.regular} />
        </Press>
      ) : (
        // Cast: Expo's generated `expo-env.d.ts` adds `hovered` only where Expo has run, and CI has not.
        <View pointerEvents="none" style={fieldAccessoryStyle(palette, { pressed: false } as PressableStateCallbackType)}>
          <Search accessible={false} size={iconSize.compact} color={palette.textSecondary} strokeWidth={iconStroke.regular} />
        </View>
      )}
    </View>
  );
}

/** Mounted only while something is typed, so the household's products are watched only then. */
function Found({
  typed,
  favourites,
  tile,
  onAdd,
}: {
  typed: string;
  favourites: readonly { name: string }[];
  tile: (product: Shown) => ReactElement;
  onAdd: (product: Shown) => void;
}) {
  const known = useKnownProducts().data;
  const found = searchCatalogue([...known, ...favourites.map(({ name }) => ({ name, times: 0 }))], typed).map(shownAs);
  if (found.length > 0) return <ProductGrid products={found} id="found" tile={tile} style={{ marginTop: spacing.md }} />;
  const name = nameFrom(typed);
  return (
    <View accessibilityLiveRegion="polite" style={{ marginTop: spacing.lg, gap: spacing.md, alignItems: "flex-start" }}>
      <Body muted>{tr.catalogue.notFound(typed.trim())}</Body>
      {name ? <Button label={tr.catalogue.keep(name)} icon={Plus} variant="secondary" size="sm" onPress={() => onAdd(shownAs({ name }))} /> : null}
    </View>
  );
}

function ProductGrid({ products, id, tile, style }: { products: readonly Shown[]; id: string; tile: (product: Shown) => ReactElement; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: spacing.md }, style]}>
      {rowsOf(products, catalogueSheet.columns).map((row, at) => (
        <View key={`${id}-${at}`} style={{ flexDirection: "row", gap: spacing.xs }}>
          {row.map(tile)}
          {Array.from({ length: catalogueSheet.columns - row.length }, (_, cell) => (
            <View key={cell} style={{ flex: 1 }} />
          ))}
        </View>
      ))}
    </View>
  );
}

function SetsShelf({
  addSet,
  open,
  onClose,
}: {
  addSet: (entries: readonly ListedEntry[]) => Promise<{ count: number; undo: () => Promise<unknown> } | null>;
  open: readonly ListedEntry[];
  onClose: () => void;
}) {
  const sets = useSets().data;
  const make = async () => {
    const name = await appPrompt(tr.sets.makeTitle, tr.sets.makeMessage(open.length), {
      confirmLabel: tr.lists.createConfirm,
      examples: tr.placeholders.setName,
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
      const added = await addSet(set.entries);
      if (!added) return showNotice(tr.items.pastedNothing);
      selectionTap();
      showUndo(tr.sets.added(set.name, added.count), added.undo);
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
          <Button label={tr.sets.make} variant="secondary" size="sm" onPress={() => void make()} />
        </View>
      ) : null}
    </View>
  );
}

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
        <Text style={[type.body, { fontFamily: font.semibold, color: palette.textStrong }]}>{set.name}</Text>
        <Text style={[type.small, { color: palette.textSecondary }]}>{holds}</Text>
      </Pressable>
      <View style={{ paddingRight: spacing.sm }}>
        <IconButton icon={Trash} label={tr.sets.delete(set.name)} tone="danger" onPress={onDelete} />
      </View>
    </View>
  );
}

function ShelfChoice({ label, selected, onPress }: Chip) {
  const { palette } = useTheme();
  return (
    <Press
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
    </Press>
  );
}

export function AisleChip({ label, selected, onPress }: Chip) {
  const { palette } = useTheme();
  return (
    <Press
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
    </Press>
  );
}

/** A product's tile and name; on the list, the tick pops onto its corner (`docs/UI.md` section 7). */
function ProductTile({ product, added, onPress }: { product: Shown; added: boolean; onPress: () => void }) {
  const { palette } = useTheme();
  return (
    <Press
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
    </Press>
  );
}
