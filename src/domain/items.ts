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

/** A brand and a word to whoever shops: "Pınar olsun, yoksa Sütaş". */
export const NOTE_MAX = 120;

/** What the item panel adds to an entry (`docs/SPEC.md` 2.6, 2.16, 3.7); a product added again comes without any of it. */
export interface ItemChange extends Entry {
  note: string | null;
  urgent: boolean;
  notFound: boolean;
  boughtInstead: string | null;
}

/** An item as a list's text carries it (`docs/SPEC.md` 6.1, 6.2). */
export type ListedEntry = Entry & Pick<ItemChange, "note" | "urgent">;

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

/** A household's longest list, pasted (6.2); a pasted page is still cut. */
export const LIST_TEXT_MAX = 4000;

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
// A written list's quantity: digits, and first — what `formatList` writes —
// so a bulleted "Yarım yağlı süt" or "Pil 4" stays the product it names.
const WRITTEN = new RegExp(`^(${DIGITS})(?:\\s*(${UNIT}))?\\s+(.+)$`, "u");
const QUANTITY_ONLY = new RegExp(`^(?:${NUMBER})(?:\\s*(?:${UNIT}))?$`, "u");

// Dictation joins items with "ve" and "bir de"; a comma between digits is a
// decimal comma, not a break.
const SEPARATOR = /(?<!\d),|,(?!\d)|[\n;]|\s+ve\s+|\s+bir\s+de\s+/i;
// "Bir de" opening an item is "and also", not one of it.
const ALSO = /^bir\s+de\s+/i;
// A written list's bullet: `formatList`'s two, and the ones people type. One
// alone on its line is an empty item, not a product called "•".
const BULLET = /^(?:[•*\-–]|(❗)\uFE0F?)(?:\s+|$)/u;
// A bracket closing a bulleted line is its note, from the first opening one,
// so a note may hold brackets of its own: "Peynir (Ezine (tam yağlı))".
const LINE_NOTE = /\s*\((.*)\)$/u;

function quantityFrom(number: string, unit: string | undefined): Quantity | null {
  // A dot before three digits is Turkish for thousands; any other is a decimal point.
  const value = NUMBER_WORDS[number] ?? Number(/^\d{1,3}\.\d{3}$/.test(number) ? number.replace(".", "") : number.replace(",", "."));
  const quantityMilli = Math.round(value * 1000);
  if (!(quantityMilli >= 1 && quantityMilli <= QUANTITY_MAX_MILLI)) return null;
  return { quantityMilli, unit: unit ? UNIT_WORDS[unit]! : "adet" };
}

/**
 * A segment matched lower-cased, so "İki kilo" reads as "iki kilo", and the
 * quantity it opens with, if it does, with the name after it cut from the text
 * as typed, which the Turkish lower-casing keeps aligned.
 */
function readSegment(segment: string, opening = LEADING) {
  const lower = segment.toLocaleLowerCase("tr-TR");
  const typed = lower.length === segment.length ? segment : lower;
  const match = opening.exec(lower);
  const leading = match && { quantity: quantityFrom(match[1]!, match[2]), name: typed.slice(typed.length - match[3]!.length) };
  return { lower, typed, leading };
}

