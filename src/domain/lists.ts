/**
 * What a list may look like (`docs/SPEC.md` 1.8). What is stored is a name
 * from these sets, never a colour value or a file: `src/ui/theme.ts` owns what
 * each colour is in light and dark, and `src/ui/list-look.ts` which picture
 * each name draws — so a palette can change without stranding a stored hex.
 * Ported from Helix's `matrix-colors.ts`.
 */

import { foldName } from "./items";

// Named for their hue, which is the only thing a name can promise; six, each
// measured at least 11.9 ΔE from the nearest in light and 16 in dark.
export const LIST_COLORS = ["terracotta", "mustard", "green", "teal", "lavender", "rose"] as const;
export type ListColor = (typeof LIST_COLORS)[number];

// Noto Emoji 2D (SPEC 11.9), one for each kind of list a household keeps.
export const LIST_ICONS = [
  "cart",
  "vegetables",
  "fruit",
  "bakery",
  "breakfast",
  "meat",
  "fish",
  "coffee",
  "dessert",
  "care",
  "cleaning",
  "laundry",
  "pharmacy",
  "baby",
  "pet",
  "home",
  "hardware",
  "garden",
  "gift",
  "party",
] as const;
export type ListIcon = (typeof LIST_ICONS)[number];

/**
 * A stored value this build can draw, or `null`, which draws the default. A
 * newer device may store one this build does not know; reading it as none
 * keeps the list on screen rather than failing it.
 */
export function knownOf<T extends string>(set: readonly T[], value: unknown): T | null {
  return set.includes(value as T) ? (value as T) : null;
}

/** What the list panel saves (SPEC 1.1, 1.8). */
export interface ListLook {
  name: string;
  color: ListColor | null;
  icon: ListIcon | null;
}

/** A stored row's colour and picture, as this build can draw them. */
export function lookOf<T extends { color: string | null; icon: string | null }>(row: T): Omit<T, "color" | "icon"> & Omit<ListLook, "name"> {
  return { ...row, color: knownOf(LIST_COLORS, row.color), icon: knownOf(LIST_ICONS, row.icon) };
}

/**
 * The words that say what a list is for, folded, each with the picture it
 * draws. A word of four letters or more also names its longer forms
 * ("balıkçı", "partisi"); a shorter one only itself, or "et" would be half
 * the language.
 */
export const NAME_WORDS: readonly (readonly [ListIcon, readonly string[]])[] = [
  ["cart", ["market", "supermarket", "bakkal", "alisveris"]],
  ["vegetables", ["pazar", "manav", "sebze"]],
  ["fruit", ["meyve"]],
  ["bakery", ["firin", "ekmek", "pastane"]],
  ["breakfast", ["kahvalti"]],
  ["meat", ["kasap", "et", "tavuk"]],
  ["fish", ["balik"]],
  ["coffee", ["kahve", "cay"]],
  ["dessert", ["tatli", "pasta"]],
  ["care", ["bakim", "kozmetik", "kisisel"]],
  ["cleaning", ["temizlik", "deterjan"]],
  ["laundry", ["camasir"]],
  ["pharmacy", ["eczane", "ilac"]],
  ["baby", ["bebek"]],
  ["pet", ["kedi", "kopek", "mama", "evcil"]],
  ["home", ["ev"]],
  ["hardware", ["nalbur", "hirdavat", "yapi"]],
  ["garden", ["bahce", "cicek", "fidan"]],
  ["gift", ["hediye"]],
  ["party", ["parti", "kutlama", "mangal"]],
];

/**
 * The picture a new list's name says (the owner asked 2026-09-27: "pazar
 * diyince ona göre default bir logo gelsin"), from its first word that says
 * one; the list panel changes it as any other. `null` draws the default.
 */
export function iconForName(name: string): ListIcon | null {
  for (const [word] of foldName(name).matchAll(/\p{L}+/gu)) {
    for (const [icon, words] of NAME_WORDS) {
      if (words.some((key) => word === key || (key.length >= 4 && word.startsWith(key)))) return icon;
    }
  }
  return null;
}
