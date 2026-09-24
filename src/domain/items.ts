/** What a typed entry means as items, and how an item's quantity reads and steps. */

import { initialOf, nameFrom } from "./names";

/** Read by the schema too, so the column and the parser know the same six. */
export const UNITS = ["adet", "kg", "g", "lt", "ml", "paket"] as const;

export type Unit = (typeof UNITS)[number];

export interface Quantity {
  /** Thousandths of `unit`, so 1,5 lt is 1500 (`docs/ARCHITECTURE.md`, Tables). */
  quantityMilli: number | null;
  unit: Unit | null;
}

/** An item as typed: what a quick-add entry names, and what the item panel saves. */
export interface Entry extends Quantity {
  name: string;
}

/** What people type or say for each unit, lower-cased the Turkish way. */
const UNIT_WORDS: Record<string, Unit> = {
  adet: "adet",
  tane: "adet",
  kg: "kg",
  kilo: "kg",
  kilogram: "kg",
  g: "g",
  gr: "g",
  gram: "g",
  lt: "lt",
  l: "lt",
  litre: "lt",
  ml: "ml",
  mililitre: "ml",
  paket: "paket",
  pk: "paket",
};

/** Dictation writes small numbers as words (`docs/SPEC.md` 2.3). */
const NUMBER_WORDS: Record<string, number> = {
  yarım: 0.5,
  bir: 1,
  iki: 2,
  üç: 3,
  dört: 4,
  beş: 5,
  altı: 6,
  yedi: 7,
  sekiz: 8,
  dokuz: 9,
  on: 10,
};

const QUANTITY_MAX_MILLI = 9_999_000;

/** A long dictated shop fits; a pasted page does not become a hundred rows. */
export const ENTRY_MAX = 500;

const DIGITS = String.raw`\d+(?:[.,]\d+)?`;
// Longest first, so "gram" is not read as "g" followed by the rest of a word.
const UNIT = Object.keys(UNIT_WORDS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const NUMBER = `${DIGITS}|${Object.keys(NUMBER_WORDS).join("|")}`;
// A unit or a number word must end at a space or the end, which is what keeps
// "2 limon" from being two litres of "imon" and "ikiz" from being two of "z".
const LEADING = new RegExp(`^(${NUMBER})(?:\\s*(${UNIT}))?\\s+(.+)$`, "u");
const TRAILING = new RegExp(`^(.+?)\\s+(${DIGITS})(?:\\s*(${UNIT}))?$`, "u");
const QUANTITY_ONLY = new RegExp(`^(?:${NUMBER})(?:\\s*(?:${UNIT}))?$`, "u");

// Dictation joins items with "ve" and "bir de"; a comma between digits is a
// decimal comma, not a break.
const SEPARATOR = /(?<!\d),|,(?!\d)|[\n;]|\s+ve\s+|\s+bir\s+de\s+/i;
// "Bir de" opening an item is "and also", not one of it.
const ALSO = /^bir\s+de\s+/i;

function quantityFrom(number: string, unit: string | undefined): Quantity | null {
  // A dot before three digits is Turkish for thousands; any other is a decimal point.
  const value = NUMBER_WORDS[number] ?? Number(/^\d{1,3}\.\d{3}$/.test(number) ? number.replace(".", "") : number.replace(",", "."));
  const quantityMilli = Math.round(value * 1000);
  if (!(quantityMilli >= 1 && quantityMilli <= QUANTITY_MAX_MILLI)) return null;
  return { quantityMilli, unit: unit ? UNIT_WORDS[unit]! : "adet" };
}

function entryFrom(segment: string): Entry | null {
  // Matched lower-cased, so "İki kilo" reads as "iki kilo"; the name is cut
  // from the text as typed, which the Turkish lower-casing keeps aligned.
  const lower = segment.toLocaleLowerCase("tr-TR");
  const typed = lower.length === segment.length ? segment : lower;
  let rawName = segment;
  let quantity: Quantity | null = null;
  const leading = LEADING.exec(lower);
  const trailing = leading ? null : TRAILING.exec(lower);
  if (leading) {
    quantity = quantityFrom(leading[1]!, leading[2]);
    if (quantity) rawName = typed.slice(typed.length - leading[3]!.length);
  } else if (trailing) {
    quantity = quantityFrom(trailing[2]!, trailing[3]);
    if (quantity) rawName = typed.slice(0, trailing[1]!.length);
  }
  const name = itemNameFrom(rawName);
  if (name == null) return null;
  return { name, quantityMilli: quantity?.quantityMilli ?? null, unit: quantity?.unit ?? null };
}

/**
 * A list name's rules, with the first letter raised the Turkish way: the
 * keyboard capitalises only the first of several items in one entry, and a
 * list reading "Domates, süt, Ekmek" looks careless.
 */
export function itemNameFrom(input: string): string | null {
  const name = nameFrom(input);
  return name == null ? null : initialOf(name) + Array.from(name).slice(1).join("");
}

/**
 * The items one entry in the quick-add field names (`docs/SPEC.md` 2.1–2.3):
 * `2 kg domates, 1,5 lt süt ve ekmek` is three.
 */
export function parseEntry(text: string): Entry[] {
  const entries: Entry[] = [];
  // A quantity said alone, where dictation wrote a pause as a comma, goes to
  // the product after it when that names none of its own.
  let held = "";
  for (const part of text.split(SEPARATOR)) {
    const segment = part.trim().replace(ALSO, "");
    if (segment === "") continue;
    if (QUANTITY_ONLY.test(segment.toLocaleLowerCase("tr-TR"))) {
      held = segment;
      continue;
    }
    const own = entryFrom(segment);
    const entry = held && own?.quantityMilli == null ? entryFrom(`${held} ${segment}`) : own;
    if (entry) entries.push(entry);
    held = "";
  }
  return entries;
}

/**
 * The key two entries share when they are the same product (2.5): case, Turkish
 * marks and spacing folded away, so "Süt", "SÜT" and "sut" are one row.
 */
export function foldName(name: string): string {
  return name
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "1,5 lt"; nothing for an item that names no quantity. */
export function formatQuantity({ quantityMilli, unit }: Quantity): string {
  if (quantityMilli == null || unit == null) return "";
  return `${String(quantityMilli / 1000).replace(".", ",")} ${unit}`;
}

/** What one press of − or + moves: a whole piece, half a kilo or litre, 100 g or ml. */
const STEP_MILLI: Record<Unit, number> = { adet: 1000, paket: 1000, kg: 500, lt: 500, g: 100_000, ml: 100_000 };

/** An item without a quantity reads as one piece, to the stepper and to the eye. */
export function quantityOrOne({ quantityMilli, unit }: Quantity): { quantityMilli: number; unit: Unit } {
  return quantityMilli != null && unit != null ? { quantityMilli, unit } : { quantityMilli: 1000, unit: "adet" };
}

/**
 * The quantity one press of − or + leads to, landing on the unit's step, or
 * `null` when the press has nowhere to go — the screen disables it then.
 */
export function stepQuantity(quantity: Quantity, direction: 1 | -1): { quantityMilli: number; unit: Unit } | null {
  const current = quantityOrOne(quantity);
  const step = STEP_MILLI[current.unit];
  const next = direction === 1
    ? (Math.floor(current.quantityMilli / step) + 1) * step
    : (Math.ceil(current.quantityMilli / step) - 1) * step;
  if (next < step || next > QUANTITY_MAX_MILLI) return null;
  return { quantityMilli: next, unit: current.unit };
}
