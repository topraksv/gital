import { View } from "react-native";
import ListPlus from "lucide-react-native/icons/list-plus";
import Minus from "lucide-react-native/icons/minus";
import Refrigerator from "lucide-react-native/icons/refrigerator";

import { usePantry } from "../../data/hooks";
import { finishPantryItem, takeSome, undoFinish, type Finished, type PantryItem } from "../../data/pantry";
import { listSections } from "../../domain/catalogue";
import { tr } from "../../i18n/tr";
import { ArrivalScope, EmptyState, IconButton, ItemLabel, ReadFailed, Screen, SectionHeader, SlideUp, cardEdge } from "../../ui/components";
import { appError } from "../../ui/dialog";
import { mediumImpact, selectionTap } from "../../ui/haptics";
import { showUndo } from "../../ui/undo";
import { density, motion, spacing, useTheme } from "../../ui/theme";

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

function PantryRow({ item, onLess, onFinish }: { item: PantryItem; onLess: () => void; onFinish: () => void }) {
  const { palette } = useTheme();
  const shown = { ...item, note: null, urgent: false, notFound: false, boughtInstead: null, priceMinor: null, checkedAt: null };
  return (
    <View style={{ ...cardEdge(palette), flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.surface }}>
      <ItemLabel item={shown} />
      <IconButton icon={Minus} label={tr.pantry.less(item.name)} onPress={onLess} />
      <IconButton icon={ListPlus} label={tr.pantry.finish(item.name)} tone="primary" onPress={onFinish} />
    </View>
  );
}
