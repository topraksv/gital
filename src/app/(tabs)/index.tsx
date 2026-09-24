import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import DatabaseZap from "lucide-react-native/icons/database-zap";
import Plus from "lucide-react-native/icons/plus";
import ShoppingBasket from "lucide-react-native/icons/shopping-basket";

import { useLists } from "../../data/hooks";
import { createList, type ListSummary } from "../../data/lists";
import { LIST_NAME_MAX, listInitial, listTone } from "../../domain/lists";
import { tr } from "../../i18n/tr";
import { Button, EmptyState, IconButton, Screen, SlideUp, cardEdge } from "../../ui/components";
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
  pressDepth,
  spacing,
  tileRadius,
  type,
  useTheme,
} from "../../ui/theme";

export default function Lists() {
  const lists = useLists();
  const router = useRouter();
  // Only the list just made slides in: a screen arriving never animates as a whole.
  const [arrived, setArrived] = useState<string | null>(null);

  const create = async () => {
    const name = await appPrompt(tr.lists.createTitle, tr.lists.createMessage, {
      placeholder: tr.lists.namePlaceholder,
      confirmLabel: tr.lists.createConfirm,
      maxLength: LIST_NAME_MAX,
    });
    if (name == null) return;
    try {
      const id = await createList(name);
      selectionTap();
      setArrived(id);
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
      ) : !answered ? null : lists.data.length === 0 ? (
        <EmptyState
          icon={ShoppingBasket}
          title={tr.lists.emptyTitle}
          hint={tr.lists.emptyHint}
          action={<Button label={tr.lists.create} icon={Plus} onPress={create} />}
        />
      ) : (
        <View style={{ gap: density.list.rowGap }}>
          {lists.data.map((list) => (
            <ListCard
              key={list.id}
              list={list}
              arrived={list.id === arrived}
              onOpen={() => router.push({ pathname: "/list/[id]", params: { id: list.id } })}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

function ListCard({ list, arrived, onOpen }: { list: ListSummary; arrived: boolean; onOpen: () => void }) {
  const { palette } = useTheme();
  const tones = [
    { fill: palette.primarySoft, ink: palette.accentText },
    { fill: palette.secondarySoft, ink: palette.secondaryText },
    { fill: palette.tertiarySoft, ink: palette.tertiaryText },
  ];
  const tone = tones[listTone(list.id, tones.length)]!;
  const card = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr.lists.open(list.name)}
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
      <View
        accessible={false}
        style={{
          width: listCard.tile,
          height: listCard.tile,
          borderRadius: tileRadius(listCard.tile),
          borderCurve: "continuous",
          backgroundColor: tone.fill,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={[type.heading, { color: tone.ink }]}>{listInitial(list.name)}</Text>
      </View>
      <Text style={[type.body, { color: palette.textStrong, fontFamily: font.semibold, flex: 1, minWidth: 0 }]}>{list.name}</Text>
      <ChevronRight accessible={false} size={iconSize.control} color={palette.textSecondary} strokeWidth={iconStroke.regular} />
    </Pressable>
  );
  return arrived ? <SlideUp distance={motion.travel.bar}>{card}</SlideUp> : card;
}
