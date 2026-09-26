/**
 * Prices (`docs/SPEC.md` 3.8), in integer kuruş as Helix keeps money: floating
 * point never touches a stored amount. Ported from Helix's `src/domain/money.ts`
 * without the minus sign, which a price never has.
 */

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

/** ₺1.234,56 */
export function formatMinor(minor: number): string {
  return LIRA.format(minor / 100);
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
