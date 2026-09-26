/**
 * The restock suggestion (SPEC 2.7): a product the list buys on a rhythm is
 * offered again once that rhythm says it has run out.
 */

import { describe, expect, it } from "vitest";

import { restockDue, type Purchase } from "../../src/domain/restock";

const DAY = 86_400_000;
const T0 = Date.parse("2026-09-01T10:00:00.000Z");
const on = (day: number) => new Date(T0 + day * DAY);
const bought = (name: string, day: number, quantityMilli: number | null = null, unit: Purchase["unit"] = null): Purchase => ({
  name,
  quantityMilli,
  unit,
  boughtAt: on(day).toISOString(),
});
/** Latest first, as the history reads. */
const every5 = [bought("Süt", 10, 2000, "lt"), bought("süt", 5), bought("Süt", 0)];

describe("restockDue", () => {
  it("offers a product once as long has passed since it was last bought as usually passes, with its last quantity", () => {
    expect(restockDue(every5, [], on(15))).toEqual([{ key: "sut", name: "Süt", quantityMilli: 2000, unit: "lt", everyDays: 5 }]);
    expect(restockDue(every5, [], on(14.9))).toEqual([]);
  });

  it("needs three purchases to call it a rhythm", () => {
    expect(restockDue(every5.slice(0, 2), [], on(30))).toEqual([]);
  });

  it("leaves out what the list already holds, however it is spelled", () => {
    expect(restockDue(every5, [{ name: "SÜT" }], on(15))).toEqual([]);
  });

  it("stops offering a product three rhythms after it was last bought, when the habit has ended", () => {
    expect(restockDue(every5, [], on(25))).toHaveLength(1);
    expect(restockDue(every5, [], on(25.1))).toEqual([]);
  });

  it("takes the usual gap, so one long break does not stretch it, and counts a day at least", () => {
    const withBreak = [bought("Süt", 40), bought("Süt", 35), bought("Süt", 30), bought("Süt", 0)];
    expect(restockDue(withBreak, [], on(45))).toMatchObject([{ everyDays: 5 }]);
    const sameDay = [bought("Ekmek", 0.2), bought("Ekmek", 0.1), bought("Ekmek", 0)];
    expect(restockDue(sameDay, [], on(1.3))).toMatchObject([{ name: "Ekmek", everyDays: 1 }]);
  });

  it("offers the most overdue first, three at most", () => {
    const history = ["Süt", "Ekmek", "Yumurta", "Peynir"].flatMap((name, at) => [bought(name, 20 - at), bought(name, 10 - at), bought(name, -at)]);
    expect(restockDue(history, [], on(30)).map((product) => product.name)).toEqual(["Peynir", "Yumurta", "Ekmek"]);
  });
});
