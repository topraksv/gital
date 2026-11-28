/**
 * The web build reads no shop: the browser refuses another site's HTML (CORS) and the shops' bot walls refuse
 * a server (`./price-search.native.tsx`). On a computer with gital uygun fiyat, the search is handed to it
 * (SPEC 7.9): the extension lets this site alone message it, answers a ping, and opens its panel on the
 * search. Without it the card is not drawn. No price is watched here.
 */

import { useEffect, useState } from "react";
import { View } from "react-native";
import Search from "lucide-react-native/icons/search";

import { tr } from "../i18n/tr";
import { Body, Button, cardEdge } from "./components";
import { spacing, useTheme } from "./theme";

export interface PriceSearchProps {
  wishId: string;
  name: string;
  links: readonly { url: string; priceMinor: number | null }[];
  onAdd: (url: string, priceMinor: number) => void;
}

/** gital uygun fiyat's id, fixed by its manifest key. */
const EXTENSION_ID = "omeiecobbfmndoohennlnkckflgladbm";

type Runtime = { sendMessage: (id: string, message: object, answer: (reply: unknown) => void) => void; lastError?: unknown };
const runtime = (): Runtime | undefined => (globalThis as { chrome?: { runtime?: Runtime } }).chrome?.runtime;

/** Whether the extension answers; asked once a load, as installing it reloads nothing here. */
let present: Promise<boolean> | null = null;
function extensionPresent(): Promise<boolean> {
  present ??= new Promise((done) => {
    const chrome = runtime();
    if (!chrome?.sendMessage) return done(false);
    try {
      chrome.sendMessage(EXTENSION_ID, { type: "gital-ping" }, (reply) => done(!chrome.lastError && (reply as { ok?: unknown } | undefined)?.ok === true));
    } catch {
      done(false);
    }
  });
  return present;
}

export function PriceReaderHost() {
  return null;
}

export function PriceWatcher() {
  return null;
}

export function PriceSearch({ name, links }: PriceSearchProps) {
  const { palette } = useTheme();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    void extensionPresent().then(setShown);
  }, []);
  if (!shown) return null;
  const priced = links.map((link) => link.priceMinor).filter((price): price is number => price != null);
  const search = () =>
    runtime()?.sendMessage(EXTENSION_ID, { type: "gital-search", title: name.trim(), pageUrl: links[0]?.url, price: priced.length ? Math.min(...priced) / 100 : undefined }, () => {});
  return (
    <View style={{ ...cardEdge(palette), gap: spacing.sm, marginTop: spacing.lg }}>
      <Button label={tr.wishes.searchStores} icon={Search} variant="secondary" disabled={name.trim() === ""} onPress={search} />
      <Body muted>{tr.wishes.searchStoresHint}</Body>
    </View>
  );
}
