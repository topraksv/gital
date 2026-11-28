/**
 * "Diğer Mağazalarda Ara" on a wish (SPEC 7.9): gital-fiyat's engine searches the comparison sites and the
 * stores from the phone, and the "Fiyatlar" sheet offers the same product at other shops as the wish's links.
 * The pages are read in hidden WebViews with the extension's own readers injected (`src/engine/readers.js`),
 * so a shop's bot wall meets a real browser, as a wish's own page does (`./page-reader.native.tsx`). That
 * queue reads one link at a time and is left to it: a search is a dozen pages, and the two would starve each
 * other. Two pages load at once; one that says nothing by `PAGE_MS` is given up.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState, Linking, Platform, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import Check from "lucide-react-native/icons/check";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import ExternalLink from "lucide-react-native/icons/external-link";
import Plus from "lucide-react-native/icons/plus";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import Search from "lucide-react-native/icons/search";

import { readWatchedLinks } from "../data/wishes";
import { formatMinor } from "../domain/money";
import { isWatchDue, pricesRead, readWatchState, WATCH_MOST } from "../domain/price-watch";
import { priceView, searchProgress, type PriceRow, type PriceView } from "../domain/prices";
import { linkFrom } from "../domain/wishes";
import { runSearch, SOURCE_INFO, type PageRead, type SearchPorts, type SearchRequest, type SearchSnapshot } from "../engine/engine";
import { READERS } from "../engine/readers";
import { prices } from "../i18n/prices";
import { tr } from "../i18n/tr";
import { kv } from "../services/kv";
import { notifyPriceDrops, remindersAllowed } from "../services/reminders";
import { useModalAccessibility } from "./accessibility";
import { announce, Body, Button, cardEdge, ChoiceTile, IconButton, ProgressBar, Tile } from "./components";
import { Actions, DialogShell } from "./dialog";
import { interactionSurface } from "./interaction";
import { radioGroupKeys } from "./keys";
import { Press } from "./press";
import { controlSize, font, iconSize, iconStroke, listCard, offset, pageReader, spacing, type, useTheme } from "./theme";

export interface PriceSearchProps {
  wishId: string;
  /** The wish's name as the panel has it now. */
  name: string;
  links: readonly { url: string; priceMinor: number | null }[];
  /** A listing taken as one of the wish's links: it joins the panel's draft and is saved with it. */
  onAdd: (url: string, priceMinor: number) => void;
}

// ---- The pages: two hidden WebViews, a queue in front of them ----

export type Kind = "search" | "sellers" | "product";
type Signal = { aborted: boolean };

interface Job {
  id: number;
  url: string;
  kind: Kind;
  sourceId: string;
  signal: Signal;
  done: (read: PageRead<unknown>) => void;
}

const SLOTS = 2;
const PAGE_MS = 20_000;
/** Seconds the page is read again while it draws its results: a shop may render them after the load. */
const TRIES = 10;
const queue: Job[] = [];
let slots: readonly (Job | null)[] = Array.from({ length: SLOTS }, () => null);
let jobCount = 0;
/** Jobs whose shop answered 403 or 429: a bot wall that did not let the page through. */
const refused = new WeakSet<Job>();
const listeners = new Set<() => void>();

