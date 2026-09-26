/**
 * The item panel (`docs/UI.md` section 6: the row opens, the circle ticks): an
 * item's name, note, quantity and urgency; whether it was not found, and once
 * it was not found or is in the basket, what was bought instead; which list
 * it is on (SPEC 4.3); and its delete. It is the prompt's sheet with more in
 * it, so it rises and closes like every other dialog here.
 */

import { useState } from "react";
import { Text, View } from "react-native";
import Minus from "lucide-react-native/icons/minus";
import Plus from "lucide-react-native/icons/plus";
import Trash from "lucide-react-native/icons/trash";

import { NOTE_MAX, formatQuantity, quantityOrOne, stepQuantity, type ItemChange } from "../domain/items";
import { formatMinorInput, readPrice } from "../domain/money";
import { NAME_MAX } from "../domain/names";
import { tr } from "../i18n/tr";
import { useModalAccessibility } from "./accessibility";
import { PriceField } from "./calculator";
import { Body, Button, ChoiceTile, IconButton, TextField, Toggle, rowsOf, type ShownItem } from "./components";
import { Actions, DialogShell } from "./dialog";
import { selectionTap } from "./haptics";
import { controlSize, font, itemPanel, spacing, type, useTheme } from "./theme";

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
  const save = () =>
    ready &&
    onSave(
      { name, ...quantity, note, urgent, notFound, boughtInstead: offersBought ? instead : null, priceMinor: paid.minor },
      to ? { list: to, keep } : null,
    );
  const submits = { returnKeyType: "done", onSubmitEditing: save } as const;
  const step = (next: typeof less) => {
    if (!next) return;
    selectionTap();
    setQuantity(next);
  };

  return (
    <DialogShell title={item.name} titleRef={titleRef} onDismiss={onClose}>
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
        {item.checkedAt == null && !moving ? <Toggle value={notFound} onValueChange={setNotFound} label={tr.items.notFound} /> : null}
      </View>
      {offersBought ? <Bought instead={instead} price={price} onInstead={setInstead} onPrice={setPrice} submits={submits} /> : null}
      {lists.length > 1 ? (
        <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
          <Body>{tr.items.list}</Body>
          <View role="radiogroup" accessibilityLabel={tr.items.list} style={{ gap: spacing.sm }}>
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
          {to ? <Toggle value={keep} onValueChange={setKeep} label={tr.items.keepHere} /> : null}
        </View>
      ) : null}
      <Actions>
        <View style={{ flex: 1, alignItems: "flex-start" }}>
          <IconButton icon={Trash} label={tr.items.delete(item.name)} tone="danger" onPress={onDelete} />
        </View>
        <Button label={tr.common.cancel} variant="ghost" size="sm" onPress={onClose} />
        <Button label={tr.common.save} size="sm" disabled={!ready} onPress={save} />
      </Actions>
    </DialogShell>
  );
}

/** What was bought in the item's place, and what was paid. */
function Bought({
  instead,
  price,
  onInstead,
  onPrice,
  submits,
}: {
  instead: string;
  price: string;
  onInstead: (typed: string) => void;
  onPrice: (typed: string) => void;
  submits: { returnKeyType: "done"; onSubmitEditing: () => void };
}) {
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
      <PriceField value={price} onChangeText={onPrice} label={tr.items.priceLabel} placeholder={tr.items.pricePlaceholder} {...submits} style={{ marginTop: spacing.sm }} />
    </>
  );
}