function entryFrom(segment: string, opening = LEADING, closing: RegExp | null = TRAILING): Entry | null {
  const { lower, typed, leading } = readSegment(segment, opening);
  let rawName = segment;
  let quantity: Quantity | null = null;
  const trailing = leading ? null : closing?.exec(lower);
  if (leading) {
    quantity = leading.quantity;
    if (quantity) rawName = leading.name;
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

/** A note as it is kept: one line of spaces, `NOTE_MAX` long, and none when blank. */
export function noteFrom(input: string | null | undefined): string | null {
  return input == null ? null : nameFrom(input, NOTE_MAX);
}

/** Only an entry's own fields, with no note and not urgent. */
export function bareEntry({ name, quantityMilli, unit }: Entry): ListedEntry {
  return { name, quantityMilli, unit, note: null, urgent: false };
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
 * A pasted list (`docs/SPEC.md` 6.2). With bullets — `formatList`'s, or a
 * list someone typed — only a bulleted line is an item, so a heading and a
 * sign-off are not, and each is one item: "Tuz ve karabiber" is one, a
 * closing bracket is its note and ❗ makes it urgent. Without bullets it is
 * an entry, read as the quick-add field reads one.
 */
export function parseList(text: string): ListedEntry[] {
  // The field stops a paste at its limit, mid-line: that line is half a name.
  const whole = text.length < LIST_TEXT_MAX ? text : text.slice(0, text.lastIndexOf("\n") + 1);
  const bulleted = whole.split("\n").flatMap((raw) => {
    const line = raw.trim();
    const bullet = BULLET.exec(line);
    return bullet ? [{ rest: line.slice(bullet[0].length), urgent: bullet[1] != null }] : [];
  });
  if (bulleted.length === 0) return parseEntry(whole).map(bareEntry);
  return bulleted.flatMap(({ rest, urgent }) => {
    const note = LINE_NOTE.exec(rest);
    const entry = entryFrom(note ? rest.slice(0, note.index) : rest, WRITTEN, null);
    return entry ? [{ ...entry, note: noteFrom(note?.[1]), urgent }] : [];
  });
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

/**
 * A list as a message (`docs/SPEC.md` 6.1): its name, then a line per item in
 * the order given, quantity first, an urgent one marked as the app marks it in
 * red. `parseList` reads it back.
 */
export function formatList(name: string, items: readonly ListedEntry[]): string {
  const lines = items.map((item) => {
    const text = [formatQuantity(item), item.name].filter(Boolean).join(" ");
    return `${item.urgent ? "❗" : "•"} ${text}${item.note ? ` (${item.note})` : ""}`;
  });
  return [name, ...lines].join("\n");
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

/** A product the household has had on a live list, for the quick-add suggestions (`docs/SPEC.md` 2.4). */
export interface KnownProduct {
  /** `foldName` of the name, which is how two spellings are one product. */
  key: string;
  name: string;
  /** Rows it has: each time it was bought, and once more if it is on a list now. */
  times: number;
}

/** One letter would fill the row with half the pantry. */
const SUGGEST_FROM = 2;

const SUGGESTIONS_MAX = 5;

/**
 * The product being typed at the end of an entry, read as `parseEntry` would
 * read it: `before` is the items typed ahead of it, `key` what is typed of its
 * name, folded, and `whole` the same with its quantity's words, for a product
 * whose name begins with them ("yarım ya" is the start of Yarım yağlı süt).
 */
export interface TypedProduct {
  before: string;
  quantity: Quantity;
  key: string;
  whole: string;
}

/** `null` while too little of a product is typed to suggest one. */
export function typedProduct(text: string): TypedProduct | null {
  const raw = text.split(SEPARATOR).at(-1)!;
  const segment = raw.trimStart().replace(ALSO, "");
  const { typed, leading } = readSegment(segment);
  const quantity = leading?.quantity;
  const key = foldName(quantity ? leading!.name : typed);
  if (Array.from(key).length < SUGGEST_FROM) return null;
  return {
    before: text.slice(0, text.length - raw.length),
    quantity: quantity ?? { quantityMilli: null, unit: null },
    key,
    whole: foldName(segment),
  };
}

/**
 * What a suggestion picked adds: the items typed before it, and the product
 * under the name it is stored with — handed over whole, since read back as
 * text "Tuz ve karabiber" would be two items.
 */
export function pickEntries(typed: TypedProduct, name: string): Entry[] {
  const named = foldName(name).startsWith(typed.whole);
  return [...parseEntry(typed.before), { name, ...(named ? { quantityMilli: null, unit: null } : typed.quantity) }];
}

/**
 * What to offer: products whose name begins with what is typed — with its
 * quantity's words first, then without — and then those with a later word
 * that does ("pe" finds Beyaz peynir), each by how often it was had; `known`
 * comes latest first, which settles a tie. What the list holds is left out
 * unless a quantity is typed, which the merge (2.5) gives it; without one, a
 * tap on it would do nothing.
 */
export function suggestProducts(known: readonly KnownProduct[], typed: TypedProduct, listed: readonly Entry[]): KnownProduct[] {
  const onList = new Set(typed.quantity.quantityMilli == null ? listed.map((entry) => foldName(entry.name)) : []);
  const rank = ({ key }: KnownProduct) => (key.startsWith(typed.whole) ? 0 : key.startsWith(typed.key) ? 1 : 2);
  return known
    .filter(({ key }) => (key.startsWith(typed.whole) || ` ${key}`.includes(` ${typed.key}`)) && !onList.has(key))
    .sort((a, b) => rank(a) - rank(b) || b.times - a.times)
    .slice(0, SUGGESTIONS_MAX);
}
