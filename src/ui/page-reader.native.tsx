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

const GIVE_UP_MS = 25_000;
// Run at the end of every load and polled: a shop may draw its product after
// the load, and a bot wall's check reloads into the real page, which runs it
// again. The page's HTML is all it sends; the reading is `productFromPage`'s.
const READ = `(function(){var tries=0;(function look(){var html=document.documentElement.outerHTML;if(/application\\/ld\\+json|og:image|landingImage/.test(html)||++tries>=10)window.ReactNativeWebView.postMessage(html.slice(0,4000000));else setTimeout(look,1000);})();})();true;`;

function next(): void {
  current = jobs.shift() ?? null;
  for (const listener of listeners) listener();
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

/** After a wish is written: its unpriced links' pages, read and filled in, quietly. */
export function readLinkPages(wishId: string): void {
  void (async () => {
    for (const link of await unpricedLinksOf(wishId)) {
      const product = await readProduct(link.url);
      if (!product) continue;
      const photo = product.image ? await photoFromWeb(product.image).catch(() => null) : null;
      await fillFromPage(link.id, { name: product.name, priceMinor: product.priceMinor, photo });
    }
  })().catch(() => {
    // A page that fills nothing is an expected outcome, not an error (ARCHITECTURE, 2026-09-23).
  });
}
