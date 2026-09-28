import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

import { contentSecurityPolicy } from "../domain/web-security";
import { tr } from "../i18n/tr";
import { focusRingCss } from "../ui/focus-ring";
import { APPEARANCE_KEYS, DEFAULT_PALETTE_ID, PALETTES } from "../ui/theme";

const GROUNDS = Object.fromEntries(
  Object.entries(PALETTES).map(([id, { light, dark }]) => [id, [light.background, dark.background]]),
);

// Runs before the bundle in every browser, so it is ES5 and swallows its own
// errors. Storage has a try of its own: a browser that blocks site data throws
// on reading `localStorage`, and should still get the system's scheme.
const PAINT_GROUND = [
  `try{var g=${JSON.stringify(GROUNDS)},p,t;`,
  `try{p=localStorage.getItem(${JSON.stringify(APPEARANCE_KEYS.palette)});t=localStorage.getItem(${JSON.stringify(APPEARANCE_KEYS.theme)})}catch(e){}`,
  `var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches),r=document.documentElement;`,
  `r.style.background=(Object.prototype.hasOwnProperty.call(g,p)?g[p]:g[${JSON.stringify(DEFAULT_PALETTE_ID)}])[d?1:0];`,
  `r.style.colorScheme=d?"dark":"light"}catch(e){}`,
].join("");

// Helix's registration, under Gital's base only: the dev server serves the
// root, where a worker scoped to `/gital/` would never control a page.
const REGISTER_WORKER = [
  `if("serviceWorker" in navigator&&location.pathname.indexOf("/gital/")===0){`,
  `addEventListener("load",function(){navigator.serviceWorker.register("/gital/sw.js",{scope:"/gital/"}).catch(function(){})})}`,
].join("");

const { light, dark } = PALETTES[DEFAULT_PALETTE_ID];

// Where the export is published, and the card a pasted link becomes: Helix's,
// served from `public/` because Expo renames what it copies from `assets/`.
// JPEG, since the card is flat colour and a crawler is its only reader.
const SITE_URL = "https://topraksv.github.io/gital/";
const OG_IMAGE = "og-cover.jpg";

/**
 * The web shell. The export is one static document for every visitor, so it
 * cannot know the stored palette or the system's scheme; the script paints the
 * right ground before the bundle loads, and the root layout takes over from it.
 * `viewport-fit=cover` is Helix's, and is what gives iOS Safari real safe-area
 * insets.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="tr">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta httpEquiv="Content-Security-Policy" content={contentSecurityPolicy(process.env.EXPO_PUBLIC_SUPABASE_URL)} />
        {/* A reset link's code must not ride the page's asset requests as a
            referrer before supabase-js takes it from the address. Helix's. */}
        <meta name="referrer" content="no-referrer" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
        <title>{tr.meta.title}</title>
        <meta name="description" content={tr.meta.social} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Gital" />
        <meta property="og:locale" content="tr_TR" />
        <meta property="og:title" content={tr.meta.title} />
        <meta property="og:description" content={tr.meta.social} />
        <meta property="og:url" content={SITE_URL} />
        <meta property="og:image" content={`${SITE_URL}${OG_IMAGE}`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        {/* Installing to the home screen (SPEC 11.4). The browser's chrome
            takes the default palette's ground per scheme on the first paint;
            the root layout then writes the chosen palette's over both. */}
        <link rel="manifest" href="/gital/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/gital/icons/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Gital" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content={light.background} />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content={dark.background} />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: focusRingCss(light.focus) }} />
        <script dangerouslySetInnerHTML={{ __html: PAINT_GROUND }} />
        <script dangerouslySetInnerHTML={{ __html: REGISTER_WORKER }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
