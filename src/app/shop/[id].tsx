import { useState } from "react";
import { AccessibilityInfo, Text, View } from "react-native";
import { Redirect, useLocalSearchParams } from "expo-router";
import Plus from "lucide-react-native/icons/plus";

import { useShopItems, useShops } from "../../data/hooks";
import { addEntries, type Item } from "../../data/items";
import { setShopReceipt, setShopTotal, type Shop } from "../../data/shops";
import { formatMinorInput, readPrice } from "../../domain/money";
import { tr } from "../../i18n/tr";
import { ArrivalScope, CheckMark, IconButton, ItemLabel, ReadFailed, Screen, SlideUp, cardEdge } from "../../ui/components";
import { PriceField } from "../../ui/calculator";
import { PhotoField } from "../../ui/photo-field";
import { appError } from "../../ui/dialog";
import { selectionTap } from "../../ui/haptics";
import { useShare } from "../../ui/members-sheet";
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
  // A viewer reads the shop; the server would refuse anything it changed.
  const { viewer } = useShare(shop?.listId ?? "");

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
            {tr.common.joined(tr.history.summary(shop.finishedAt, shop.bought), tr.history.spent(shop.spentMinor))}
          </Text>
          <View style={{ gap: density.list.rowGap }}>
            {items.data.map((item) => (
              <SlideUp key={item.id} distance={motion.travel.bar}>
                <BoughtRow item={item} added={added.has(item.id)} onAddBack={viewer ? null : () => addBack(shop.listId, item)} />
              </SlideUp>
            ))}
          </View>
          <ReceiptCard shop={shop} viewer={viewer} />
        </ArrivalScope>
      ) : null}
    </Screen>
  );
}

/**
 * The receipt (SPEC 3.8): its photo and, with it, the total it shows. The
 * photo is written as it is chosen, a receipt having no panel whose save could
 * wait for it. Reading the total off a new photo would be done here, once the
 * photo has been set; nothing is read yet.
 */
function ReceiptCard({ shop, viewer }: { shop: Shop; viewer: boolean }) {
  const { palette } = useTheme();
  return (
    <View style={{ ...cardEdge(palette), marginTop: spacing.lg, backgroundColor: palette.surface }}>
      <PhotoField
        title={tr.history.receipt}
        name={tr.history.receiptOf(shop.listName)}
        enlargeLabel={tr.history.enlargeReceipt}
        photoId={shop.receiptId}
        thumb={shop.receipt}
        value={undefined}
        readOnly={viewer}
        onChange={(change) => {
          if (change !== undefined) setShopReceipt(shop.id, change).catch(() => appError(tr.errors.saveFailed));
        }}
      />
      {viewer ? (
        shop.spentMinor == null ? null : (
          <Text style={[type.small, { color: palette.textSecondary, marginTop: spacing.md }]}>
            {tr.common.joined(tr.history.total, tr.history.spent(shop.spentMinor))}
          </Text>
        )
      ) : (
        // Keyed on what is stored, so a total that arrives from sync shows.
        <ReceiptTotal key={shop.totalMinor ?? "none"} shop={shop} />
      )}
    </View>
  );
}

/**
 * The receipt's total over the sum of the prices, written when the field is
 * left, or the calculator's result lands; cleared, the sum comes back and
 * shows as the placeholder. A total equal to the sum is no correction, so it
 * is stored as none.
 */
function ReceiptTotal({ shop }: { shop: Shop }) {
  const { palette } = useTheme();
  const [total, setTotal] = useState(formatMinorInput(shop.totalMinor));
  const commit = async (text: string) => {
    const typed = readPrice(text);
    if (!typed.ok) return setTotal(formatMinorInput(shop.totalMinor));
    const next = typed.minor === shop.summedMinor ? null : typed.minor;
    if (next === shop.totalMinor) return;
    try {
      await setShopTotal(shop.id, next);
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };
  return (
    <View style={{ marginTop: spacing.md }}>
      <PriceField
        value={total}
        onChangeText={setTotal}
        onResult={(text) => void commit(text)}
        label={tr.history.total}
        named
        accessibilityHint={tr.history.totalHint}
        {...(shop.summedMinor == null ? { examples: tr.placeholders.shopTotal } : { placeholder: formatMinorInput(shop.summedMinor) })}
        returnKeyType="done"
        // "Done" lets go of the field, so the blur is the one commit; a submit too wrote it twice.
        onBlur={() => void commit(total)}
      />
      <Text style={[type.small, { color: palette.textSecondary, marginTop: spacing.xs }]}>{tr.history.totalHint}</Text>
    </View>
  );
}

/** `onAddBack` is `null` for a viewer, who is offered nothing to press. */
function BoughtRow({ item, added, onAddBack }: { item: Item; added: boolean; onAddBack: (() => void) | null }) {
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
      ) : onAddBack ? (
        <IconButton icon={Plus} label={tr.history.addBack(item.name)} tone="primary" onPress={onAddBack} />
      ) : null}
    </View>
  );
}
