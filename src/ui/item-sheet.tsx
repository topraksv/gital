/**
 * The item panel (`docs/UI.md` section 6: the row opens, the circle ticks): an
 * item's name, note, quantity and urgency; whether it was not found, and once
 * it was not found or is in the basket, what was bought instead; and its
 * delete. It is the prompt's sheet with more in it, so it rises and closes
 * like every other dialog here.
 */

import { useState } from "react";
import { Text, View } from "react-native";
import Minus from "lucide-react-native/icons/minus";
import Plus from "lucide-react-native/icons/plus";
import Trash from "lucide-react-native/icons/trash";

import { NOTE_MAX, formatQuantity, quantityOrOne, stepQuantity, type ItemChange } from "../domain/items";
import { NAME_MAX } from "../domain/names";
import { tr } from "../i18n/tr";
import { useModalAccessibility } from "./accessibility";
import { Button, IconButton, TextField, Toggle, type ShownItem } from "./components";
import { Actions, DialogShell } from "./dialog";
import { selectionTap } from "./haptics";
import { font, itemPanel, spacing, type, useTheme } from "./theme";

export function ItemSheet({
  item,
  onSave,
  onDelete,
  onClose,
}: {
  item: ShownItem & { id: string };
  onSave: (change: ItemChange) => void;
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
  const less = stepQuantity(quantity, -1);
  const more = stepQuantity(quantity, 1);
  // Offered on an item still to find, a substitute typed while planning
  // ("Sütaş if there is no Pınar") would tick it as bought.
  const offersInstead = item.checkedAt != null || notFound;
  const ready = name.trim() !== "";
  const save = () => ready && onSave({ name, ...quantity, note, urgent, notFound, boughtInstead: offersInstead ? instead : null });
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
        {item.checkedAt == null ? <Toggle value={notFound} onValueChange={setNotFound} label={tr.items.notFound} /> : null}
      </View>
      {offersInstead ? (
        <TextField
          value={instead}
          maxLength={NAME_MAX}
          onChangeText={setInstead}
          accessibilityLabel={tr.items.insteadLabel}
          placeholder={tr.items.insteadPlaceholder}
          {...submits}
          style={{ marginTop: spacing.sm }}
        />
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

