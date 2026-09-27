/**
 * The KVKK notice (Helix's `tests/ui/legal-notice.test.ts`), held to what makes
 * it real: it can be reached from every screen that collects something, before
 * an account exists, and it names every party the code sends data to. The
 * rest is prose, reviewed by reading.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { tr } from "../../src/i18n/tr";

const root = join(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("the privacy notice", () => {
  it("names a controller and a channel, with no placeholder left in either", () => {
    expect(tr.legal.controllerName.trim().length).toBeGreaterThan(3);
    expect(tr.legal.contactEmail).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    for (const value of [tr.legal.controllerName, tr.legal.contactEmail]) expect(value).not.toMatch(/TODO|TBD|example\.com|placeholder/i);
  });

  it("is reachable from sign-up, from feedback and from Ayarlar", () => {
    for (const file of ["src/app/(auth)/sign-in.tsx", "src/app/feedback.tsx", "src/app/(tabs)/settings.tsx"]) {
      expect(read(file), file).toContain('"/privacy"');
    }
  });

  it("opens before an account exists", () => {
    const layout = read("src/app/_layout.tsx");
    const screen = layout.indexOf('<Stack.Screen name="privacy" />');
    expect(screen).toBeGreaterThan(-1);
    expect(layout.lastIndexOf("</Stack.Protected>", screen)).toBeGreaterThan(layout.lastIndexOf("<Stack.Protected", screen));
  });

  it("holds sign-up until the notice is accepted at its end, and says why on the form", () => {
    const signIn = read("src/app/(auth)/sign-in.tsx");
    expect(signIn).toContain("tr.legal.signUpNotice");
    expect(signIn).toMatch(/mode !== "signUp" \|\| consented/);
    expect(read("src/app/privacy.tsx")).toMatch(/legal\.accept\b/);
    expect(tr.legal.signUpNotice).toMatch(/hesap oluşturduğunda/i);
  });

  /**
   * Each host the code reaches, and whom the notice names for it: a host added
   * to the web's policy or to a fetch fails here until the notice says who
   * receives what.
   */
  const DISCLOSED_AS: Record<string, string | null> = {
    "world.openfoodfacts.org": "Open Food Facts",
    "images.openfoodfacts.org": "Open Food Facts",
    // The invitation and reset pages the app links to: the site itself.
    "topraksv.github.io": "GitHub Pages",
  };

  it("names every party the code sends data to, and where the store is", () => {
    const hosts = new Set<string>();
    for (const file of ["src/services/barcode.ts", "src/sync/sharing.ts", "src/auth/recovery.ts", "src/domain/web-security.ts"]) {
      for (const [, host] of read(file).matchAll(/https:\/\/([A-Za-z0-9.-]+\.[a-z]{2,})/g)) hosts.add(host!);
    }
    expect(hosts.size, "discovery stopped finding the URLs").toBeGreaterThanOrEqual(3);
    expect([...hosts].filter((host) => !(host in DISCLOSED_AS)), "a host with no decision recorded").toEqual([]);
    const transfers = tr.legal.transfers.join(" ");
    for (const name of [...Object.values(DISCLOSED_AS), "Supabase", "Gmail", "Expo"]) expect(transfers).toContain(name);
    expect(transfers).toMatch(/Frankfurt/);
  });

  it("gives every store an end, and tells a member what stays on a list", () => {
    const retention = tr.legal.retention.join(" ");
    for (const store of [/[Cc]ihaz/, /[Bb]ulut/, /[Gg]eri bildirim/, /paylaş/]) expect(retention).toMatch(store);
  });

  it("carries every item Article 10 enumerates, numbered in order", () => {
    const titles = [
      tr.legal.controllerTitle,
      tr.legal.collectedTitle,
      tr.legal.methodTitle,
      tr.legal.purposeTitle,
      tr.legal.transferTitle,
      tr.legal.retentionTitle,
      tr.legal.rightsTitle,
      tr.legal.selfServiceTitle,
      tr.legal.contactTitle,
    ];
    expect(titles.map((title) => title.split(".")[0])).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    for (const purpose of tr.legal.purposes) expect(purpose).toMatch(/Hukuki sebep: KVKK m\. 5/);
    expect(tr.legal.rights).toHaveLength(8);
    expect(tr.legal.methodBody).toMatch(/doğrudan sizden/);
    expect(tr.legal.transferNote).toMatch(/m\. 9/);
    expect(tr.legal.contactBody(tr.legal.contactEmail)).toMatch(/Kişisel Verileri Koruma Kurulu/);
  });
});
