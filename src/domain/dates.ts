/**
 * Calendar days, Helix's (`src/domain/dates.ts`) in the part Gital uses: a
 * day is a local `YYYY-MM-DD` string and a month a `YYYY-MM` key, so no
 * time zone reaches a comparison.
 */

export type ISODate = string;
export type MonthKey = string;

const pad = (n: number) => String(n).padStart(2, "0");

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month);
}

export function todayISO(now: Date = new Date()): ISODate {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function monthKeyOf(date: ISODate): MonthKey {
  return date.slice(0, 7);
}

export function addMonthsToKey(key: MonthKey, delta: number): MonthKey {
  const total = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1 + delta;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** A month's days in a Monday-first grid, `null` in the cells before its first. */
export function monthCells(key: MonthKey): (ISODate | null)[] {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const lead = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  return [...Array<null>(lead).fill(null), ...Array.from({ length: daysIn(year, month) }, (_, at) => `${key}-${pad(at + 1)}`)];
}

/** Whole days from `a` to `b`, measured at noon so a clock change moves nothing. */
export function daysBetweenISO(a: ISODate, b: ISODate): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}
