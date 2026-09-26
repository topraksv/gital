import { useRef, useState } from "react";
import { Animated, Easing, Platform, Text, View } from "react-native";
import ListPlus from "lucide-react-native/icons/list-plus";
import Minus from "lucide-react-native/icons/minus";
import Refrigerator from "lucide-react-native/icons/refrigerator";

import { useMovedAisles, usePantry } from "../../data/hooks";
import { finishPantryItem, setExpiry, setStock, takeSome, undoFinish, type Finished, type PantryItem } from "../../data/pantry";
import { listSections } from "../../domain/catalogue";
import { todayISO } from "../../domain/dates";
import { expiryOf } from "../../domain/pantry";
import { tr } from "../../i18n/tr";
import { useModalAccessibility } from "../../ui/accessibility";
import { QuantityFace, useCalculator } from "../../ui/calculator";
import { DateField } from "../../ui/calendar";
import { ArrivalScope, Body, Button, EmptyState, IconButton, ItemLabel, ReadFailed, Screen, SectionHeader, SlideUp, cardEdge, itemDetail, RowOpen } from "../../ui/components";
import { Actions, DialogShell, appError } from "../../ui/dialog";
import { mediumImpact, selectionTap } from "../../ui/haptics";
import { isReducedMotion } from "../../ui/motion";
import { flightTo, landTab, tabCentre } from "../../ui/tab-landing";
import { showUndo } from "../../ui/undo";
import { density, motion, spacing, type, useTheme } from "../../ui/theme";

/** The Listeler tab's route, where a finished product goes back onto its list. */
const LISTS_TAB = "index";

/** What is at home (SPEC 12.2, 12.8), by aisle as a list is. */
export default function Pantry() {
  const pantry = usePantry();
  const moved = useMovedAisles();

  /** Whether the product finished, so a row that flew for it knows to come back. */
  const act = async (item: PantryItem, action: (id: string) => Promise<Finished | null>) => {
    try {
      const finished = await action(item.id);
      if (!finished) {
        selectionTap();
        return false;
      }
      mediumImpact();
      landTab(LISTS_TAB);
      showUndo(tr.pantry.finished(item.name, finished.listName), () => undoFinish(finished.written));
      return true;
    } catch {
      void appError(tr.errors.saveFailed);
      return false;
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
              {listSections(pantry.data, moved).map((section, at) => (
                <View key={section.key} style={{ gap: density.list.rowGap }}>
                  {section.aisle ? <SectionHeader flush={at === 0}>{tr.catalogue.aisles[section.aisle]}</SectionHeader> : null}
                  {section.items.map((item) => (
                    <SlideUp key={item.id} distance={motion.travel.bar}>
                      <PantryRow
                        item={item}
                        onLess={() => void act(item, takeSome)}
                        onCount={(quantityMilli) => void act(item, (id) => setStock(id, quantityMilli))}
                        onFinish={() => act(item, finishPantryItem)}
                      />
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
 * text open its panel, and − and the finish sit at the trailing edge. The
 * finish flies the row to the Listeler tab before it writes, and the tab
 * bounces as it lands (section 7); − reaching nothing only bounces the tab,
 * since the row cannot know beforehand that it will finish.
 */
function PantryRow({
  item,
  onLess,
  onCount,
  onFinish,
}: {
  item: PantryItem;
  onLess: () => void;
  onCount: (quantityMilli: number) => void;
  onFinish: () => Promise<boolean>;
}) {
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);
  const rowRef = useRef<View>(null);
  const [flight] = useState(() => new Animated.Value(0));
  const [path, setPath] = useState({ dx: 0, dy: 0 });
  // A second tap mid-flight would finish a product already finished, and its
  // "nothing to finish" would bring the leaving row back for a frame.
  const flying = useRef(false);
  const finish = () => {
    const target = tabCentre(LISTS_TAB);
    if (target == null || isReducedMotion() || !rowRef.current) return void onFinish();
    if (flying.current) return;
    flying.current = true;
    rowRef.current.measureInWindow((x, y, width, height) => {
      setPath(flightTo({ x, y, width, height }, target));
      Animated.timing(flight, { toValue: 1, duration: motion.standard, easing: Easing.in(Easing.cubic), useNativeDriver: Platform.OS !== "web" }).start(
        // The row leaves with the re-read; one that did not finish comes back.
        () =>
          void onFinish().then((gone) => {
            if (gone) return;
            flying.current = false;
            flight.setValue(0);
          }),
      );
    });
  };
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
    <Animated.View
      ref={rowRef}
      style={{
        ...cardEdge(palette),
        padding: 0,
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: palette.surface,
        overflow: "hidden",
        opacity: flight.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        transform: [
          { translateX: Animated.multiply(flight, path.dx) },
          { translateY: Animated.multiply(flight, path.dy) },
          { scale: flight.interpolate({ inputRange: [0, 1], outputRange: [1, motion.landing.shrink] }) },
        ],
      }}
    >
      <RowOpen label={tr.common.withDetail(item.name, itemDetail(shown))} hint={tr.pantry.openHint} onPress={() => setOpen(true)}>
        <ItemLabel item={shown} />
      </RowOpen>
      <View style={{ flexDirection: "row", paddingRight: spacing.sm }}>
        <IconButton icon={Minus} label={tr.pantry.less(item.name)} onPress={onLess} />
        <IconButton icon={ListPlus} label={tr.pantry.finish(item.name)} tone="primary" onPress={finish} />
      </View>
      {open ? <PantrySheet item={item} onCount={onCount} onClose={() => setOpen(false)} /> : null}
    </Animated.View>
  );
}

/**
 * A product's panel: how much is at home, counted on the calculator (12.8),
 * and the date printed on it, picked on the calendar or taken off (12.3).
 */
function PantrySheet({ item, onCount, onClose }: { item: PantryItem; onCount: (quantityMilli: number) => void; onClose: () => void }) {
  const { palette } = useTheme();
  const titleRef = useModalAccessibility(true, item.id);
  const [expiresOn, setExpiresOn] = useState(item.expiresOn);
  const [quantityMilli, setQuantityMilli] = useState(item.quantityMilli);
  const [calculate, calculator] = useCalculator(item.unit, setQuantityMilli);
  const save = async () => {
    onClose();
    // Counted to nothing, it is finished, and a date on it would be the stay's.
    if (quantityMilli !== item.quantityMilli) onCount(quantityMilli);
    if (expiresOn === item.expiresOn || quantityMilli === 0) return;
    try {
      await setExpiry(item.id, expiresOn);
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };
  return (
    <DialogShell title={item.name} titleRef={titleRef} onDismiss={onClose}>
      <View style={{ marginTop: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Text style={[type.body, { color: palette.text, flex: 1 }]}>{tr.items.quantity}</Text>
        <QuantityFace quantity={{ quantityMilli, unit: item.unit }} onPress={calculate} />
      </View>
      {calculator}
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
