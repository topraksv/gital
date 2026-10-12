/** The chips under an add field (SPEC 2.4, 2.13). They offer and never take: the field keeps its text and focus until a chip is pressed (`docs/UI.md` section 5). */

import { ScrollView } from "react-native";
import Plus from "lucide-react-native/icons/plus";

import { useKnownProducts, useKnownWishes } from "../data/hooks";
import { withCatalogue } from "../domain/catalogue";
import { pickEntries, suggestProducts, typedProduct, type Entry, type KnownProduct } from "../domain/items";
import { tr } from "../i18n/tr";
import { IconButton, SlideUp } from "./components";
import { motion, spacing } from "./theme";

interface Props {
  text: string;
  /** What the screen already holds; without a quantity typed, a chip for it would do nothing. */
  listed: readonly { name: string }[];
  onPick: (entries: Entry[]) => void;
}

// Each mounted only while the field holds text, so the store is watched only then.
export function ProductSuggestions(props: Props) {
  return <Strip {...props} known={withCatalogue(useKnownProducts().data)} />;
}

export function WishSuggestions(props: Props) {
  return <Strip {...props} known={useKnownWishes().data} />;
}

function Strip({ text, listed, onPick, known }: Props & { known: readonly KnownProduct[] }) {
  const typed = typedProduct(text);
  if (!typed) return null;
  const picks = suggestProducts(known, typed, listed);
  if (picks.length === 0) return null;
  return (
    <SlideUp distance={motion.travel.rise}>
      <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {picks.map((product) => (
          <IconButton
            key={product.key}
            icon={Plus}
            text={product.name}
            label={tr.items.suggestion(product.name)}
            tone="primary"
            onPress={() => onPick(pickEntries(typed, product.name))}
          />
        ))}
      </ScrollView>
    </SlideUp>
  );
}
