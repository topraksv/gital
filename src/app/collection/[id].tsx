import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import Gift from "lucide-react-native/icons/gift";
import Pencil from "lucide-react-native/icons/pencil";
import Plus from "lucide-react-native/icons/plus";
import Trash from "lucide-react-native/icons/trash";

import { useCollections, useWishes } from "../../data/hooks";
import { deleteList, editList, restoreList } from "../../data/lists";
import { addWish, deleteWish, restoreWish, saveWish, toggleWishBought, type Collection, type WishChange } from "../../data/wishes";
import type { ListLook } from "../../domain/lists";
import { LINK_MAX, leadOf, shopOf, type Wish } from "../../domain/wishes";
import { formatMinor } from "../../domain/money";
import { tr } from "../../i18n/tr";
import { ArrivalScope, CheckMark, EmptyState, IconButton, ReadFailed, Screen, SectionHeader, SlideUp, TextField, Tile, cardEdge } from "../../ui/components";
import { appError } from "../../ui/dialog";
import { mediumImpact, selectionTap } from "../../ui/haptics";
import { interactionSurface } from "../../ui/interaction";
import { webKeys } from "../../ui/keys";
import { ListSheet } from "../../ui/list-sheet";
import { RowMotion } from "../../ui/list-motion";
import { navigateBack } from "../../ui/navigation";
import { controlSize, density, font, itemRow, motion, offset, spacing, type, useTheme } from "../../ui/theme";
import { showUndo } from "../../ui/undo";
import { WishSheet } from "../../ui/wish-sheet";

