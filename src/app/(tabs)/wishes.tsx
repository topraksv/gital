import { View } from "react-native";
import { useRouter } from "expo-router";
import Gift from "lucide-react-native/icons/gift";
import LogIn from "lucide-react-native/icons/log-in";
import Plus from "lucide-react-native/icons/plus";
import Trash from "lucide-react-native/icons/trash";

import { useCollections } from "../../data/hooks";
import { createList, deleteLists, restoreList } from "../../data/lists";
import { NAME_MAX } from "../../domain/names";
import { tr } from "../../i18n/tr";
import { ArrivalScope, Button, EmptyState, IconButton, LinkCard, ReadFailed, Screen, SlideUp } from "../../ui/components";
import { appError, appPrompt } from "../../ui/dialog";
import { selectionTap } from "../../ui/haptics";
import { RowMotion, RowSwipe } from "../../ui/list-motion";
import { deleteWithUndo, selectionHeader, useSelection } from "../../ui/selection";
import { density, motion } from "../../ui/theme";
import { usePulledOnce } from "../../ui/tour";

/** İstekler (SPEC 7): the wish collections, drawn as Listeler draws its lists. */
export default function Wishes() {
  const pulled = usePulledOnce();
  const collections = useCollections();
  const router = useRouter();
  // Only collections the person owns can be deleted, so only they swipe or are chosen.
  const selection = useSelection(collections.data.filter((collection) => collection.owner));

  const removeCollections = (chosen: readonly { id: string; name: string }[]) => deleteWithUndo(chosen, tr.selection.nouns.collection, deleteLists, restoreList);

  const create = async () => {
    const name = await appPrompt(tr.wishes.createTitle, tr.wishes.createMessage, {
      examples: tr.placeholders.collectionName,
      confirmLabel: tr.lists.createConfirm,
      maxLength: NAME_MAX,
    });
    if (name == null) return;
    try {
      await createList(name, "wish");
      selectionTap();
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };

  const answered = collections.updatedAt != null;
  return (
    <Screen
      {...selectionHeader(
        selection,
        (chosen) => void removeCollections(chosen),
        tr.tabs.wishes,
        answered ? (
          <>
            <IconButton icon={LogIn} text={tr.sharing.joinShort} label={tr.sharing.join} onPress={() => router.push("/invite")} />
            <IconButton icon={Plus} label={tr.wishes.create} tone="primary" onPress={create} />
          </>
        ) : null,
      )}
      width="workspace"
    >
      {collections.status === "error" ? (
        <ReadFailed queries={[collections]} />
      ) : answered ? (
        <ArrivalScope>
          {collections.data.length === 0 ? (
            pulled && <EmptyState
              icon={Gift}
              title={tr.wishes.emptyTitle}
              hint={tr.wishes.emptyHint}
              action={<Button label={tr.wishes.create} icon={Plus} onPress={create} />}
            />
          ) : (
            <View style={{ gap: density.list.rowGap }}>
              {collections.data.map((collection) => {
                const left = collection.owner
                  ? { icon: Trash, tone: "destructive" as const, label: tr.wishes.delete(collection.name), run: () => void removeCollections([collection]) }
                  : undefined;
                return (
                <RowMotion key={collection.id}>
                <SlideUp distance={motion.travel.bar}>
                  <RowSwipe left={selection.active ? undefined : left}>
                  <LinkCard
                    tileId={collection.id}
                    look={collection}
                    title={collection.name}
                    detail={tr.wishes.summary(collection.open, collection.openTotalMinor)}
                    hint={tr.wishes.openHint}
                    onOpen={() =>
                      selection.active
                        ? collection.owner
                          ? selection.toggle(collection.id)
                          : undefined
                        : router.push({ pathname: "/collection/[id]", params: { id: collection.id } })
                    }
                    onLongPress={collection.owner ? () => selection.begin(collection.id) : undefined}
                    selected={selection.active && collection.owner ? selection.has(collection.id) : undefined}
                  />
                  </RowSwipe>
                </SlideUp>
                </RowMotion>
                );
              })}
            </View>
          )}
        </ArrivalScope>
      ) : null}
    </Screen>
  );
}
