/**
 * The reminders a phone is given (`docs/SPEC.md` 12.1, 12.3), planned from
 * what is on the device. Helix's scheme: every plan replaces the last, so a
 * reminder is only ever what is ahead within the horizon, and the next plan
 * — whenever the app leaves the screen — brings the rest. The words are the
 * service's; this says what and when.
 */

import { addDaysISO, todayISO, type ISODate } from "./dates";
import { restockDue, type Purchase } from "./restock";

/** A pantry date or a restock is said in the morning, before a shop. */
export const REMINDER_HOUR = 9;
const HORIZON_DAYS = 14;
/** iOS keeps 64 pending local notifications and silently drops the rest (Helix). */
export const REMINDERS_MAX = 60;

/** A day of the week as `Date.getDay` counts it, 0 Sunday, and a time. */
export interface ShoppingDay {
  weekday: number;
  hour: number;
  minute: number;
}

export interface ReminderInput {
  now: Date;
  shoppingDay: ShoppingDay | null;
  lists: readonly { name: string; open: number }[];
  pantry: readonly { name: string; expiresOn: ISODate | null }[];
  /** A wish's "şu tarihe kadar" (SPEC 7.1); one bought is past wanting. */
  wishes: readonly { name: string; dueOn: ISODate | null; boughtAt: string | null }[];
  restock: readonly { listName: string; purchases: readonly Purchase[]; onList: readonly { name: string }[]; lasted: ReadonlyMap<string, readonly number[]> }[];
}

export type Reminder =
  /** `lists` is what each list holds when planned: only the first can know, so later weeks carry none. */
  | { kind: "shopping"; at: Date; lists: { name: string; open: number }[] | null }
  | { kind: "expiry" | "wish"; at: Date; name: string; days: 0 | 1 }
  | { kind: "restock"; at: Date; name: string; listName: string };

function morningOf(day: ISODate): Date {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, date, REMINDER_HOUR);
}

function shoppingDays({ now, shoppingDay, lists }: ReminderInput, until: Date): Reminder[] {
  if (!shoppingDay) return [];
  const { weekday, hour, minute } = shoppingDay;
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((weekday - now.getDay() + 7) % 7), hour, minute);
  if (first <= now) first.setDate(first.getDate() + 7);
  const planned: Reminder[] = [];
  for (const at = first; at <= until; at.setDate(at.getDate() + 7)) {
    planned.push({ kind: "shopping", at: new Date(at), lists: planned.length === 0 ? lists.filter((list) => list.open > 0) : null });
  }
  return planned;
}

/** A date is said the morning before, or that morning once the one before has passed. */
function dated(kind: "expiry" | "wish", now: Date, dates: readonly { name: string; on: ISODate | null }[]): Reminder[] {
  return dates.flatMap(({ name, on }): Reminder[] => {
    if (!on) return [];
    const before = morningOf(addDaysISO(on, -1));
    if (before > now) return [{ kind, at: before, name, days: 1 }];
    const that = morningOf(on);
    return that > now ? [{ kind, at: that, name, days: 0 }] : [];
  });
}

/** Each morning ahead, what has newly run out by then; what is due already was offered on the list. */
function restocks({ now, restock }: ReminderInput): Reminder[] {
  const today = todayISO(now);
  return restock.flatMap(({ listName, purchases, onList, lasted }): Reminder[] => {
    const said = new Set(restockDue(purchases, onList, now, lasted).map((due) => due.key));
    const planned: Reminder[] = [];
    for (let day = 1; day <= HORIZON_DAYS; day += 1) {
      const at = morningOf(addDaysISO(today, day));
      for (const due of restockDue(purchases, onList, at, lasted)) {
        if (said.has(due.key)) continue;
        said.add(due.key);
        planned.push({ kind: "restock", at, name: due.name, listName });
      }
    }
    return planned;
  });
}

export function planReminders(input: ReminderInput): Reminder[] {
  const until = new Date(input.now);
  until.setDate(until.getDate() + HORIZON_DAYS);
  const expiries = dated("expiry", input.now, input.pantry.map(({ name, expiresOn }) => ({ name, on: expiresOn })));
  const wishes = dated("wish", input.now, input.wishes.map(({ name, dueOn, boughtAt }) => ({ name, on: boughtAt == null ? dueOn : null })));
  return [...shoppingDays(input, until), ...expiries, ...wishes, ...restocks(input)]
    .filter((reminder) => reminder.at > input.now && reminder.at <= until)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, REMINDERS_MAX);
}
