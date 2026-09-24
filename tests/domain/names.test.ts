import { describe, expect, it } from "vitest";

import { NAME_MAX, initialOf, nameFrom, tileTone } from "../../src/domain/names";

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
  it("gives the same list the same tone every time", () => {
    const id = "01926d3e-7c2a-7b3f-9a4e-3c1d2b0a9f8e";
    expect(tileTone(id, 3)).toBe(tileTone(id, 3));
  });

  it("spreads lists over every tone", () => {
    const tones = new Set(["a", "b", "c", "d", "e", "f"].map((id) => tileTone(id, 3)));
    expect(tones.size).toBe(3);
    for (const tone of tones) expect(tone).toBeLessThan(3);
  });
});
