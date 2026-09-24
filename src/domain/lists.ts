/** What a list's name and face are, apart from where they are stored or drawn. */

/** Long enough for "Haftalık market — Kadıköy", short enough to stay on a card. */
export const LIST_NAME_MAX = 60;

/**
 * What a typed name is stored as: whitespace runs folded to one space, ends
 * trimmed, cut at the limit by character rather than by UTF-16 unit, so an
 * emoji at the edge is kept or dropped whole. Half an emoji is dropped: the
 * field's own limit counts UTF-16 units, and a paste cut there can leave one.
 * `null` when nothing is left.
 */
export function listNameFrom(input: string): string | null {
  const whole = Array.from(input)
    .filter((char) => !/^[\uD800-\uDFFF]$/.test(char))
    .join("");
  const name = whole.replace(/\s+/g, " ").trim();
  if (name === "") return null;
  return Array.from(name).slice(0, LIST_NAME_MAX).join("");
}

/** The letter a list's tile shows until it has a picture (`docs/UI.md` section 6). */
export function listInitial(name: string): string {
  return (Array.from(name)[0] ?? "").toLocaleUpperCase("tr-TR");
}

/**
 * Which of `count` tones a list's tile wears, from its id, so it holds on
 * every device and every launch until the list is given a colour of its own
 * (`docs/SPEC.md` 1.8).
 */
export function listTone(id: string, count: number): number {
  let sum = 0;
  for (let at = 0; at < id.length; at++) sum += id.charCodeAt(at);
  return sum % count;
}
