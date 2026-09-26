/** What the pantry holds of a product (SPEC 12.8): the sum of what arrived and what was used. */

import { foldName, stepQuantity, type Unit } from "./items";

export interface Stock {
  quantityMilli: number;
  unit: Unit;
}

/** Units one amount can be counted in, and how many of the smallest each is. */
const MEASURE: Record<Unit, { kind: string; scale: number }> = {
  adet: { kind: "adet", scale: 1 },
  paket: { kind: "paket", scale: 1 },
  kg: { kind: "mass", scale: 1000 },
  g: { kind: "mass", scale: 1 },
  lt: { kind: "volume", scale: 1000 },
  ml: { kind: "volume", scale: 1 },
};

/**
 * What the moves leave, oldest first, in the unit held: a kilo arriving over
 * grams is counted as grams. An arrival that cannot be counted so — pieces
 * over kilos — starts the count afresh rather than adding apples to weight,
 * and so does anything arriving after the count reached nothing. `null` is
 * nothing at home.
 */
export function stockOf(moves: readonly Stock[]): Stock | null {
  return moves.reduce<Stock | null>(counted, null);
}

function counted(stock: Stock | null, move: Stock): Stock | null {
  const from = MEASURE[move.unit];
  const to = stock == null ? null : MEASURE[stock.unit];
  const next: Stock = stock != null && to?.kind === from.kind
    ? { quantityMilli: stock.quantityMilli + Math.round((move.quantityMilli * from.scale) / to.scale), unit: stock.unit }
    : move;
  return next.quantityMilli > 0 ? next : null;
}

/**
 * How long each stay at home lasted, in milliseconds, oldest first (SPEC
 * 12.7): from the move that filled an empty pantry to the one that emptied
 * it. A top-up is the same stay, and one still going is not measured.
 */
export function lastedOf(moves: readonly (Stock & { at: string })[]): number[] {
  const lasted: number[] = [];
  let stock: Stock | null = null;
  let since = 0;
  for (const move of moves) {
    const next = counted(stock, move);
    if (!stock && next) since = Date.parse(move.at);
    if (stock && !next) lasted.push(Date.parse(move.at) - since);
    stock = next;
  }
  return lasted;
}

/** What an entry adds that is already at home (SPEC 12.6), matched as 2.5 merges: by the folded name. */
export function atHome<T extends { name: string }>(pantry: readonly T[], added: readonly { name: string }[]): T[] {
  const keys = new Set(added.map((entry) => foldName(entry.name)));
  return pantry.filter((item) => keys.has(foldName(item.name)));
}

/** The move one press of − makes: down to the unit's step below, or all of it when that is nothing (12.8). */
export function lessOf(stock: Stock): Stock {
  const next = stepQuantity(stock, -1);
  return { quantityMilli: (next?.quantityMilli ?? 0) - stock.quantityMilli, unit: stock.unit };
}
