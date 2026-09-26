/**
 * Prices (`docs/SPEC.md` 3.8), in integer kuruş as Helix keeps money: floating
 * point never touches a stored amount. Ported from Helix's `src/domain/money.ts`
 * without the minus sign, which a price never has.
 */

import { foldName, quantityOrOne, type Quantity, type Unit } from "./items";

/** Helix's largest amount, 999.999.999.999,99: exact in integer kuruş. */
export const MAX_PRICE_MINOR = 99_999_999_999_999;

export function isPrice(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_PRICE_MINOR;
}

const LIRA = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" });

/** What the priced items of a basket or a shop cost; `null` when none was priced, which is not ₺0. */
export function spentOn(items: readonly { priceMinor: number | null }[]): number | null {
  const priced = items.flatMap((item) => (item.priceMinor == null ? [] : [item.priceMinor]));
  return priced.length === 0 ? null : priced.reduce((sum, price) => sum + price, 0);
}

/**
 * What each of the last `months` calendar months cost, this one last, on the
 * device's clock; a month none of whose shops was priced is `null`, not ₺0
 * (SPEC 3.9's chart, 3.11's month so far).
 */
export function spentByMonth(shops: readonly { finishedAt: string; spentMinor: number | null }[], now: Date, months: number): { start: string; spentMinor: number | null }[] {
  return Array.from({ length: months }, (_, at) => {
    const start = new Date(now.getFullYear(), now.getMonth() - months + 1 + at, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1).getTime();
    const inMonth = shops.filter((shop) => Date.parse(shop.finishedAt) >= start.getTime() && Date.parse(shop.finishedAt) < end);
    return { start: start.toISOString(), spentMinor: spentOn(inMonth.map((shop) => ({ priceMinor: shop.spentMinor }))) };
  });
}

/** ₺1.234,56 */
export function formatMinor(minor: number): string {
  return LIRA.format(minor / 100);
}

/**
 * ₺850, ₺1,2 B, ₺3,4 Mn: a figure short enough to sit under a chart's bar.
 * Written by hand, as Hermes's `Intl` is not relied on for compact notation.
 */
export function formatMinorShort(minor: number): string {
  const lira = minor / 100;
  if (Math.round(lira) < 1000) return `₺${Math.round(lira)}`;
  const thousands = Math.round(lira / 100) / 10;
  const [figure, unit] = thousands < 1000 ? [thousands, "B"] : [Math.round(lira / 100_000) / 10, "Mn"];
  return `₺${String(figure).replace(".", ",")} ${unit}`;
}

/**
 * A price typed: none when blank, refused when it is not one whole number of
 * kuruş. A comma with nothing after it yet is whole lira, so the field this
 * reads, which `formatPriceInput` keeps grouped, is refused only over the limit.
 */
export function readPrice(input: string): { ok: true; minor: number | null } | { ok: false } {
  const typed = input.replace(/[₺\s]/g, "");
  if (typed === "") return { ok: true, minor: null };
  if (!/^\d{1,3}(\.\d{3})*(,\d{0,2})?$|^\d+(,\d{0,2})?$/.test(typed)) return { ok: false };
  const [whole, kurus = ""] = typed.replace(/\./g, "").split(",");
  const minor = Number(whole) * 100 + Number(kurus.padEnd(2, "0"));
  return isPrice(minor) ? { ok: true, minor } : { ok: false };
}

/**
 * Group a price as it is typed (`15000` → `15.000`), keeping one comma and
 * two kuruş digits. A dot typed last, with no comma yet, is the comma: some
 * decimal keypads have only a dot, and dropped as a thousands mark it would
 * make "45.9" read 459. It cannot be a grouping this field wrote, which never
 * ends a value.
 */
export function formatPriceInput(raw: string): string {
  const typed = raw.includes(",") ? raw : raw.replace(/\.$/, ",");
  const cleaned = typed.replace(/[^\d,]/g, "");
  const comma = cleaned.indexOf(",");
  const grouped = groupThousands((comma === -1 ? cleaned : cleaned.slice(0, comma)).replace(/^0+(?=\d)/, ""));
  if (comma === -1) return grouped;
  return `${grouped || "0"},${cleaned.slice(comma + 1).replace(/,/g, "").slice(0, 2)}`;
}

