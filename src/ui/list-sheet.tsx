/**
 * The list panel (SPEC 1.1, 1.8): a list's name, its colour and its picture,
 * saved in one write. It is the prompt's sheet with more in it, as the item
 * panel is. Every choice is drawn as the card will draw it — the pictures sit
 * on the colour chosen — so the panel is its own preview.
 */

import { useState, type ReactNode } from "react";
import { View } from "react-native";
import Check from "lucide-react-native/icons/check";

import { LIST_COLORS, LIST_ICONS, type ListColor, type ListIcon, type ListLook } from "../domain/lists";
import { NAME_MAX } from "../domain/names";
import { tr } from "../i18n/tr";
import { useModalAccessibility } from "./accessibility";
import { Body, Button, TextField, Tile, Toggle, radioChoice, rowsOf } from "./components";
import { Actions, DialogShell } from "./dialog";
import { borderWidth, circle, iconSize, iconStroke, listSheet, spacing, tileRadius, useTheme } from "./theme";
import { Press } from "./press";

// The ring and a gap as wide as it, inside the cell.
const TILE = listSheet.cell - 4 * borderWidth.selected;

export function ListSheet({
  list,
  onSave,
  onClose,
}: {
  /** `pantry` only on a shopping list: a wish collection fills no pantry (SPEC 12.5). */
  list: ListLook & { id: string; pantry?: boolean };
  onSave: (look: ListLook & { pantry?: boolean }) => void;
  onClose: () => void;
}) {
  const titleRef = useModalAccessibility(true, list.id);
  const [name, setName] = useState(list.name);
  const [color, setColor] = useState(list.color);
  const [icon, setIcon] = useState(list.icon);
  const [pantry, setPantry] = useState(list.pantry);
  const ready = name.trim() !== "";
  const save = () => ready && onSave({ name, color, icon, pantry });

  return (
    <DialogShell title={list.name} titleRef={titleRef} onDismiss={onClose}>
      <TextField
        value={name}
        maxLength={NAME_MAX}
        onChangeText={setName}
        accessibilityLabel={tr.lists.nameLabel}
        returnKeyType="done"
        onSubmitEditing={save}
        style={{ marginTop: spacing.lg }}
      />
      <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
        <Body>{tr.lists.color}</Body>
        <Grid label={tr.lists.color}>
          {([null, ...LIST_COLORS] as (ListColor | null)[]).map((hue) => (
            <Choice key={hue ?? "auto"} label={hue ? tr.lists.colors[hue] : tr.lists.colorAuto} selected={hue === color} round onPress={() => setColor(hue)}>
              <Tile id={list.id} name="" size={TILE} color={hue} round />
            </Choice>
          ))}
        </Grid>
      </View>
      <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
        <Body>{tr.lists.picture}</Body>
        <Grid label={tr.lists.picture}>
          {([null, ...LIST_ICONS] as (ListIcon | null)[]).map((picture) => (
            <Choice
              key={picture ?? "letter"}
              label={picture ? tr.lists.pictures[picture] : tr.lists.pictureLetter}
              selected={picture === icon}
              onPress={() => setIcon(picture)}
            >
              <Tile id={list.id} name={name} size={TILE} color={color} icon={picture} />
            </Choice>
          ))}
        </Grid>
      </View>
      {pantry != null ? (
        <View style={{ marginTop: spacing.lg }}>
          <Toggle value={pantry} onValueChange={setPantry} label={tr.lists.pantry} />
        </View>
      ) : null}
      <Actions>
        <Button label={tr.common.cancel} variant="ghost" size="sm" onPress={onClose} />
        <Button label={tr.common.save} size="sm" disabled={!ready} onPress={save} />
      </Actions>
    </DialogShell>
  );
}

/** Rows of `listSheet.columns`, edge to edge; a short last row keeps the columns. */
function Grid({ label, children }: { label: string; children: ReactNode[] }) {
  const rows = rowsOf(children, listSheet.columns);
  return (
    <View role="radiogroup" accessibilityLabel={label} style={{ gap: spacing.sm }}>
      {rows.map((row, at) => (
        <View key={at} style={{ flexDirection: "row", justifyContent: "space-between" }}>
          {row}
          {Array.from({ length: listSheet.columns - row.length }, (_, cell) => (
            <View key={cell} style={{ width: listSheet.cell }} />
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * One swatch or picture. The ring is drawn outside the tile, a gap from it, so
 * choosing never moves the tile; on a swatch, whose whole face is colour, a
 * tick says it too.
 */
function Choice({
  label,
  selected,
  round = false,
  onPress,
  children,
}: {
  label: string;
  selected: boolean;
  round?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const { palette } = useTheme();
  const side = listSheet.cell;
  return (
    <Press
      {...radioChoice({ label, selected, onPress })}
      style={{
        width: side,
        height: side,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: round ? circle(side) : tileRadius(side),
        borderCurve: "continuous",
        borderWidth: borderWidth.selected,
        borderColor: selected ? palette.primary : "transparent",
        overflow: "hidden",
      }}
    >
      {children}
      {selected && round ? (
        <View style={{ position: "absolute" }}>
          <Check accessible={false} size={iconSize.control} color={palette.textStrong} strokeWidth={iconStroke.regular} />
        </View>
      ) : null}
    </Press>
  );
}
