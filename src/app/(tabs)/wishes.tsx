import { View } from "react-native";
import { useRouter } from "expo-router";
import Gift from "lucide-react-native/icons/gift";
import Plus from "lucide-react-native/icons/plus";

import { useCollections } from "../../data/hooks";
import { createList } from "../../data/lists";
import { NAME_MAX } from "../../domain/names";
import { tr } from "../../i18n/tr";
import { ArrivalScope, Button, EmptyState, IconButton, LinkCard, ReadFailed, Screen, SlideUp } from "../../ui/components";
import { appError, appPrompt } from "../../ui/dialog";
import { selectionTap } from "../../ui/haptics";
import { density, motion } from "../../ui/theme";

/** İstekler (SPEC 7): the wish collections, drawn as Listeler draws its lists. */
export default function Wishes() {
  const collections = useCollections();
  const router = useRouter();

  const create = async () => {
    const name = await appPrompt(tr.wishes.createTitle, tr.wishes.createMessage, {
      placeholder: tr.wishes.namePlaceholder,
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
      title={tr.tabs.wishes}
      width="workspace"
      actions={answered ? <IconButton icon={Plus} label={tr.wishes.create} tone="primary" onPress={create} /> : null}
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
            />
          ) : (
            <View style={{ gap: density.list.rowGap }}>
              {collections.data.map((collection) => (
                <SlideUp key={collection.id} distance={motion.travel.bar}>
                  <LinkCard
                    tileId={collection.id}
                    look={collection}
                    title={collection.name}
                    detail={tr.wishes.summary(collection.open, collection.openTotalMinor)}
                    hint={tr.wishes.openHint}
                    onOpen={() => router.push({ pathname: "/collection/[id]", params: { id: collection.id } })}
                  />
                </SlideUp>
              ))}
            </View>
          )}
        </ArrivalScope>
      ) : null}
    </Screen>
  );
}
