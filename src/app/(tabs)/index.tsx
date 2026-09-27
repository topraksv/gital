import { View } from "react-native";
import { useRouter } from "expo-router";
import Plus from "lucide-react-native/icons/plus";
import UserPlus from "lucide-react-native/icons/user-plus";
import ShoppingBasket from "lucide-react-native/icons/shopping-basket";

import { useSession } from "../../auth/session";
import { useFresh, useLists } from "../../data/hooks";
import { createList } from "../../data/lists";
import { NAME_MAX } from "../../domain/names";
import { tr } from "../../i18n/tr";
import { useShoppers } from "../../sync/live";
import { ProgressRing } from "../../ui/charts";
import { ArrivalScope, Button, EmptyState, IconButton, LinkCard, ReadFailed, Screen, SlideUp } from "../../ui/components";
import { appError, appPrompt } from "../../ui/dialog";
import { selectionTap } from "../../ui/haptics";
import { FirstRunTour } from "../../ui/tour";
import { density, motion } from "../../ui/theme";

export default function Lists() {
  const lists = useLists();
  const router = useRouter();
  const fresh = new Map(useFresh(useSession((s) => s.userId) ?? "").data.map((row) => [row.listId, row.count]));
  const shoppers = useShoppers((s) => s.byList);
  const detail = (list: { id: string; total: number; inBasket: number }) => {
    const here = shoppers[list.id]?.length ?? 0;
    const summary = tr.lists.summary(list.total, list.inBasket);
    return here ? `${tr.sharing.shoppingCount(here)} · ${summary}` : summary;
  };

  const create = async () => {
    const name = await appPrompt(tr.lists.createTitle, tr.lists.createMessage, {
      examples: tr.placeholders.listName,
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
      actions={
        answered ? (
          <>
            <IconButton icon={UserPlus} label={tr.sharing.join} onPress={() => router.push("/invite")} />
            <IconButton icon={Plus} label={tr.lists.create} tone="primary" onPress={create} />
          </>
        ) : null
      }
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
                    detail={detail(list)}
                    badge={fresh.has(list.id) ? tr.sharing.freshCount(fresh.get(list.id)!) : null}
                    accessory={list.total > 0 ? <ProgressRing value={list.inBasket / list.total} /> : null}
                    hint={tr.lists.openHint}
                    onOpen={() => router.push({ pathname: "/list/[id]", params: { id: list.id } })}
                  />
                </SlideUp>
              ))}
            </View>
          )}
        </ArrivalScope>
      ) : null}
      <FirstRunTour />
    </Screen>
  );
}