/** Whole digits grouped the Turkish way: `15000` → `15.000`. */
export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** A stored price back in its field, exactly; none is an empty field. */
export function formatMinorInput(minor: number | null): string {
  return minor == null ? "" : formatPriceInput((minor / 100).toFixed(2).replace(".", ","));
}

/** A product bought before, the quantity it came in and what was paid, if that was typed. */
export interface PricePaid extends Quantity {
  name: string;
  priceMinor: number | null;
}

export interface Bought extends PricePaid {
  boughtAt: string;
}

/**
 * When a product was last bought and its last six prices, oldest first
 * (SPEC 3.9), or `null` when it never was. `bought` comes latest first.
 */
export function pastOf(bought: readonly Bought[], name: string): { lastAt: string; lastPriceMinor: number | null; prices: number[] } | null {
  const key = foldName(name);
  const own = bought.filter((row) => foldName(row.name) === key);
  if (own.length === 0) return null;
  const prices = own.flatMap((row) => (row.priceMinor == null ? [] : [row.priceMinor])).slice(0, CHARTED);
  return { lastAt: own[0]!.boughtAt, lastPriceMinor: own[0]!.priceMinor, prices: prices.reverse() };
}

/** A tenth: a price within one is the same price at another shop, and saying so would be noise. */
const RISE_FROM = 10;

/** Enough points for a line to show a trend, and few enough that each is a point and not a blur. */
const CHARTED = 6;

/** Recent enough to be what the product costs now, and three so one odd price does not decide. */
const RECENT = 3;

/** Grams are thousandths of a kilo and millilitres of a litre; a piece and a pack stand alone. */
const BASE: Record<Unit, { unit: Unit; per: number }> = {
  adet: { unit: "adet", per: 1 },
  paket: { unit: "paket", per: 1 },
  kg: { unit: "kg", per: 1 },
  g: { unit: "kg", per: 1000 },
  lt: { unit: "lt", per: 1 },
  ml: { unit: "lt", per: 1000 },
};

function perUnit(priceMinor: number, quantity: Quantity): { unit: Unit; price: number } {
  const { quantityMilli, unit } = quantityOrOne(quantity);
  const base = BASE[unit];
  return { unit: base.unit, price: (priceMinor * 1000 * base.per) / quantityMilli };
}

/**
 * How many percent `priceMinor` is above what the product recently cost
 * (SPEC 3.12), or `null` when it is not a tenth above or nothing compares.
 * `paid` comes latest first. The same product is the same folded name, and a
 * price is compared by its unit's price, so 500 g is weighed against 2 kg; a
 * piece is never weighed against a kilo. The middle of the last three stands
 * for "recently": one sale or one mistyped price moves it no more than a step.
 */
export function priceRise(paid: readonly PricePaid[], bought: Quantity & { name: string }, priceMinor: number): number | null {
  const key = foldName(bought.name);
  const now = perUnit(priceMinor, bought);
  const recent = paid
    .flatMap((row) => (row.priceMinor != null && foldName(row.name) === key ? [perUnit(row.priceMinor, row)] : []))
    .filter((row) => row.unit === now.unit)
    .slice(0, RECENT)
    .map((row) => row.price)
    .sort((a, b) => a - b);
  if (recent.length === 0) return null;
  const middle = recent.length / 2;
  const usual = recent.length % 2 === 1 ? recent[Math.floor(middle)]! : (recent[middle - 1]! + recent[middle]!) / 2;
  // Decided before rounding, and multiplied rather than divided, so 4.399 on
  // 4.000 is not a tenth and 4.400 is.
  if (usual === 0 || now.price * 100 < usual * (100 + RISE_FROM)) return null;
  return Math.round((now.price / usual - 1) * 100);
}
