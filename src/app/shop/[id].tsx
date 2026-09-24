import { useState } from "react";
import { AccessibilityInfo, Text, View } from "react-native";
import { Redirect, useLocalSearchParams } from "expo-router";
import Plus from "lucide-react-native/icons/plus";

import { useShopItems, useShops } from "../../data/hooks";
import { addEntries, type Item } from "../../data/items";
import { tr } from "../../i18n/tr";
import { ArrivalScope, CheckMark, IconButton, ItemLabel, ReadFailed, Screen, SlideUp, cardEdge } from "../../ui/components";
import { appError } from "../../ui/dialog";
import { selectionTap } from "../../ui/haptics";
import { controlSize, density, motion, spacing, type, useTheme } from "../../ui/theme";

/** What one finished shop bought (SPEC 3.5), each item one tap from its list again. */
export default function ShopScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { palette } = useTheme();
  const shops = useShops();
  const items = useShopItems(id);
  // What this visit put back, so each row shows that it landed.
  const [added, setAdded] = useState<ReadonlySet<string>>(() => new Set());
  const shop = shops.data.find((candidate) => candidate.id === id);

  // Undone, or its list deleted, since the link was made.
  if (shops.updatedAt != null && !shop) return <Redirect href="/history" />;

  const addBack = async (listId: string, item: Item) => {
    try {
      await addEntries(listId, [item]);
      selectionTap();
      setAdded((current) => new Set(current).add(item.id));
      // Said aloud: the button that had focus is gone, and a live region
      // mounted with its text is not announced.
      AccessibilityInfo.announceForAccessibility(tr.history.addedBack(item.name));
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };

  return (
    <Screen back="/history" title={shop?.listName} width="workspace">
      {shops.status === "error" || items.status === "error" ? (
        <ReadFailed queries={[shops, items]} />
      ) : shop && items.updatedAt != null ? (
        <ArrivalScope>
          <Text style={[type.small, { color: palette.textSecondary, marginBottom: spacing.md }]}>
            {tr.history.summary(shop.finishedAt, shop.bought)}
          </Text>
          <View style={{ gap: density.list.rowGap }}>
            {items.data.map((item) => (
              <SlideUp key={item.id} distance={motion.travel.bar}>
                <BoughtRow item={item} added={added.has(item.id)} onAddBack={() => addBack(shop.listId, item)} />
              </SlideUp>
            ))}
          </View>
        </ArrivalScope>
      ) : null}
    </Screen>
  );
}

function BoughtRow({ item, added, onAddBack }: { item: Item; added: boolean; onAddBack: () => void }) {
  const { palette } = useTheme();
  return (
    <View style={{ ...cardEdge(palette), flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.surface }}>
      <ItemLabel item={item} />
      {added ? (
        // The control's own box, so the row does not move when the mark replaces it.
        <View
          accessible
          accessibilityLabel={tr.history.addedBack(item.name)}
          style={{ width: controlSize.minimumTarget, height: controlSize.minimumTarget, alignItems: "center", justifyContent: "center" }}
        >
          <CheckMark checked />
        </View>
      ) : (
        <IconButton icon={Plus} label={tr.history.addBack(item.name)} tone="primary" onPress={onAddBack} />
      )}
    </View>
  );
}
