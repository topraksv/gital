/**
 * The item panel (`docs/UI.md` section 6: the row opens, the circle ticks): an
 * item's name, note, quantity and urgency; whether it was not found, and once
 * it was not found or is in the basket, what was bought instead; which list
 * it is on (SPEC 4.3); and its delete. It is the prompt's sheet with more in
 * it, so it rises and closes like every other dialog here.
 */

import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import Minus from "lucide-react-native/icons/minus";
import Plus from "lucide-react-native/icons/plus";
import Star from "lucide-react-native/icons/star";
import Trash from "lucide-react-native/icons/trash";

import { useBought, useMovedAisles, useProducts } from "../data/hooks";
import { setAisle, setStarred } from "../data/products";
import { AISLES, aisleOf, catalogueProduct, type Aisle } from "../domain/catalogue";
import { NOTE_MAX, foldName, formatQuantity, quantityOrOne, stepQuantity, type ItemChange, type Quantity } from "../domain/items";
import { formatMinorInput, pastOf, priceRise, readPrice, type Bought as BoughtBefore } from "../domain/money";
import { NAME_MAX } from "../domain/names";
import { tr } from "../i18n/tr";
import { useModalAccessibility } from "./accessibility";
import { PriceField } from "./calculator";
import { AisleChip } from "./catalogue-sheet";
import { PriceLine } from "./charts";
import { Body, Button, ChoiceTile, IconButton, TextField, Toggle, rowsOf, type ShownItem } from "./components";
import { Actions, DialogShell, appError } from "./dialog";
import { selectionTap } from "./haptics";
import { controlSize, font, itemPanel, spacing, type, useTheme } from "./theme";
import { radioGroupKeys } from "./keys";
import { PanelPart } from "./list-motion";

type ListChoice = { id: string; name: string };

/** Another list the save sends the item to, and whether it stays on this one too. */
export type ItemDestination = { list: ListChoice; keep: boolean };

