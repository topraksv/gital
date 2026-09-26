import { useState } from "react";
import { Pressable, View } from "react-native";
import ListPlus from "lucide-react-native/icons/list-plus";
import Minus from "lucide-react-native/icons/minus";
import Refrigerator from "lucide-react-native/icons/refrigerator";

import { usePantry } from "../../data/hooks";
import { finishPantryItem, setExpiry, takeSome, undoFinish, type Finished, type PantryItem } from "../../data/pantry";
import { listSections } from "../../domain/catalogue";
import { todayISO } from "../../domain/dates";
import { expiryOf } from "../../domain/pantry";
import { tr } from "../../i18n/tr";
import { useModalAccessibility } from "../../ui/accessibility";
import { DateField } from "../../ui/calendar";
import { ArrivalScope, Body, Button, EmptyState, IconButton, ItemLabel, ReadFailed, Screen, SectionHeader, SlideUp, cardEdge, itemDetail } from "../../ui/components";
import { Actions, DialogShell, appError } from "../../ui/dialog";
import { mediumImpact, selectionTap } from "../../ui/haptics";
import { showUndo } from "../../ui/undo";
import { interactionSurface } from "../../ui/interaction";
import { density, motion, radius, spacing, useTheme } from "../../ui/theme";

/** What is at home (SPEC 12.2, 12.8), by aisle as a list is. */
export default function Pantry() {
  const pantry = usePantry();

  const act = async (item: PantryItem, action: (id: string) => Promise<Finished | null>) => {
    try {
      const finished = await action(item.id);
      if (!finished) return selectionTap();
      mediumImpact();
      showUndo(tr.pantry.finished(item.name, finished.listName), () => undoFinish(finished.written));
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };

  return (
    <Screen title={tr.tabs.pantry} width="workspace">
      {pantry.status === "error" ? (
        <ReadFailed queries={[pantry]} />
      ) : pantry.updatedAt != null ? (
        <ArrivalScope>
          {pantry.data.length === 0 ? (
            <EmptyState icon={Refrigerator} title={tr.pantry.emptyTitle} hint={tr.pantry.emptyHint} />
          ) : (
            <View style={{ gap: density.list.rowGap }}>
              {listSections(pantry.data).map((section, at) => (
                <View key={section.key} style={{ gap: density.list.rowGap }}>
                  {section.aisle ? <SectionHeader flush={at === 0}>{tr.catalogue.aisles[section.aisle]}</SectionHeader> : null}
                  {section.items.map((item) => (
                    <SlideUp key={item.id} distance={motion.travel.bar}>
                      <PantryRow item={item} onLess={() => act(item, takeSome)} onFinish={() => act(item, finishPantryItem)} />
                    </SlideUp>
                  ))}
                </View>
              ))}
            </View>
          )}
        </ArrivalScope>
      ) : null}
    </Screen>
  );
}

/** The day while it is far; how near, in colour, once it is soon or past (SPEC 12.3). */
function expiryPart(expiresOn: string | null, today: string) {
  if (expiresOn == null) return undefined;
  const { days, soon } = expiryOf(expiresOn, today);
  if (!soon) return { text: tr.pantry.expiresOn(expiresOn) };
  return { text: tr.pantry.expiryLeft(days), tone: days < 0 ? ("errorText" as const) : ("warningText" as const) };
}

/**
 * A pantry row, as an item's is (`docs/UI.md` section 6): the tile and the
 * text open its panel, and − and the finish sit at the trailing edge.
 */
function PantryRow({ item, onLess, onFinish }: { item: PantryItem; onLess: () => void; onFinish: () => void }) {
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);
  const shown = {
    ...item,
    note: null,
    urgent: false,
    notFound: false,
    boughtInstead: null,
    priceMinor: null,
    checkedAt: null,
    extra: expiryPart(item.expiresOn, todayISO()),
  };
  return (
    <View style={{ ...cardEdge(palette), padding: 0, flexDirection: "row", alignItems: "center", backgroundColor: palette.surface, overflow: "hidden" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr.common.withDetail(item.name, itemDetail(shown))}
        accessibilityHint={tr.pantry.openHint}
        onPress={() => setOpen(true)}
        style={(state) => ({
          flex: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
          padding: density.list.cardPadding,
          borderTopLeftRadius: radius.lg,
          borderBottomLeftRadius: radius.lg,
          ...interactionSurface(palette, state),
        })}
      >
        <ItemLabel item={shown} />
      </Pressable>
      <View style={{ flexDirection: "row", paddingRight: spacing.sm }}>
        <IconButton icon={Minus} label={tr.pantry.less(item.name)} onPress={onLess} />
        <IconButton icon={ListPlus} label={tr.pantry.finish(item.name)} tone="primary" onPress={onFinish} />
      </View>
      {open ? <PantrySheet item={item} onClose={() => setOpen(false)} /> : null}
    </View>
  );
}

/** A product's panel: the date printed on it, picked on the calendar or taken off. */
function PantrySheet({ item, onClose }: { item: PantryItem; onClose: () => void }) {
  const titleRef = useModalAccessibility(true, item.id);
  const [expiresOn, setExpiresOn] = useState(item.expiresOn);
  const save = async () => {
    onClose();
    try {
      await setExpiry(item.id, expiresOn);
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };
  return (
    <DialogShell title={item.name} titleRef={titleRef} onDismiss={onClose}>
      <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
        <Body>{tr.pantry.expiry}</Body>
        <DateField label={tr.pantry.expiry} value={expiresOn} onChange={setExpiresOn} />
      </View>
      <Actions>
        {expiresOn != null ? <Button label={tr.pantry.clearExpiry} variant="ghost" size="sm" onPress={() => setExpiresOn(null)} /> : null}
        <Button label={tr.common.cancel} variant="ghost" size="sm" onPress={onClose} />
        <Button label={tr.common.save} size="sm" onPress={save} />
      </Actions>
    </DialogShell>
  );
}
