/**
 * The catalogue panel (`docs/SPEC.md` 2.12): an aisle at a time, each product
 * a tile that a tap puts on the list and a second tap takes off again. What
 * the list already holds, ticked or not, wears the tick, found by name as the
 * list merges an entry (2.5), so a product typed in earlier is one here too.
 * Favoriler (5.1) is the same grid over what the person starred, a product
 * outside the catalogue drawn with its initial as a list's item is.
 */

import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { useFavourites } from "../data/hooks";
import { AISLES, CATALOGUE, catalogueProduct, type Aisle, type CatalogueProduct } from "../domain/catalogue";
import { foldName } from "../domain/items";
import { tr } from "../i18n/tr";
import { useModalAccessibility } from "./accessibility";
import { Body, Button, CheckMark, Tile, radioChoice, rowsOf } from "./components";
import { Actions, DialogShell } from "./dialog";
import { interactionSurface } from "./interaction";
import { webKeys } from "./keys";
import { borderWidth, catalogueSheet, controlSize, font, offset, radius, spacing, themeShadow, type, useTheme } from "./theme";

/** What a tile needs: a product outside the catalogue has no picture. */
type Shown = Pick<CatalogueProduct, "key" | "name"> & { picture?: CatalogueProduct["picture"] };

type Shelf = "catalogue" | "favourites";

export function CatalogueSheet<T extends { name: string }>({
  items,
  onAdd,
  onRemove,
  onClose,
}: {
  items: readonly T[];
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
      : favourites.map(({ name }) => catalogueProduct(name) ?? { key: foldName(name), name });

  return (
    <DialogShell title={tr.catalogue.title} titleRef={titleRef} onDismiss={onClose}>
      <View role="radiogroup" accessibilityLabel={tr.catalogue.title} style={{ flexDirection: "row", marginTop: spacing.sm, padding: offset.tuck, borderRadius: radius.md, backgroundColor: palette.surfaceAlt }}>
        <ShelfChoice label={tr.catalogue.title} selected={shown === "catalogue"} onPress={() => setShown("catalogue")} />
        <ShelfChoice label={tr.catalogue.favourites} selected={shown === "favourites"} onPress={() => setShown("favourites")} />
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

/** One side of the Katalog · Favoriler switch: the chosen one lifts off the track. */
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
