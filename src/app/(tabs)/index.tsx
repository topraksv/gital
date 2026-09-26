import { View } from "react-native";
import { useRouter } from "expo-router";
import Plus from "lucide-react-native/icons/plus";
import ShoppingBasket from "lucide-react-native/icons/shopping-basket";

import { useLists } from "../../data/hooks";
import { createList } from "../../data/lists";
import { NAME_MAX } from "../../domain/names";
import { tr } from "../../i18n/tr";
import { ArrivalScope, Button, EmptyState, IconButton, LinkCard, ReadFailed, Screen, SlideUp } from "../../ui/components";
import { appError, appPrompt } from "../../ui/dialog";
import { selectionTap } from "../../ui/haptics";
import { density, motion } from "../../ui/theme";

export default function Lists() {
  const lists = useLists();
  const router = useRouter();

  const create = async () => {
    const name = await appPrompt(tr.lists.createTitle, tr.lists.createMessage, {
      placeholder: tr.lists.namePlaceholder,
      confirmLabel: tr.lists.createConfirm,
      maxLength: NAME_MAX,
    });
    if (name == null) return;
    try {
      await createList(name);
      selectionTap();
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };

  // Nothing is drawn until the query has answered once: "no lists" from a
  // query that has not run would be a lie for a frame.
  const answered = lists.updatedAt != null;
  return (
    <Screen
      title={tr.tabs.lists}
      width="workspace"
      actions={answered ? <IconButton icon={Plus} label={tr.lists.create} tone="primary" onPress={create} /> : null}
    >
      {lists.status === "error" ? (
        <ReadFailed queries={[lists]} />
      ) : answered ? (
        <ArrivalScope>
          {lists.data.length === 0 ? (
            <EmptyState
              icon={ShoppingBasket}
              title={tr.lists.emptyTitle}
              hint={tr.lists.emptyHint}
              action={<Button label={tr.lists.create} icon={Plus} onPress={create} />}
            />
          ) : (
            <View style={{ gap: density.list.rowGap }}>
              {lists.data.map((list) => (
                <SlideUp key={list.id} distance={motion.travel.bar}>
                  <LinkCard
                    tileId={list.id}
                    look={list}
                    title={list.name}
                    detail={tr.lists.summary(list.total, list.inBasket)}
                    hint={tr.lists.openHint}
                    onOpen={() => router.push({ pathname: "/list/[id]", params: { id: list.id } })}
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