function tell(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Free slots take the next job not given up; `slots` is replaced only when it changes, as the store requires. */
function fill(): void {
  const next = [...slots];
  let changed = false;
  for (let at = 0; at < next.length; at += 1) {
    if (next[at]) continue;
    let job = queue.shift();
    while (job?.signal.aborted) {
      job.done({ ok: false, blocked: false, error: "aborted" });
      job = queue.shift();
    }
    if (!job) break;
    next[at] = job;
    changed = true;
  }
  if (!changed) return;
  slots = next;
  tell();
}

/** A job ends once, by its own identity: a late message from a page given up ends nothing. */
function finish(job: Job, read: PageRead<unknown>): void {
  if (!slots.includes(job)) return;
  slots = slots.map((other) => (other === job ? null : other));
  job.done(read);
  tell();
  fill();
}

/** A search given up lets go of the pages it holds, so the next one does not wait behind them. */
function release(signal: Signal): void {
  for (const job of slots) if (job?.signal === signal) finish(job, { ok: false, blocked: false, error: "aborted" });
}

function load<T>(kind: Kind, sourceId: string, url: string, signal: Signal): Promise<PageRead<T>> {
  return new Promise((done) => {
    queue.push({ id: (jobCount += 1), url, kind, sourceId, signal, done: done as (read: PageRead<unknown>) => void });
    fill();
  });
}

/**
 * The readers, then a look every second until the page shows what was asked or the tries run out; either way
 * it sends what it read, under the job's id. A bot wall's check reloads into the real page, which runs this
 * again. A wish's own page is read with it too (`./page-reader.native.tsx`).
 */
export function readerScript(job: { id: number; kind: Kind; sourceId: string }): string {
  const { kind, sourceId } = job;
  const full = kind === "product" ? "!!value&&value.price!=null" : "!!value&&value.offers.length>0";
  return `${READERS};(function(){var tries=0;(function look(){var value=null;try{value=gitalFiyat.readPage(${JSON.stringify(kind)},${JSON.stringify(sourceId)});}catch(e){}var full=${full};if(full||++tries>=${TRIES})window.ReactNativeWebView.postMessage(JSON.stringify({job:${job.id},value:value,url:location.href}));else setTimeout(look,1000);})();})();true;`;
}

function Reader({ job }: { job: Job }) {
  useEffect(() => {
    const timer = setTimeout(() => finish(job, { ok: false, blocked: refused.has(job), error: refused.has(job) ? "refused" : "timeout" }), PAGE_MS);
    return () => clearTimeout(timer);
  }, [job]);
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: "absolute", width: pageReader.size, height: pageReader.size, opacity: 0 }}>
      <WebView
        source={{ uri: job.url }}
        injectedJavaScript={readerScript(job)}
        onMessage={(event) => {
          // Any frame of the page may post too: only this job's message answers, and only in the shape asked.
          let message: { job?: unknown; value?: unknown; url?: unknown };
          try {
            message = JSON.parse(event.nativeEvent.data) as typeof message;
          } catch {
            return;
          }
          if (message?.job !== job.id || typeof message.url !== "string") return;
          const { value } = message;
          const read = job.kind === "product" ? value === null || typeof value === "object" : Array.isArray((value as { offers?: unknown } | null)?.offers);
          finish(job, read ? { ok: true, value, finalUrl: message.url, via: "webview" } : { ok: false, blocked: refused.has(job), error: "unread" });
        }}
        onHttpError={(event) => {
          if (event.nativeEvent.statusCode === 403 || event.nativeEvent.statusCode === 429) refused.add(job);
        }}
        onError={(event) => finish(job, { ok: false, blocked: false, error: event.nativeEvent.description })}
        // As the wish's reader: only the web is followed and no window opens. Incognito on iOS alone: Android's
        // clears every cookie in the app on each mount, so the other page's bot-wall pass would be gone before
        // its reload; there the wish reader's next page clears them.
        originWhitelist={["*"]}
        onShouldStartLoadWithRequest={(request) => /^(https?:|about:blank$)/i.test(request.url)}
        incognito={Platform.OS === "ios"}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        mediaPlaybackRequiresUserAction
      />
    </View>
  );
}

/** Mounted once while signed in; draws nothing but the pages a search is reading. */
export function PriceReaderHost() {
  const reading = useSyncExternalStore(subscribe, () => slots);
  return <>{reading.map((job) => (job ? <Reader key={job.id} job={job} /> : null))}</>;
}

// ---- The price watch (SPEC 7.5): the wishes' priced links read again while the app is in front ----

const WATCH_KEY = "gital.priceWatch";
let watching = false;