export function ItemSheet({
  item,
  listId,
  lists,
  onSave,
  onDelete,
  onClose,
}: {
  item: ShownItem & { id: string };
  listId: string;
  lists: readonly ListChoice[];
  onSave: (change: ItemChange, to: ItemDestination | null) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { palette } = useTheme();
  const titleRef = useModalAccessibility(true, item.id);
  const before = useBought(item.id).data;
  const starred = useProducts().data.some((product) => product.starred && foldName(product.name) === foldName(item.name));
  const placed = aisleOf(item.name, useMovedAisles());
  const [aisle, setShelf] = useState(placed);
  // The star is the product's, not this item's, so it is written at once rather than on Kaydet.
  const star = () => {
    selectionTap();
    setStarred(item.name, !starred).catch(() => appError(tr.errors.saveFailed));
  };
  const [name, setName] = useState(item.name);
  const [note, setNote] = useState(item.note ?? "");
  const [quantity, setQuantity] = useState({ quantityMilli: item.quantityMilli, unit: item.unit });
  const [urgent, setUrgent] = useState(item.urgent);
  const [notFound, setNotFound] = useState(item.notFound);
  const [instead, setInstead] = useState(item.boughtInstead ?? "");
  const [price, setPrice] = useState(formatMinorInput(item.priceMinor));
  const [destination, setDestination] = useState(listId);
  const [keep, setKeep] = useState(false);
  // A list deleted while the panel is open is no longer a destination.
  const to = lists.find((list) => list.id === destination && list.id !== listId);
  // Moving, the tick and what was found stay with this list's shop, so they are not asked.
  const moving = to != null && !keep;
  const columns = Math.min(lists.length, itemPanel.listColumns);
  const rows = rowsOf(lists, columns);
  const less = stepQuantity(quantity, -1);
  const more = stepQuantity(quantity, 1);
  // Offered on an item still to find, a substitute or a price typed while
  // planning ("Sütaş if there is no Pınar") would tick it as bought.
  const offersBought = !moving && (item.checkedAt != null || notFound);
  const paid = readPrice(offersBought ? price : "");
  const ready = name.trim() !== "" && paid.ok;
  const save = () => {
    if (!ready) return;
    // The aisle is the product's: kept by name for every list, and forgotten
    // when it is put back where the catalogue has it.
    if (aisle !== placed) moveProduct(name, aisle);
    onSave(
      { name, ...quantity, note, urgent, notFound, boughtInstead: offersBought ? instead : null, priceMinor: paid.minor },
      to ? { list: to, keep } : null,
    );
  };
  const submits = { returnKeyType: "done", onSubmitEditing: save } as const;
  const step = (next: typeof less) => {
    if (!next) return;
    selectionTap();
    setQuantity(next);
  };

  return (
    <DialogShell
      title={item.name}
      titleRef={titleRef}
      onDismiss={onClose}
      action={<IconButton icon={Star} label={tr.items.favourite} on={starred} onPress={star} />}
    >
      <TextField
        value={name}
        maxLength={NAME_MAX}
        onChangeText={setName}
        accessibilityLabel={tr.items.nameLabel}
        {...submits}
        style={{ marginTop: spacing.lg }}
      />
      <TextField
        value={note}
        maxLength={NOTE_MAX}
        onChangeText={setNote}
        accessibilityLabel={tr.items.noteLabel}
        placeholder={tr.items.notePlaceholder}
        {...submits}
        style={{ marginTop: spacing.sm }}
      />
      <Past before={before} name={item.name} />
      <View style={{ marginTop: spacing.lg }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text style={[type.body, { color: palette.text, flex: 1 }]}>{tr.items.quantity}</Text>
          <IconButton icon={Minus} label={tr.items.less(item.name)} disabled={!less} onPress={() => step(less)} />
          {/* An item without a quantity reads as one piece, so it is shown as
              one, quieter, until − or + gives it a quantity of its own. */}
          <Text
            accessibilityLiveRegion="polite"
            style={[
              type.body,
              { fontFamily: font.medium, textAlign: "center", minWidth: itemPanel.quantityWidth, color: quantity.quantityMilli == null ? palette.textSecondary : palette.text },
            ]}
          >
            {formatQuantity(quantityOrOne(quantity))}
          </Text>
          <IconButton icon={Plus} label={tr.items.more(item.name)} disabled={!more} onPress={() => step(more)} />
        </View>
        <Toggle value={urgent} onValueChange={setUrgent} label={tr.items.urgent} />
        {/* A ticked item was found. */}
        {item.checkedAt == null && !moving ? (
          <PanelPart appears>
            <Toggle value={notFound} onValueChange={setNotFound} label={tr.items.notFound} />
          </PanelPart>
        ) : null}
      </View>
      <PanelPart>
        <AislePicker name={item.name} value={aisle} onChange={setShelf} />
      </PanelPart>
      {offersBought ? (
        <PanelPart appears>
          <Bought
            before={before}
            product={{ name, ...quantity }}
            paidMinor={paid.ok ? paid.minor : null}
            instead={instead}
            price={price}
            onInstead={setInstead}
            onPrice={setPrice}
            submits={submits}
          />
        </PanelPart>
      ) : null}
      {lists.length > 1 ? (
        <PanelPart>
          <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
            <Body>{tr.items.list}</Body>
            <View role="radiogroup" {...radioGroupKeys()} accessibilityLabel={tr.items.list} style={{ gap: spacing.sm }}>
              {rows.map((row, at) => (
                <View key={at} style={{ flexDirection: "row", gap: spacing.sm }}>
                  {row.map((list) => (
                    <ChoiceTile
                      key={list.id}
                      label={list.name}
                      selected={list.id === (to?.id ?? listId)}
                      minHeight={controlSize.minimumTarget}
                      basis={itemPanel.listCellBasis}
                      onPress={() => setDestination(list.id)}
                    />
                  ))}
                  {/* Empty cells keep a short last row's tiles as wide as the rest. */}
                  {Array.from({ length: columns - row.length }, (_, cell) => (
                    <View key={cell} style={{ flexGrow: 1, flexBasis: itemPanel.listCellBasis }} />
                  ))}
                </View>
              ))}
            </View>
            {to ? (
              <PanelPart appears>
                <Toggle value={keep} onValueChange={setKeep} label={tr.items.keepHere} />
              </PanelPart>
            ) : null}
          </View>
        </PanelPart>
      ) : null}
      <PanelPart>
        <Actions>
          <View style={{ flex: 1, alignItems: "flex-start" }}>
            <IconButton icon={Trash} label={tr.items.delete(item.name)} tone="danger" onPress={onDelete} />
          </View>
          <Button label={tr.common.cancel} variant="ghost" size="sm" onPress={onClose} />
          <Button label={tr.common.save} size="sm" disabled={!ready} onPress={save} />
        </Actions>
      </PanelPart>
    </DialogShell>
  );
}

/**
 * When the product was last bought, on any list, and how its price has moved
 * (SPEC 3.9): a quiet line under its note, and its prices as a line.
 */
/**
 * The aisle is the product's (SPEC 5.4): kept by name for every list, and
 * forgotten when it is put back where the catalogue has it.
 */
function moveProduct(name: string, aisle: Aisle | "other") {
  const home = catalogueProduct(name)?.aisle;
  setAisle(name, aisle === home || aisle === "other" ? null : aisle).catch(() => appError(tr.errors.saveFailed));
}

/** Diğer is where a product the catalogue does not know goes back to; one it knows goes back to its own aisle, so Diğer is not offered for it. */
function AislePicker({ name, value, onChange }: { name: string; value: Aisle | "other"; onChange: (aisle: Aisle | "other") => void }) {
  const shelves = catalogueProduct(name) ? AISLES : [...AISLES, "other" as const];
  return (
    <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
      <Body>{tr.items.aisle}</Body>
      <ScrollView
        horizontal
        role="radiogroup" {...radioGroupKeys()}
        accessibilityLabel={tr.items.aisle}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs }}
      >
        {shelves.map((each) => (
          <AisleChip key={each} label={tr.catalogue.aisles[each]} selected={each === value} onPress={() => onChange(each)} />
        ))}
      </ScrollView>
    </View>
  );
}

