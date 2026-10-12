import { describe, expect, it } from "vitest";

import { NAME_MAX, initialOf, isEmail, nameFrom, tileTone } from "../../src/domain/names";

describe("nameFrom", () => {
  it.each([
    ["  Market  ", "Market"],
    ["Haftalık\n  pazar", "Haftalık pazar"],
    ["\tEczane ", "Eczane"],
  ])("stores %j as %j", (input, stored) => {
    expect(nameFrom(input)).toBe(stored);
  });

  it.each([
    ["Market \uD83D", "Market"],
    ["\uDED2Pazar", "Pazar"],
  ])("drops half an emoji, as a paste cut at a length limit leaves it (%j)", (input, stored) => {
    expect(nameFrom(input)).toBe(stored);
  });

  it.each(["", "   ", "\n\t"])("refuses a name with nothing in it (%j)", (input) => {
    expect(nameFrom(input)).toBeNull();
  });

  it("cuts a long name at the limit without splitting a character in two", () => {
    const name = `${"a".repeat(NAME_MAX - 1)}🛒🛒`;
    const stored = nameFrom(name);
    expect(Array.from(stored ?? "")).toHaveLength(NAME_MAX);
    expect(stored?.endsWith("🛒")).toBe(true);
  });

  it("cuts at the limit it is given", () => {
    expect(nameFrom("Pınar olsun", 5)).toBe("Pınar");
  });
});

describe("initialOf", () => {
  it("is the first letter, upper-cased the Turkish way", () => {
    expect(initialOf("ilaçlar")).toBe("İ");
    expect(initialOf("ıhlamur")).toBe("I");
    expect(initialOf("şarküteri")).toBe("Ş");
  });

  it("keeps a first character that is two code units whole", () => {
    expect(initialOf("🥕 Pazar")).toBe("🥕");
  });

  // A stored name is never empty, but a tile drawn mid-edit must not throw.
  it("draws nothing rather than failing on an empty name", () => {
    expect(initialOf("")).toBe("");
  });
});

describe("tileTone", () => {
  it("spreads lists over every tone", () => {
    const tones = new Set(["a", "b", "c", "d", "e", "f"].map((id) => tileTone(id, 3)));
    expect(tones.size).toBe(3);
    for (const tone of tones) {
      expect(tone).toBeLessThan(3);
      expect(tone, "an index, never below the first tone").toBeGreaterThanOrEqual(0);
    }
  });
});

describe("an address a form will send", () => {
  it("is anything with a name, an @ and a dotted domain, spaces around it forgiven", () => {
    expect(isEmail(" ayse@ev.com ")).toBe(true);
    // The pattern `send-feedback` holds a signed-out address to, so a slip is caught before a send is spent.
    for (const typed of ["", "ayse", "ayse@", "ayse@ev", "@ev.com", "ayse@ev.", "ay se@ev.com", "x y@ev.com", "ayse@ev.com x", "ay@se@ev.com", "\"ayse\"@ev.com", "<ayse>@ev.com", "ayse@e v.com", "ayse@ev.c om"]) {
      expect(isEmail(typed), typed).toBe(false);
    }
  });
});
