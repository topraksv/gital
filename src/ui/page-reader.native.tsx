/**
 * A wish's link read as the person would read it (SPEC 7.2): the shop's page
 * opened in a WebView nobody sees, on the person's own phone. Trendyol's and
 * Hepsiburada's bot walls (Cloudflare, Akamai) answer 403 to a server and to
 * any request that is not a browser, whatever its address or user agent; a
 * browser engine gets the page (measured 2026-09-27). Akakçe and Cimri price
 * from feeds the shops send them, which a household's app is never sent; what
 * is left is the page, and every large shop writes schema.org's Product in it
 * for Google Shopping, which `productFromPage` reads.
 *
 * One page at a time, and a page that shows no product by `GIVE_UP_MS` is
 * given up: a link that fills nothing keeps its link, as before.
 */

import { useEffect, useSyncExternalStore } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";

import { fillFromPage, unpricedLinksOf } from "../data/wishes";
import { productFromPage, type PageProduct } from "../domain/product-page";
import { isUnread, linkFrom, type Wish } from "../domain/wishes";
import { photoFromWeb } from "./photo-take";
import { pageReader } from "./theme";

interface Job {
  id: number;
  url: string;
  done: (product: PageProduct | null) => void;
}

const jobs: Job[] = [];
let jobCount = 0;
let current: Job | null = null;
const listeners = new Set<() => void>();
/** The wishes whose pages are being read now, and those this launch has already tried. */
const reading = new Set<string>();
const tried = new Set<string>();

function tell(): void {
  for (const listener of listeners) listener();
}

const GIVE_UP_MS = 25_000;
// Run at the end of every load and polled: a shop may draw its product after
// the load, and a bot wall's check reloads into the real page, which runs it
// again. The page's HTML is all it sends; the reading is `productFromPage`'s.
const READ = `(function(){var tries=0;(function look(){var html=document.documentElement.outerHTML;if(/application\\/ld\\+json|og:image|landingImage/.test(html)||++tries>=10)window.ReactNativeWebView.postMessage(html.slice(0,4000000));else setTimeout(look,1000);})();})();true;`;

function next(): void {
  current = jobs.shift() ?? null;
  tell();
}

/** A job ends once, by its own identity: a late message from a page given up ends nothing. */
function finish(job: Job, product: PageProduct | null): void {
  if (current !== job) return;
  current = null;
  job.done(product);
  next();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readProduct(url: string): Promise<PageProduct | null> {
  return new Promise((done) => {
    jobs.push({ id: (jobCount += 1), url, done });
    if (!current) next();
  });
}

/** Mounted once while signed in; draws nothing but the page it is reading. */
export function PageReaderHost() {
  const job = useSyncExternalStore(subscribe, () => current);
  useEffect(() => {
    if (!job) return;
    const timer = setTimeout(() => finish(job, null), GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [job]);
  if (!job) return null;
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: "absolute", width: pageReader.size, height: pageReader.size, opacity: 0 }}>
      <WebView
        key={job.id}
        source={{ uri: job.url }}
        injectedJavaScript={READ}
        // A bot wall's page arrives first and shows no product; the page it reloads into does.
        onMessage={(event) => {
          const product = productFromPage(event.nativeEvent.data);
          if (product) finish(job, product);
        }}
        onError={() => finish(job, null)}
        // A shop's page may send the phone to its app; only the web, and a frame's blank start, is followed.
        // Every address is asked here: one outside `originWhitelist` goes to `Linking.openURL` unasked.
        originWhitelist={["*"]}
        onShouldStartLoadWithRequest={(request) => /^(https?:|about:blank$)/i.test(request.url)}
        // No shop's cookie outlives the reading, nor meets the person's own browsing.
        incognito
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        mediaPlaybackRequiresUserAction
      />
    </View>
  );
}

/** Whether the wish's page is being read, for its row to say so: a read takes seconds, and silence read as failure. */
export function useReadingWish(wishId: string): boolean {
  return useSyncExternalStore(subscribe, () => reading.has(wishId));
}

/** A wish's unpriced links' pages, read and filled in, quietly. */
export function readLinkPages(wishId: string): void {
  tried.add(wishId);
  void (async () => {
    // Asked again after each page, not listed once: a link added by a save
    // while this was reading is read by the same pass, which is the only one.
    const seen = new Set<string>();
    const unread = async () => (await unpricedLinksOf(wishId)).find((link) => !seen.has(link.id));
    let link = await unread();
    if (!link || reading.has(wishId)) return;
    reading.add(wishId);
    tell();
    try {
      for (; link; link = await unread()) {
        seen.add(link.id);
        // A link another member wrote reaches this phone as they wrote it; only a web address is loaded.
        if (linkFrom(link.url) == null) continue;
        const product = await readProduct(link.url);
        // The name and the price first: the picture is a second download, and they need not wait for it.
        await fillFromPage(link.id, { name: product?.name, priceMinor: product?.priceMinor });
        if (!product) continue;
        const photo = product.image ? await photoFromWeb(product.image).catch(() => null) : null;
        if (photo) await fillFromPage(link.id, { photo });
      }
    } finally {
      reading.delete(wishId);
      tell();
    }
  })().catch(() => {
    // A page that fills nothing is an expected outcome, not an error (ARCHITECTURE, 2026-09-23).
  });
}

/**
 * The wishes no phone has read yet (`isUnread`), as their collection opens:
 * one added on the web waited until its panel was saved on a phone, which the
 * owner met as a link that showed nothing (2026-09-30). Once a launch each,
 * so a read cut short is tried again at the next.
 */
export function readUnreadPages(wishes: readonly Wish[]): void {
  const now = Date.now();
  for (const wish of wishes) if (!tried.has(wish.id) && isUnread(wish, now)) readLinkPages(wish.id);
}
