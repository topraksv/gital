/**
 * A new list's picture from its name (the owner asked 2026-09-27: "pazar
 * diyince ona göre default bir logo gelsin"): a word the name begins or holds
 * decides it, however it is spelt, and a name that says nothing draws none.
 */

import { describe, expect, it } from "vitest";
import { LIST_ICONS, NAME_WORDS, iconForName } from "../../src/domain/lists";

describe("iconForName", () => {
  it.each([
    ["Pazar", "vegetables"],
    ["Haftalık market", "cart"],
    ["SÜPERMARKET", "cart"],
    ["Manav", "vegetables"],
    ["Fırın", "bakery"],
    ["kasap", "meat"],
    ["Balıkçı", "fish"],
    ["Eczane", "pharmacy"],
    ["Bebek için", "baby"],
    ["Kedi maması", "pet"],
    ["Temizlik", "cleaning"],
    ["Doğum günü partisi", "party"],
    ["Anneme hediye", "gift"],
    ["Kahvaltılık", "breakfast"],
  ])("draws %s as %s", (name, icon) => {
    expect(iconForName(name)).toBe(icon);
  });

  it("draws nothing for a name that says nothing, or a word only inside another", () => {
    expect(iconForName("Cumartesi")).toBeNull();
    expect(iconForName("2026")).toBeNull();
    expect(iconForName("Ali'nin listesi")).toBeNull();
    // "et" is meat only as a word of its own, not inside "Eteklik".
    expect(iconForName("Eteklik")).toBeNull();
  });

  it("reaches every picture from some word, and each word draws its own", () => {
    expect(NAME_WORDS.map(([icon]) => icon)).toEqual([...LIST_ICONS]);
    for (const [icon, words] of NAME_WORDS) {
      expect(words.length, icon).toBeGreaterThan(0);
      for (const word of words) expect(iconForName(word), word).toBe(icon);
    }
  });

  it("reads a word of four letters or more in its longer forms, a shorter one only whole", () => {
    expect(iconForName("Maması")).toBe("pet");
    expect(iconForName("İlaçlar")).toBe("pharmacy");
    expect(iconForName("Evler")).toBeNull();
    expect(iconForName("Et")).toBe("meat");
    expect(iconForName("Pazar/market")).toBe("vegetables");
    expect(iconForName("Yeni-bebek")).toBe("baby");
  });

  it("takes the first word that decides, as the name is read", () => {
    expect(iconForName("Pazar ve market")).toBe("vegetables");
  });
});
