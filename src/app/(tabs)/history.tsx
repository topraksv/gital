import { View } from "react-native";
import { useRouter } from "expo-router";
import ReceiptTurkishLira from "lucide-react-native/icons/receipt-turkish-lira";

import { useShops } from "../../data/hooks";
import { spentByMonth } from "../../domain/money";
import { tr } from "../../i18n/tr";
import { MONTHS, MonthBars } from "../../ui/charts";
import { ArrivalScope, Card, EmptyState, LinkCard, ReadFailed, Screen, SectionHeader, SlideUp } from "../../ui/components";
import { density, motion } from "../../ui/theme";

export default function History() {
  const shops = useShops();
  const router = useRouter();
  const months = spentByMonth(shops.data, new Date(), MONTHS);

  return (
    <Screen title={tr.tabs.history} width="workspace">
      {shops.status === "error" ? (
        <ReadFailed queries={[shops]} />
      ) : shops.updatedAt != null ? (
        <ArrivalScope>
          {shops.data.length === 0 ? (
            <EmptyState icon={ReceiptTurkishLira} title={tr.history.emptyTitle} hint={tr.history.emptyHint} />
          ) : (
            <View style={{ gap: density.list.rowGap }}>
              {months.some((month) => month.spentMinor != null) ? (
                <Card>
                  <SectionHeader flush>{tr.history.months}</SectionHeader>
                  <MonthBars months={months} />
                </Card>
              ) : null}
              {shops.data.map((shop) => (
                <SlideUp key={shop.id} distance={motion.travel.bar}>
                  <LinkCard
                    tileId={shop.listId}
                    look={shop}
                    title={shop.listName}
                    detail={tr.history.summary(shop.finishedAt, shop.bought)}
                    figure={tr.history.spent(shop.spentMinor)}
                    hint={tr.history.openHint}
                    onOpen={() => router.push({ pathname: "/shop/[id]", params: { id: shop.id } })}
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
