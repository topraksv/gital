/** The list panel (SPEC 1.1, 1.8), saved in one write; each choice is drawn as the card draws it, so the panel is its own preview. */

import { useState, type ComponentProps, type ReactNode } from "react";
import { View } from "react-native";
import Check from "lucide-react-native/icons/check";
import Pencil from "lucide-react-native/icons/pencil";

import { createList, editList } from "../data/lists";
import { LIST_COLORS, LIST_ICONS, type ListColor, type ListIcon, type ListLook } from "../domain/lists";
import { NAME_MAX } from "../domain/names";
import { tr } from "../i18n/tr";
import { useModalAccessibility } from "./accessibility";
import { Body, Button, IconButton, TextField, Tile, ToggleRow, radioChoice, rowsOf } from "./components";
import { Actions, DialogShell, appError, appPrompt } from "./dialog";
import { selectionTap } from "./haptics";
import { borderWidth, circle, iconSize, iconStroke, listSheet, spacing, tileRadius, useTheme } from "./theme";
import { Press } from "./press";
import { confirmDiscard, useDraftDirty } from "./dirty-exit";
import { radioGroupKeys } from "./keys";

// The ring and a gap as wide as it, inside the cell.
const TILE = listSheet.cell - 4 * borderWidth.selected;

function ListSheet({
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
  const [attempted, setAttempted] = useState(false);
  const ready = name.trim() !== "";
  const save = () => (ready ? onSave({ name, color, icon, pantry }) : setAttempted(true));
  const dirty = useDraftDirty(JSON.stringify({ name, color, icon, pantry }));
  const close = () => confirmDiscard(dirty, onClose);

  return (
    <DialogShell title={list.name} titleRef={titleRef} onDismiss={close} dirty={dirty}>
      <TextField
        value={name}
        maxLength={NAME_MAX}
        onChangeText={setName}
        accessibilityLabel={tr.lists.nameLabel}
        error={attempted && !ready ? tr.forms.nameRequired : null}
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
          <ToggleRow value={pantry} onValueChange={setPantry} title={tr.lists.pantry} />
        </View>
      ) : null}
      <Actions>
        <Button label={tr.common.cancel} variant="ghost" size="sm" onPress={close} />
        <Button label={tr.common.save} size="sm" onPress={save} />
      </Actions>
    </DialogShell>
  );
}

/** Rows of `listSheet.columns`, edge to edge; a short last row keeps the columns. */
function Grid({ label, children }: { label: string; children: ReactNode[] }) {
  const rows = rowsOf(children, listSheet.columns);
  return (
    <View role="radiogroup" {...radioGroupKeys()} accessibilityLabel={label} style={{ gap: spacing.sm }}>
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

/** The pencil and the list panel it opens: a list's or collection's name, colour and picture (SPEC 1.8). */
export function EditLook({ list, label }: { list: ComponentProps<typeof ListSheet>["list"]; label: string }) {
  const [open, setOpen] = useState(false);
  const save = async (look: ListLook) => {
    setOpen(false);
    await editList(list.id, look).catch(() => void appError(tr.errors.saveFailed));
  };
  return (
    <>
      <IconButton icon={Pencil} label={label} onPress={() => setOpen(true)} />
      {open ? <ListSheet list={list} onSave={save} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const NEW = {
  shop: [tr.lists.createTitle, tr.lists.createMessage, tr.placeholders.listName],
  wish: [tr.wishes.createTitle, tr.wishes.createMessage, tr.placeholders.collectionName],
} as const;

export async function createNamedList(kind: "shop" | "wish"): Promise<void> {
  const [title, message, examples] = NEW[kind];
  const name = await appPrompt(title, message, { examples, confirmLabel: tr.lists.createConfirm, maxLength: NAME_MAX });
  if (name == null) return;
  await createList(name, kind).then(selectionTap, () => void appError(tr.errors.saveFailed));
}
