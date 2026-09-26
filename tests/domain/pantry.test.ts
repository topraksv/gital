/**
 * What the pantry holds (SPEC 12.8): its moves, oldest first, summed in the
 * unit it holds, and what one press of − takes away.
 */

import { describe, expect, it } from "vitest";

import { atHome, lastedOf, lessOf, stockOf, type Stock } from "../../src/domain/pantry";

const of = (quantity: number, unit: Stock["unit"]): Stock => ({ quantityMilli: quantity * 1000, unit });

describe("stockOf", () => {
  it("adds what arrived and takes away what was used", () => {
    expect(stockOf([of(2, "lt"), of(1, "lt"), of(-0.5, "lt")])).toEqual(of(2.5, "lt"));
  });

  it("counts a kilo in the grams it holds, and grams in its kilos", () => {
    expect(stockOf([of(500, "g"), of(1, "kg")])).toEqual(of(1500, "g"));
    expect(stockOf([of(1, "kg"), of(250, "g")])).toEqual(of(1.25, "kg"));
    expect(stockOf([of(1, "lt"), of(330, "ml")])).toEqual(of(1.33, "lt"));
  });

  it("starts afresh from an arrival it cannot count in its unit", () => {
    expect(stockOf([of(2, "kg"), of(3, "adet")])).toEqual(of(3, "adet"));
    expect(stockOf([of(1, "paket"), of(2, "adet")])).toEqual(of(2, "adet"));
  });

  it("holds nothing once used up, and what arrives after starts from nothing", () => {
    expect(stockOf([])).toBeNull();
    expect(stockOf([of(1, "adet"), of(-1, "adet")])).toBeNull();
    expect(stockOf([of(1, "kg"), of(-1, "kg"), of(2, "adet")])).toEqual(of(2, "adet"));
    expect(stockOf([of(1, "adet"), of(-2, "adet"), of(1, "adet")])).toEqual(of(1, "adet"));
  });
});

describe("lessOf", () => {
  it("takes one step, landing on the unit's step", () => {
    expect(lessOf(of(3, "adet"))).toEqual(of(-1, "adet"));
    expect(lessOf(of(1.3, "kg"))).toEqual(of(-0.3, "kg"));
    expect(lessOf(of(750, "ml"))).toEqual(of(-50, "ml"));
  });

  it("takes all of it when a step would leave nothing", () => {
    expect(lessOf(of(1, "adet"))).toEqual(of(-1, "adet"));
    expect(lessOf(of(0.3, "kg"))).toEqual(of(-0.3, "kg"));
  });
});

describe("atHome", () => {
  it("finds what an entry adds that the pantry holds, however it was spelled", () => {
    const pantry = [{ name: "Süt", ...of(1, "lt") }, { name: "Ekmek", ...of(1, "adet") }];
    expect(atHome(pantry, [{ name: "sut" }, { name: "Domates" }])).toEqual([pantry[0]]);
    expect(atHome(pantry, [{ name: "Domates" }])).toEqual([]);
  });
});

describe("lastedOf", () => {
  const at = (day: number, quantity: number, unit: Stock["unit"] = "adet") => ({ ...of(quantity, unit), at: new Date(Date.UTC(2026, 8, 1 + day)).toISOString() });
  const DAY = 86_400_000;

  it("measures each stay from the arrival into an empty pantry to the move that emptied it (SPEC 12.7)", () => {
    expect(lastedOf([at(0, 2), at(1, -1), at(3, -1), at(5, 1), at(9, -1)])).toEqual([3 * DAY, 4 * DAY]);
  });

  it("keeps counting a stay through a top-up, and measures none still going", () => {
    expect(lastedOf([at(0, 1), at(2, 1), at(6, -2), at(7, 1)])).toEqual([6 * DAY]);
    expect(lastedOf([at(0, 1)])).toEqual([]);
  });
});
