import { View } from "react-native";
import { useRouter } from "expo-router";
import ReceiptTurkishLira from "lucide-react-native/icons/receipt-turkish-lira";

import { useShops } from "../../data/hooks";
import { tr } from "../../i18n/tr";
import { ArrivalScope, EmptyState, LinkCard, ReadFailed, Screen, SlideUp } from "../../ui/components";
import { density, motion } from "../../ui/theme";

export default function History() {
  const shops = useShops();
  const router = useRouter();

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
              {shops.data.map((shop) => (
                <SlideUp key={shop.id} distance={motion.travel.bar}>
                  <LinkCard
                    tileId={shop.listId}
                    look={shop}
                    title={shop.listName}
                    detail={tr.history.summary(shop.finishedAt, shop.bought)}
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
