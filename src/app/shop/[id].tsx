import { useState } from "react";
import { AccessibilityInfo, Text, View } from "react-native";
import { Redirect, useLocalSearchParams } from "expo-router";
import Plus from "lucide-react-native/icons/plus";
import ReceiptTurkishLira from "lucide-react-native/icons/receipt-turkish-lira";

import { useShopItems, useShops } from "../../data/hooks";
import { addEntries, type Item } from "../../data/items";
import { setShopTotal, type Shop } from "../../data/shops";
import { formatMinorInput, readPrice } from "../../domain/money";
import { tr } from "../../i18n/tr";
import { ArrivalScope, Button, CheckMark, IconButton, ItemLabel, ReadFailed, Screen, SlideUp, cardEdge } from "../../ui/components";
import { PriceField } from "../../ui/calculator";
import { Actions, DialogShell, appError } from "../../ui/dialog";
import { useModalAccessibility } from "../../ui/accessibility";
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
    <Screen back="/history" title={shop?.listName} width="workspace" actions={shop ? <EditTotal shop={shop} /> : null}>
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
                <BoughtRow item={item} added={added.has(item.id)} onAddBack={() => addBack(shop.listId, item)} />
              </SlideUp>
            ))}
          </View>
        </ArrivalScope>
      ) : null}
    </Screen>
  );
}

/**
 * The receipt's total over the sum of the prices (SPEC 3.8), opened on what
 * the card shows; cleared, the sum comes back.
 */
function EditTotal({ shop }: { shop: Shop }) {
  const [open, setOpen] = useState(false);
  const titleRef = useModalAccessibility(open, shop.id);
  const [total, setTotal] = useState("");
  const typed = readPrice(total);
  const start = () => {
    setTotal(formatMinorInput(shop.spentMinor));
    setOpen(true);
  };
  const save = async () => {
    if (!typed.ok) return;
    setOpen(false);
    try {
      await setShopTotal(shop.id, typed.minor);
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };
  return (
    <>
      <IconButton icon={ReceiptTurkishLira} label={tr.history.editTotal} onPress={start} />
      {open ? (
        <DialogShell title={tr.history.total} message={tr.history.totalMessage} titleRef={titleRef} onDismiss={() => setOpen(false)}>
          <PriceField
            value={total}
            onChangeText={setTotal}
            label={tr.history.total}
            placeholder={tr.history.totalPlaceholder}
            returnKeyType="done"
            onSubmitEditing={save}
            style={{ marginTop: spacing.lg }}
          />
          <Actions>
            <Button label={tr.common.cancel} variant="ghost" size="sm" onPress={() => setOpen(false)} />
            <Button label={tr.common.save} size="sm" disabled={!typed.ok} onPress={save} />
          </Actions>
        </DialogShell>
      ) : null}
    </>
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