/**
 * Expo Go runs no task in the background on either phone, and a background task mounts no view for a
 * WebView, so the check runs when gital opens or comes to the front, at most every `WATCH_EVERY_MS`.
 * Only while a drop could ring: with reminders off, no page is read for nothing.
 */
async function watchPrices(): Promise<void> {
  if (watching) return;
  watching = true;
  try {
    const before = readWatchState(await kv.get(WATCH_KEY));
    const now = Date.now();
    if (!isWatchDue(before, now) || !(await remindersAllowed())) return;
    // Stamped first: a check cut short by the app leaving waits for the next interval rather than rerunning at once.
    await kv.set(WATCH_KEY, JSON.stringify({ ...before, at: now }));
    const links = (await readWatchedLinks()).slice(-WATCH_MOST);
    const read = new Map<string, number | null>();
    for (const link of links) {
      if (AppState.currentState === "background") return;
      const page = await load<{ price: number | null } | null>("product", "", link.url, { aborted: false });
      read.set(link.id, page.ok && page.value?.price != null ? Math.round(page.value.price * 100) : null);
    }
    const { drops, state } = pricesRead(links, read, before, now);
    await notifyPriceDrops(drops);
    await kv.set(WATCH_KEY, JSON.stringify(state));
  } finally {
    watching = false;
  }
}

/** Mounted once while signed in: a check on opening and on every return to the front. */
export function PriceWatcher() {
  useEffect(() => {
    const watch = () => void watchPrices().catch(() => {});
    watch();
    const subscription = AppState.addEventListener("change", (state) => state === "active" && watch());
    return () => subscription.remove();
  }, []);
  return null;
}

// ---- The searches, one per wish, kept for the launch so a panel opened again shows the last ----

interface WishSearch {
  snapshot: SearchSnapshot | null;
  done: boolean;
  signal: Signal;
}

const searches = new Map<string, WishSearch>();

/** A phone's share of the extension's search: one query a source, three pages checked, two seller lists. */
const SETTINGS = { disabledSources: [], queriesPerSource: 1, verifyTop: 3, expandAggregates: 2 };

function ports(signal: Signal): SearchPorts {
  return {
    sources: SOURCE_INFO,
    readSearch: (source, url) => load("search", source.id, url, signal),
    readSellers: (source, url) => load("sellers", source.id, url, signal),
    readProductPage: (sourceId, url) => load("product", sourceId, url, signal),
    // No canvas to draw a picture on: listings are matched by their words alone (gital-fiyat's ARCHITECTURE).
    fingerprint: async () => null,
    later: (task, ms) => {
      const timer = setTimeout(task, ms);
      return () => clearTimeout(timer);
    },
  };
}

function startSearch(wishId: string, request: SearchRequest): void {
  const before = searches.get(wishId);
  if (before) {
    before.signal.aborted = true;
    release(before.signal);
  }
  const signal: Signal = { aborted: false };
  const update = (change: Partial<WishSearch>) => {
    const now = searches.get(wishId);
    if (now?.signal !== signal) return;
    searches.set(wishId, { ...now, ...change });
    tell();
  };
  searches.set(wishId, { snapshot: null, done: false, signal });
  tell();
  void runSearch(request, SETTINGS, ports(signal), (snapshot) => update(snapshot.phase === "done" ? { snapshot, done: true } : { snapshot }), signal)
    .catch(() => {
      // A search that fails part way keeps what it found; the card offers to search again.
    })
    .finally(() => update({ done: true }));
}

function requestOf(name: string, links: PriceSearchProps["links"]): SearchRequest {
  const priced = links.map((link) => link.priceMinor).filter((price): price is number => price != null);
  return {
    listing: { title: name.trim(), price: priced.length ? Math.min(...priced) / 100 : null },
    pageUrl: links[0]?.url ?? null,
  };
}

// Checked at the door, as the wish's own links are: a listing's address came from a shop's page.
function openLink(stored: string): void {
  const url = linkFrom(stored);
  if (url) void Linking.openURL(url);
}

