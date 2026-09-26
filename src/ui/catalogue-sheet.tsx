/**
 * The catalogue panel (`docs/SPEC.md` 2.12): an aisle at a time, each product
 * a tile that a tap puts on the list and a second tap takes off again. What
 * the list already holds, ticked or not, wears the tick, found by name as the
 * list merges an entry (2.5), so a product typed in earlier is one here too.
 */

import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { AISLES, CATALOGUE, type Aisle, type CatalogueProduct } from "../domain/catalogue";
import { foldName } from "../domain/items";
import { tr } from "../i18n/tr";
import { useModalAccessibility } from "./accessibility";
import { Button, CheckMark, Tile, radioChoice, rowsOf } from "./components";
import { Actions, DialogShell } from "./dialog";
import { interactionSurface } from "./interaction";
import { webKeys } from "./keys";
import { borderWidth, catalogueSheet, controlSize, font, offset, radius, spacing, type, useTheme } from "./theme";

export function CatalogueSheet<T extends { name: string }>({
  items,
  onAdd,
  onRemove,
  onClose,
}: {
  items: readonly T[];
  onAdd: (product: CatalogueProduct) => void;
  onRemove: (item: T) => void;
  onClose: () => void;
}) {
  const titleRef = useModalAccessibility(true, "catalogue");
  const [aisle, setAisle] = useState<Aisle>(AISLES[0]);
  const listed = new Map(items.map((item) => [foldName(item.name), item]));
  const shelf = CATALOGUE.filter((product) => product.aisle === aisle);

  return (
    <DialogShell title={tr.catalogue.title} titleRef={titleRef} onDismiss={onClose}>
      <ScrollView
        horizontal
        role="radiogroup"
        accessibilityLabel={tr.catalogue.aisle}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs }}
        style={{ marginTop: spacing.sm, marginBottom: spacing.md }}
      >
        {AISLES.map((each) => (
          <AisleChip key={each} label={tr.catalogue.aisles[each]} selected={each === aisle} onPress={() => setAisle(each)} />
        ))}
      </ScrollView>
      <View style={{ gap: spacing.md }}>
        {rowsOf(shelf, catalogueSheet.columns).map((row, at) => (
          <View key={`${aisle}-${at}`} style={{ flexDirection: "row", gap: spacing.xs }}>
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
function ProductTile({ product, added, onPress }: { product: CatalogueProduct; added: boolean; onPress: () => void }) {
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