/** One wish collection (SPEC 7): what is wished, the most wanted first, and what it comes to. */
export default function CollectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { palette } = useTheme();
  const collections = useCollections();
  const wishes = useWishes(id);
  const [leaving, setLeaving] = useState<Collection | null>(null);
  const [editing, setEditing] = useState<Wish | null>(null);
  const collection = leaving ?? collections.data.find((candidate) => candidate.id === id);

  if (collections.updatedAt != null && !collection) return <Redirect href="/wishes" />;

  const open = wishes.data.filter((wish) => wish.boughtAt == null);
  const bought = wishes.data.filter((wish) => wish.boughtAt != null);

  const remove = async (current: Collection) => {
    setLeaving(current);
    mediumImpact();
    try {
      const snapshot = await deleteList(current.id);
      if (snapshot) showUndo(tr.common.deleted(current.name), () => restoreList(snapshot));
      navigateBack(router, "/wishes");
    } catch {
      setLeaving(null);
      void appError(tr.errors.deleteFailed);
    }
  };

  const toggle = async (wish: Wish) => {
    selectionTap();
    try {
      await toggleWishBought(wish.id);
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };

  const save = async (wish: Wish, change: WishChange) => {
    setEditing(null);
    try {
      await saveWish(wish.id, change);
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };

  const removeWish = async (wish: Wish) => {
    setEditing(null);
    mediumImpact();
    try {
      const snapshot = await deleteWish(wish.id);
      if (snapshot) showUndo(tr.common.deleted(wish.name), () => restoreWish(snapshot));
    } catch {
      void appError(tr.errors.deleteFailed);
    }
  };

  const row = (wish: Wish) => (
    <RowMotion key={wish.id}>
      <SlideUp distance={motion.travel.bar}>
        <WishRow wish={wish} onOpen={() => setEditing(wish)} onToggle={() => toggle(wish)} />
      </SlideUp>
    </RowMotion>
  );

  return (
    <Screen
      back="/wishes"
      title={collection?.name}
      width="workspace"
      actions={
        collection && !leaving ? (
          <>
            <EditCollection collection={collection} />
            <IconButton icon={Trash} label={tr.wishes.delete(collection.name)} tone="danger" onPress={() => remove(collection)} />
          </>
        ) : null
      }
    >
      {collections.status === "error" || wishes.status === "error" ? (
        <ReadFailed queries={[collections, wishes]} />
      ) : collection && wishes.updatedAt != null ? (
        <ArrivalScope>
          <AddWish listId={collection.id} />
          {collection.openTotalMinor == null ? null : (
            <Text style={[type.small, { color: palette.textSecondary, marginBottom: spacing.md }]}>{tr.wishes.openTotal(collection.openTotalMinor)}</Text>
          )}
          {wishes.data.length === 0 ? (
            <EmptyState icon={Gift} title={tr.wishes.itemsEmptyTitle} hint={tr.wishes.itemsEmptyHint} />
          ) : (
            <View style={{ gap: density.list.rowGap }}>
              {[
                ...open.map(row),
                bought.length > 0 ? (
                  <RowMotion key="bought">
                    <SlideUp distance={motion.travel.bar}>
                      <SectionHeader>{tr.wishes.bought}</SectionHeader>
                    </SlideUp>
                  </RowMotion>
                ) : null,
                ...bought.map(row),
              ]}
            </View>
          )}
        </ArrivalScope>
      ) : null}
      {editing ? (
        <WishSheet
          key={editing.id}
          wish={editing}
          onSave={(change) => save(editing, change)}
          onDelete={() => removeWish(editing)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Screen>
  );
}

/** A name or a pasted link; a link becomes a wish named after its shop (SPEC 7.1). */
function AddWish({ listId }: { listId: string }) {
  const [text, setText] = useState("");
  const add = async () => {
    const typed = text;
    if (typed.trim() === "") return;
    setText("");
    try {
      await addWish(listId, typed);
      selectionTap();
    } catch {
      setText((current) => (current === "" ? typed : current));
      void appError(tr.errors.saveFailed);
    }
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.lg }}>
      <TextField
        value={text}
        onChangeText={setText}
        onSubmitEditing={add}
        blurOnSubmit={false}
        returnKeyType="done"
        autoCapitalize="none"
        accessibilityLabel={tr.wishes.addLabel}
        placeholder={tr.wishes.addPlaceholder}
        maxLength={LINK_MAX}
        style={{ flex: 1 }}
      />
      <IconButton icon={Plus} label={tr.wishes.add} tone="primary" onPress={add} />
    </View>
  );
}

/** What a wish's row says under its name: wanted most, where it is cheapest and for how much, or the guess. */
function detailOf(wish: Wish): { text: string; wanted?: boolean }[] {
  const lead = leadOf(wish.links);
  const parts: { text: string; wanted?: boolean }[] = [];
  if (wish.priority === 2) parts.push({ text: tr.wishes.wanted, wanted: true });
  if (lead) parts.push({ text: shopOf(lead.url) });
  if (lead?.priceMinor != null) parts.push({ text: formatMinor(lead.priceMinor) });
  else if (wish.estimateMinor != null) parts.push({ text: tr.wishes.estimated(wish.estimateMinor) });
  return parts;
}

function WishRow({ wish, onOpen, onToggle }: { wish: Wish; onOpen: () => void; onToggle: () => void }) {
  const { palette } = useTheme();
  const done = wish.boughtAt != null;
  const parts = detailOf(wish);
  return (
    <View style={{ ...cardEdge(palette), padding: 0, flexDirection: "row", backgroundColor: palette.surface, overflow: "hidden" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr.common.withDetail(wish.name, parts.map((part) => part.text).join(", "))}
        accessibilityHint={tr.wishes.openWishHint}
        onPress={onOpen}
        style={(state) => ({
          flex: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
          padding: density.list.cardPadding,
          ...interactionSurface(palette, state),
        })}
      >
        <Tile id={wish.id} name={wish.name} size={itemRow.tile} />
        <View style={{ flex: 1, minWidth: 0, gap: offset.tight }}>
          <Text
            style={[
              type.body,
              { fontFamily: font.medium, color: done ? palette.textSecondary : palette.textStrong, textDecorationLine: done ? "line-through" : "none" },
            ]}
          >
            {wish.name}
          </Text>
          {parts.length > 0 ? (
            <Text style={[type.small, { color: palette.textSecondary }]}>
              {parts.map((part, at) => (
                <Text key={at} style={part.wanted ? { fontFamily: font.semibold, color: palette.warningText } : null}>
                  {at > 0 ? tr.common.separator : null}
                  {part.text}
                </Text>
              ))}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="checkbox"
        aria-checked={done}
        accessibilityState={{ checked: done }}
        accessibilityLabel={tr.common.withDetail(wish.name, tr.wishes.bought)}
        onPress={onToggle}
        {...webKeys({ " ": onToggle }, { repeats: false })}
        style={(state) => ({
          minWidth: controlSize.minimumTarget,
          paddingHorizontal: spacing.md,
          alignItems: "center",
          justifyContent: "center",
          ...interactionSurface(palette, state),
        })}
      >
        <CheckMark checked={done} />
      </Pressable>
    </View>
  );
}

/** The pencil and the collection panel: the list panel, since a collection is a list of its own kind. */
function EditCollection({ collection }: { collection: Collection }) {
  const [open, setOpen] = useState(false);
  const save = async (look: ListLook) => {
    setOpen(false);
    try {
      await editList(collection.id, look);
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };
  return (
    <>
      <IconButton icon={Pencil} label={tr.wishes.edit(collection.name)} onPress={() => setOpen(true)} />
      {open ? <ListSheet list={collection} onSave={save} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