// ---- The card under the wish's links ----

export function PriceSearch({ wishId, name, links, onAdd }: PriceSearchProps) {
  const { palette } = useTheme();
  const search = useSyncExternalStore(subscribe, () => searches.get(wishId) ?? null);
  const [open, setOpen] = useState(false);
  const view = useMemo(() => priceView(search?.snapshot?.results ?? [], links), [search, links]);
  const progress = searchProgress(search?.snapshot?.sources ?? [], search?.done ?? false);
  const stores = new Set(view.same.map((row) => row.shop)).size;
  const start = () => startSearch(wishId, requestOf(name, links));
  const found = view.same.length + view.similar.length > 0;

  return (
    <View style={{ ...cardEdge(palette), gap: spacing.sm, marginTop: spacing.lg }}>
      {!search ? (
        <>
          <Button label={prices.search} icon={Search} variant="secondary" disabled={name.trim() === ""} onPress={start} />
          <Body muted>{prices.searchHint(SOURCE_INFO.length - 3)}</Body>
        </>
      ) : !search.done ? (
        <View accessibilityLiveRegion="polite" style={{ gap: spacing.sm }}>
          <Text style={[type.body, { color: palette.textStrong, fontFamily: font.medium }]}>{prices.searching}</Text>
          <ProgressBar value={progress.share} />
          <Text style={[type.small, { color: palette.textSecondary }]}>{prices.progress(progress.looked, progress.asked, view.same.length + view.similar.length)}</Text>
        </View>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            {found ? (
              <Button label={prices.show(stores)} onPress={() => setOpen(true)} />
            ) : (
              <Text accessibilityLiveRegion="polite" style={[type.body, { color: palette.textSecondary }]}>
                {prices.none}
              </Text>
            )}
          </View>
          <IconButton icon={RefreshCw} label={prices.again} onPress={start} />
        </View>
      )}
      {open && search?.snapshot ? (
        <PriceSheet
          name={name}
          asked={progress.asked}
          view={view}
          onAdd={(row) => {
            if (!row.take) return;
            onAdd(row.take.url, row.take.priceMinor);
            announce(prices.added(row.shop));
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </View>
  );
}

// ---- The "Fiyatlar" sheet ----

type Tab = "same" | "similar";

function PriceSheet({ name, asked, view, onAdd, onClose }: { name: string; asked: number; view: PriceView; onAdd: (row: PriceRow) => void; onClose: () => void }) {
  const { palette } = useTheme();
  const titleRef = useModalAccessibility(true, "prices");
  const [tab, setTab] = useState<Tab>(view.same.length > 0 ? "same" : "similar");
  const [weakOpen, setWeakOpen] = useState(false);
  const rows = tab === "same" ? view.same : view.similar;
  const cheapest = view.cheapest;

  return (
    <DialogShell title={prices.title} message={prices.looked(name, asked)} titleRef={titleRef} onDismiss={onClose}>
      {cheapest ? (
        <View style={{ ...cardEdge(palette), backgroundColor: palette.primarySoft, gap: offset.tight, marginTop: spacing.lg }}>
          <Text style={[type.label, { color: palette.accentText }]}>{prices.cheapest}</Text>
          <Text style={[type.amount, { color: palette.textStrong }]}>{formatMinor(cheapest.priceMinor)}</Text>
          <Text style={[type.small, { color: palette.textSecondary }]}>{tr.common.joined(cheapest.shop, cheapest.freeShipping ? prices.freeShipping : undefined)}</Text>
          {view.savingMinor ? <Text style={[type.small, { color: palette.successText, fontFamily: font.medium }]}>{prices.saving(view.savingMinor)}</Text> : null}
        </View>
      ) : null}
      <View role="radiogroup" {...radioGroupKeys()} accessibilityLabel={prices.tabsLabel} style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg }}>
        <ChoiceTile label={prices.tabs.same(view.same.length)} selected={tab === "same"} minHeight={controlSize.minimumTarget} onPress={() => setTab("same")} />
        <ChoiceTile label={prices.tabs.similar(view.similar.length)} selected={tab === "similar"} minHeight={controlSize.minimumTarget} onPress={() => setTab("similar")} />
      </View>
      <Body muted style={{ marginTop: spacing.md }}>
        {rows.length === 0 ? (tab === "same" ? prices.sameEmpty : prices.similarEmpty) : tab === "same" ? prices.sameHint : prices.similarHint}
      </Body>
      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        {rows.map((row) => (
          <PriceCard key={row.id} row={row} same={tab === "same"} onAdd={() => onAdd(row)} />
        ))}
      </View>
      {tab === "similar" && view.weak.length > 0 ? (
        <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
          <Button label={prices.weak(view.weak.length)} icon={weakOpen ? ChevronUp : ChevronDown} variant="ghost" size="sm" onPress={() => setWeakOpen(!weakOpen)} />
          {weakOpen ? view.weak.map((row) => <PriceCard key={row.id} row={row} same={false} onAdd={() => onAdd(row)} />) : null}
        </View>
      ) : null}
      {tab === "similar" && view.hidden > 0 ? (
        <Body muted style={{ marginTop: spacing.md }}>
          {prices.hidden(view.hidden)}
        </Body>
      ) : null}
      <Actions>
        <Button label={tr.common.close} size="sm" onPress={onClose} />
      </Actions>
    </DialogShell>
  );
}

/**
 * One listing: the shop, what it is, the price. A same listing takes "+" to join the wish, and once it is
 * one of its links says so; the others only open. The trailing column is always there, so every price lines up.
 */
function PriceCard({ row, same, onAdd }: { row: PriceRow; same: boolean; onAdd: () => void }) {
  const { palette } = useTheme();
  const detail = same ? (row.suspicious ? prices.suspicious : row.title) : tr.common.joined(row.difference ?? undefined, row.shop);
  return (
    <Press
      accessibilityRole="link"
      accessibilityLabel={tr.common.withDetail(same ? row.shop : row.title, tr.common.withDetail(detail, formatMinor(row.priceMinor)))}
      accessibilityHint={prices.open(row.shop)}
      onPress={() => openLink(row.url)}
      style={(state) => ({ ...cardEdge(palette), flexDirection: "row", alignItems: "center", gap: spacing.md, ...interactionSurface(palette, state, { base: palette.surface }) })}
    >
      {same ? <Tile id={row.shop} name={row.shop} size={listCard.tile} /> : null}
      <View style={{ flex: 1, minWidth: 0, gap: offset.tight }}>
        <Text numberOfLines={same ? 1 : 2} style={[type.body, { color: palette.textStrong, fontFamily: font.medium }]}>
          {same ? row.shop : row.title}
        </Text>
        <Text numberOfLines={2} style={[type.small, { color: row.suspicious ? palette.errorText : palette.textSecondary }]}>
          {detail}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: offset.tight }}>
        <Text style={[type.body, { color: palette.textStrong, fontFamily: font.semibold }]}>{formatMinor(row.priceMinor)}</Text>
        {row.freeShipping ? <Text style={[type.small, { color: palette.successText }]}>{prices.freeShipping}</Text> : null}
        {row.mine ? <Text style={[type.small, { color: palette.accentText, fontFamily: font.medium }]}>{prices.mine}</Text> : null}
      </View>
      <View style={{ width: controlSize.minimumTarget, alignItems: "center" }}>
        {same && row.mine ? (
          <Check accessible={false} size={iconSize.control} color={palette.accentText} strokeWidth={iconStroke.regular} />
        ) : same && row.take ? (
          <IconButton icon={Plus} label={prices.add(row.shop)} tone="primary" onPress={onAdd} />
        ) : (
          <ExternalLink accessible={false} size={iconSize.control} color={palette.textSecondary} strokeWidth={iconStroke.regular} />
        )}
      </View>
    </Press>
  );
}
