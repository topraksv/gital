/**
 * The wish panel (SPEC 7.1, 7.3, 7.6): a wish's name and note, how much it is
 * wanted, a guess at its price, and the shops that sell it, each with its
 * price there — the cheapest is marked, as the row leads with it. The prompt's
 * sheet with more in it, as the item panel is.
 */

import { useState } from "react";
import { Linking, Text, View } from "react-native";
import ExternalLink from "lucide-react-native/icons/external-link";
import Plus from "lucide-react-native/icons/plus";
import Trash from "lucide-react-native/icons/trash";
import X from "lucide-react-native/icons/x";

import type { WishChange } from "../data/wishes";
import { NOTE_MAX } from "../domain/items";
import { formatMinorInput, readPrice } from "../domain/money";
import { NAME_MAX } from "../domain/names";
import { LINK_MAX, PRIORITIES, leadOf, linkFrom, shopOf, type Priority, type Wish } from "../domain/wishes";
import { tr } from "../i18n/tr";
import { useModalAccessibility } from "./accessibility";
import { PriceField } from "./calculator";
import { Body, Button, ChoiceTile, IconButton, TextField, cardEdge } from "./components";
import { Actions, DialogShell } from "./dialog";
import { selectionTap } from "./haptics";
import { controlSize, font, spacing, type, useTheme } from "./theme";
import { radioGroupKeys } from "./keys";

type LinkDraft = { key: string; id?: string; url: string; price: string };

// Checked again at the door: with sync, a stored link was written by another
// device, and a `javascript:` one opened on the web would run in this origin.
function openLink(stored: string): void {
  const url = linkFrom(stored);
  if (url) void Linking.openURL(url);
}

export function WishSheet({
  wish,
  onSave,
  onDelete,
  onClose,
}: {
  wish: Wish;
  onSave: (change: WishChange) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { palette } = useTheme();
  const titleRef = useModalAccessibility(true, wish.id);
  const [name, setName] = useState(wish.name);
  const [note, setNote] = useState(wish.note ?? "");
  const [priority, setPriority] = useState<Priority>(wish.priority);
  const [estimate, setEstimate] = useState(formatMinorInput(wish.estimateMinor));
  const [links, setLinks] = useState<LinkDraft[]>(() => wish.links.map((link) => ({ key: link.id, id: link.id, url: link.url, price: formatMinorInput(link.priceMinor) })));
  const [typedLink, setTypedLink] = useState("");
  const [refused, setRefused] = useState(false);

  const estimated = readPrice(estimate);
  const prices = links.map((link) => readPrice(link.price));
  const ready = name.trim() !== "" && estimated.ok && prices.every((price) => price.ok);
  const lead = leadOf(links.map((link, at) => ({ key: link.key, priceMinor: prices[at]!.ok ? prices[at]!.minor : null })));
  const save = () =>
    ready &&
    onSave({
      name,
      note,
      priority,
      estimateMinor: estimated.ok ? estimated.minor : null,
      links: links.map((link, at) => ({ id: link.id, url: link.url, priceMinor: prices[at]!.ok ? prices[at]!.minor : null })),
    });
  const submits = { returnKeyType: "done", onSubmitEditing: save } as const;

  const addLink = () => {
    const url = linkFrom(typedLink);
    if (!url) return setRefused(typedLink.trim() !== "");
    selectionTap();
    setLinks([...links, { key: `new-${links.length}-${url}`, url, price: "" }]);
    setTypedLink("");
    setRefused(false);
  };

  return (
    <DialogShell title={wish.name} titleRef={titleRef} onDismiss={onClose}>
      <TextField value={name} maxLength={NAME_MAX} onChangeText={setName} accessibilityLabel={tr.wishes.nameLabel} {...submits} style={{ marginTop: spacing.lg }} />
      <TextField
        value={note}
        maxLength={NOTE_MAX}
        onChangeText={setNote}
        accessibilityLabel={tr.wishes.noteLabel}
        placeholder={tr.wishes.notePlaceholder}
        {...submits}
        style={{ marginTop: spacing.sm }}
      />
      <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
        <Body>{tr.wishes.priority}</Body>
        <View role="radiogroup" {...radioGroupKeys()} accessibilityLabel={tr.wishes.priority} style={{ flexDirection: "row", gap: spacing.sm }}>
          {PRIORITIES.map((level) => (
            <ChoiceTile
              key={level}
              label={tr.wishes.priorities[level]}
              selected={priority === level}
              minHeight={controlSize.minimumTarget}
              onPress={() => setPriority(level)}
            />
          ))}
        </View>
      </View>
      <PriceField
        value={estimate}
        onChangeText={setEstimate}
        label={tr.wishes.estimateLabel}
        placeholder={tr.wishes.estimatePlaceholder}
        {...submits}
        style={{ marginTop: spacing.lg }}
      />
      <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
        <Body>{tr.wishes.links}</Body>
        {links.map((link, at) => {
          const shop = shopOf(link.url);
          return (
            <View key={link.key} style={{ ...cardEdge(palette), gap: spacing.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.body, { color: palette.textStrong, fontFamily: font.medium }]}>{shop}</Text>
                  <Text numberOfLines={1} style={[type.small, { color: palette.textSecondary }]}>
                    {links.length > 1 && lead?.key === link.key && lead.priceMinor != null ? tr.common.joined(tr.wishes.cheapest, link.url) : link.url}
                  </Text>
                </View>
                <IconButton icon={ExternalLink} label={tr.wishes.linkOpen(shop)} onPress={() => openLink(link.url)} />
                <IconButton icon={X} label={tr.wishes.linkRemove(shop)} onPress={() => setLinks(links.filter((other) => other.key !== link.key))} />
              </View>
              <PriceField
                value={link.price}
                onChangeText={(price) => setLinks(links.map((other, index) => (index === at ? { ...other, price } : other)))}
                label={tr.wishes.linkPrice(shop)}
                placeholder={tr.wishes.linkPrice(shop)}
                {...submits}
              />
            </View>
          );
        })}
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <TextField
            value={typedLink}
            onChangeText={(typed) => {
              setTypedLink(typed);
              setRefused(false);
            }}
            onSubmitEditing={addLink}
            blurOnSubmit={false}
            autoCapitalize="none"
            keyboardType="url"
            accessibilityLabel={tr.wishes.linkAdd}
            placeholder={tr.wishes.linkPlaceholder}
            maxLength={LINK_MAX}
            style={{ flex: 1 }}
          />
          <IconButton icon={Plus} label={tr.wishes.linkAdd} tone="primary" onPress={addLink} />
        </View>
        {refused ? (
          <Text accessibilityLiveRegion="polite" style={[type.small, { color: palette.errorText }]}>
            {tr.wishes.linkInvalid}
          </Text>
        ) : null}
      </View>
      <Actions>
        <View style={{ flex: 1, alignItems: "flex-start" }}>
          <IconButton icon={Trash} label={tr.wishes.deleteWish(wish.name)} tone="danger" onPress={onDelete} />
        </View>
        <Button label={tr.common.cancel} variant="ghost" size="sm" onPress={onClose} />
        <Button label={tr.common.save} size="sm" disabled={!ready} onPress={save} />
      </Actions>
    </DialogShell>
  );
}
