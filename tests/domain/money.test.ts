/**
 * Prices as Gital reads and writes them (SPEC 3.8): integer kuruş, typed the
 * Turkish way. Ported from Helix's `src/domain/money.ts`, without the minus
 * sign a price never has.
 */

import { describe, expect, it } from "vitest";

import { MAX_PRICE_MINOR, formatMinor, formatMinorInput, formatPriceInput, isPrice, readPrice, spentOn } from "../../src/domain/money";

describe("readPrice", () => {
  it("reads kuruş from what is typed, grouped or not, with or without the lira sign", () => {
    expect(readPrice("45")).toEqual({ ok: true, minor: 4500 });
    expect(readPrice("45,9")).toEqual({ ok: true, minor: 4590 });
    expect(readPrice("1.234,56")).toEqual({ ok: true, minor: 123456 });
    expect(readPrice("1234,56")).toEqual({ ok: true, minor: 123456 });
    expect(readPrice(" ₺0,05 ")).toEqual({ ok: true, minor: 5 });
    expect(readPrice("45,")).toEqual({ ok: true, minor: 4500 });
  });

  it("reads nothing typed as no price, and refuses what is not one", () => {
    expect(readPrice("  ")).toEqual({ ok: true, minor: null });
    for (const typed of [",5", "1,234", "12.34", "-5", "1+2", "abc", "1.23,00"]) expect(readPrice(typed), typed).toEqual({ ok: false });
    expect(readPrice("999.999.999.999,99")).toEqual({ ok: true, minor: MAX_PRICE_MINOR });
    expect(readPrice("1.000.000.000.000")).toEqual({ ok: false });
  });
});

describe("isPrice", () => {
  it("holds a stored price to whole, non-negative kuruş within the limit", () => {
    expect([0, 1, 4590, MAX_PRICE_MINOR].every(isPrice)).toBe(true);
    expect([-1, 0.5, MAX_PRICE_MINOR + 1, Number.NaN, Infinity].some(isPrice)).toBe(false);
  });
});

describe("spentOn", () => {
  it("adds up what was priced, and is no total when nothing was", () => {
    expect(spentOn([{ priceMinor: 4590 }, { priceMinor: null }, { priceMinor: 1250 }])).toBe(5840);
    expect(spentOn([{ priceMinor: 0 }])).toBe(0);
    expect(spentOn([{ priceMinor: null }])).toBeNull();
    expect(spentOn([])).toBeNull();
  });
});

describe("formatting", () => {
  it("writes a price the Turkish way, and a stored one back into its field exactly", () => {
    expect(formatMinor(123456)).toBe("₺1.234,56");
    expect(formatMinor(0)).toBe("₺0,00");
    expect(formatMinorInput(123450)).toBe("1.234,50");
    expect(formatMinorInput(null)).toBe("");
    expect(readPrice(formatMinorInput(4590))).toEqual({ ok: true, minor: 4590 });
  });

  it("groups a price as it is typed, keeping one comma and two kuruş digits", () => {
    expect(formatPriceInput("15000")).toBe("15.000");
    expect(formatPriceInput("1234,567")).toBe("1.234,56");
    expect(formatPriceInput("0012")).toBe("12");
    expect(formatPriceInput(",5")).toBe("0,5");
    expect(formatPriceInput("1,2,3")).toBe("1,23");
    expect(formatPriceInput("₺ 45.90")).toBe("4.590");
    expect(formatPriceInput("-5")).toBe("5");
    // A keypad whose decimal key is a dot: typed last, it is the comma, and
    // the next digit is kuruş. Anywhere else a dot is a thousands mark.
    expect(formatPriceInput("45.")).toBe("45,");
    expect(formatPriceInput("45,.")).toBe("45,");
    expect(formatPriceInput("1.23")).toBe("123");
    expect(formatPriceInput("")).toBe("");
  });
});
