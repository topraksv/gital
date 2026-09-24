import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import DatabaseZap from "lucide-react-native/icons/database-zap";
import Plus from "lucide-react-native/icons/plus";
import ShoppingBasket from "lucide-react-native/icons/shopping-basket";

import { useLists } from "../../data/hooks";
import { createList, type ListSummary } from "../../data/lists";
import { NAME_MAX } from "../../domain/names";
import { tr } from "../../i18n/tr";
import { ArrivalScope, Button, EmptyState, IconButton, LetterTile, Screen, SlideUp, cardEdge } from "../../ui/components";
import { appError, appPrompt } from "../../ui/dialog";
import { selectionTap } from "../../ui/haptics";
import { interactionSurface } from "../../ui/interaction";
import {
  density,
  font,
  iconSize,
  iconStroke,
  listCard,
  motion,
  offset,
  pressDepth,
  spacing,
  type,
  useTheme,
} from "../../ui/theme";

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
      actions={answered ? <IconButton icon={Plus} label={tr.lists.create} tone="primary" onPress={create} /> : null}
    >
      {lists.status === "error" ? (
        <EmptyState
          icon={DatabaseZap}
          title={tr.errors.readFailedTitle}
          hint={tr.errors.readFailedHint}
          action={<Button label={tr.common.retry} onPress={lists.retry} />}
        />
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
                  <ListCard list={list} onOpen={() => router.push({ pathname: "/list/[id]", params: { id: list.id } })} />
                </SlideUp>
              ))}
            </View>
          )}
        </ArrivalScope>
      ) : null}
    </Screen>
  );
}

function ListCard({ list, onOpen }: { list: ListSummary; onOpen: () => void }) {
  const { palette } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr.lists.open(list.name, tr.lists.summary(list.total, list.inBasket))}
      accessibilityHint={tr.lists.openHint}
      onPress={onOpen}
      style={(state) => ({
        ...cardEdge(palette),
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        ...interactionSurface(palette, state, { base: palette.surface }),
        transform: [{ translateY: state.pressed ? pressDepth : 0 }],
      })}
    >
      <LetterTile id={list.id} name={list.name} size={listCard.tile} />
      <View style={{ flex: 1, minWidth: 0, gap: offset.tight }}>
        <Text style={[type.body, { color: palette.textStrong, fontFamily: font.semibold }]}>{list.name}</Text>
        <Text style={[type.small, { color: palette.textSecondary }]}>{tr.lists.summary(list.total, list.inBasket)}</Text>
      </View>
      <ChevronRight accessible={false} size={iconSize.control} color={palette.textSecondary} strokeWidth={iconStroke.regular} />
    </Pressable>
  );
}
