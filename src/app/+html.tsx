import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

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
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
        <title>Gital</title>
        {/* Installing to the home screen (SPEC 11.4). The browser's chrome
            takes the default palette's ground per scheme on the first paint;
            a palette chosen in Ayarlar is not followed there yet. */}
        <link rel="manifest" href="/gital/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/gital/icons/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Gital" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content={light.background} />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content={dark.background} />
        <ScrollViewStyleReset />
        <script dangerouslySetInnerHTML={{ __html: PAINT_GROUND }} />
        <script dangerouslySetInnerHTML={{ __html: REGISTER_WORKER }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
