import { View } from "react-native";
import { useRouter } from "expo-router";
import Gift from "lucide-react-native/icons/gift";
import LogIn from "lucide-react-native/icons/log-in";
import Plus from "lucide-react-native/icons/plus";

import { useCollections } from "../../data/hooks";
import { deleteLists, restoreList } from "../../data/lists";
import { tr } from "../../i18n/tr";
import { ArrivalScope, Button, EmptyState, IconButton, ReadFailed, Screen } from "../../ui/components";
import { createNamedList } from "../../ui/list-sheet";
import { OwnedCard, deleteWithUndo, selectionHeader, useSelection } from "../../ui/selection";
import { density, listCard } from "../../ui/theme";

/** İstekler (SPEC 7): the wish collections, drawn as Listeler draws its lists. */
export default function Wishes() {
  const collections = useCollections();
  const router = useRouter();
  // Only collections the person owns can be deleted, so only they swipe or are chosen.
  const selection = useSelection(collections.data.filter((collection) => collection.owner));

  const removeCollections = (chosen: readonly { id: string; name: string }[]) => deleteWithUndo(chosen, tr.selection.nouns.collection, deleteLists, restoreList);

  const create = () => createNamedList("wish");

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
            <EmptyState
              icon={Gift}
              title={tr.wishes.emptyTitle}
              hint={tr.wishes.emptyHint}
              action={<Button label={tr.wishes.create} icon={Plus} onPress={create} />}
              skeleton={listCard.tile}
            />
          ) : (
            <View style={{ gap: density.list.rowGap }}>
              {collections.data.map((collection) => (
                <OwnedCard
                  key={collection.id}
                  item={collection}
                  selection={selection}
                  deleteLabel={tr.wishes.delete(collection.name)}
                  onDelete={() => void removeCollections([collection])}
                  open={() => router.push({ pathname: "/collection/[id]", params: { id: collection.id } })}
                  tileId={collection.id}
                  look={collection}
                  title={collection.name}
                  detail={tr.wishes.summary(collection.open, collection.openTotalMinor)}
                  hint={tr.wishes.openHint}
                />
              ))}
            </View>
          )}
        </ArrivalScope>
      ) : null}
    </Screen>
  );
}
