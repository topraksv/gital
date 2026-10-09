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
  restock: readonly {
    listId: string;
    listName: string;
    purchases: readonly Purchase[];
    onList: readonly { name: string }[];
    lasted: ReadonlyMap<string, readonly number[]>;
    /** Offers put aside on the list (SPEC 2.7): not rung either. */
    aside: ReadonlyMap<string, string>;
  }[];
}

export type Reminder =
  /** `lists` is what each list holds when planned: only the first can know, so later weeks carry none. */
  | { kind: "shopping"; at: Date; lists: { name: string; open: number }[] | null }
  | { kind: "expiry" | "wish"; at: Date; name: string; days: 0 | 1 }
  | { kind: "restock"; at: Date; name: string; listId: string; listName: string };

/** Where a tap on a reminder opens: what it is about, as Helix's `notificationRoute`. */
export type ReminderRoute = { pathname: "/" | "/pantry" | "/wishes" } | { pathname: "/list/[id]"; params: { id: string } };

export function routeOf(reminder: Reminder): ReminderRoute {
  switch (reminder.kind) {
    case "shopping":
      return { pathname: "/" };
    case "expiry":
      return { pathname: "/pantry" };
    case "wish":
      return { pathname: "/wishes" };
    case "restock":
      return { pathname: "/list/[id]", params: { id: reminder.listId } };
  }
}

const TABS: ReadonlySet<unknown> = new Set(["/", "/pantry", "/wishes"]);

/**
 * The route a tapped notification carries, read as the OS hands it back: a
 * payload this build did not write, or an older one's, opens nothing. A list
 * gone since opens its screen, which goes back to the lists.
 */
export function tapRoute(data: unknown): ReminderRoute | null {
  const route = (data as { route?: { pathname?: unknown; params?: { id?: unknown } } } | null)?.route;
  if (TABS.has(route?.pathname)) return { pathname: route!.pathname as "/" | "/pantry" | "/wishes" };
  const id = route?.params?.id;
  return route?.pathname === "/list/[id]" && typeof id === "string" && id !== "" ? { pathname: "/list/[id]", params: { id } } : null;
}

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
  return restock.flatMap(({ listId, listName, purchases, onList, lasted, aside }): Reminder[] => {
    const said = new Set(restockDue(purchases, onList, now, lasted, aside).map((due) => due.key));
    const planned: Reminder[] = [];
    for (let day = 1; day <= HORIZON_DAYS; day += 1) {
      const at = morningOf(addDaysISO(today, day));
      for (const due of restockDue(purchases, onList, at, lasted, aside)) {
        if (said.has(due.key)) continue;
        said.add(due.key);
        planned.push({ kind: "restock", at, name: due.name, listId, listName });
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