function Past({ before, name }: { before: readonly BoughtBefore[]; name: string }) {
  const { palette } = useTheme();
  const past = pastOf(before, name);
  if (!past) return null;
  const line = [type.small, { color: palette.textSecondary }];
  return (
    <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
      <Text style={line}>{tr.items.lastBought(past.lastAt, past.lastPriceMinor)}</Text>
      {past.prices.length > 1 ? <PriceLine prices={past.prices} /> : null}
    </View>
  );
}

/**
 * What was bought in the item's place, and what was paid — said to be dear
 * when it is (SPEC 3.12). The panel says it and the row does not: the aisle
 * needs the number, and the sentence would wrap every priced row at 360 dp.
 */
function Bought({
  before,
  product,
  paidMinor,
  instead,
  price,
  onInstead,
  onPrice,
  submits,
}: {
  before: readonly BoughtBefore[];
  product: Quantity & { name: string };
  paidMinor: number | null;
  instead: string;
  price: string;
  onInstead: (typed: string) => void;
  onPrice: (typed: string) => void;
  submits: { returnKeyType: "done"; onSubmitEditing: () => void };
}) {
  const { palette } = useTheme();
  const rise = paidMinor == null ? null : priceRise(before, product, paidMinor);
  return (
    <>
      <TextField
        value={instead}
        maxLength={NAME_MAX}
        onChangeText={onInstead}
        accessibilityLabel={tr.items.insteadLabel}
        placeholder={tr.items.insteadPlaceholder}
        {...submits}
        style={{ marginTop: spacing.sm }}
      />
      <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
        <PriceField value={price} onChangeText={onPrice} label={tr.items.priceLabel} placeholder={tr.items.pricePlaceholder} {...submits} />
        {rise == null ? null : <Text style={[type.small, { color: palette.warningText }]}>{tr.items.priceRise(rise)}</Text>}
      </View>
    </>
  );
}
