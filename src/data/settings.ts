/**
 * What follows the person to every device (`docs/ARCHITECTURE.md`, "Tables"),
 * Helix's key and JSON value: whether the account is frozen (SPEC 9.1), which
 * is why a frozen account locks every device, the name a shared list's
 * other members see (SPEC 1.4), each device's last sign-in (SPEC 9.4), and
 * the order of the person's lists (SPEC 1.1).
 */

import { isNull } from "drizzle-orm";
import { getDb, getSqliteAsync } from "../db/client";
import { deterministicId, naturalKeys } from "../db/ids";
import { actingUser, editRow, findRow, nowIso, writeRows, type RowSnapshot, type RowWrite } from "../db/mutations";
import { settings } from "../db/schema";
import { LIST_ORDER } from "../domain/lists";
import { LOGIN_KEY_PREFIX, type DeviceLogin } from "../domain/logins";
import { nameFrom } from "../domain/names";
import type { LiveResult } from "./live-query";

const ACCOUNT_FROZEN = "account_frozen";
const MEMBER_NAME = "member_name";
const RESTOCK_ASIDE = "restock_aside:";
/**
 * The newest this many stay: the server takes a setting of 10,000 characters
 * at most, and an entry is a name of up to 60 and its time. One dropped was
 * put aside longest ago, and may be offered again.
 */
export const RESTOCK_ASIDE_MAX = 80;

export interface Setting {
  key: string;
  /** JSON, as written. */
  value: string;
}

export function readSettings(): Promise<Setting[]> {
  return getDb().select({ key: settings.key, value: settings.value }).from(settings).where(isNull(settings.deletedAt));
}

export const isFrozen = (all: readonly Setting[]) => all.some(({ key, value }) => key === ACCOUNT_FROZEN && value === "true");

/**
 * What the lock reads from the live settings: `null` until the device knows,
 * so a frozen account's lists never show for a frame. A read that failed opens
 * the app, whose screens then say what failed, rather than a blank for ever.
 */
export function frozenFrom({ data, status, updatedAt }: Pick<LiveResult<Setting>, "data" | "status" | "updatedAt">): boolean | null {
  if (updatedAt) return isFrozen(data);
  return status === "error" ? false : null;
}

/** The name this person joins and invites under, once they have given one. */
export function memberNameOf(all: readonly Setting[]): string | null {
  const value = all.find(({ key }) => key === MEMBER_NAME)?.value;
  return value == null ? null : (JSON.parse(value) as string);
}

/** The restock offers put aside on a list (SPEC 2.7): when, by folded name. */
export function restockAsideOf(all: readonly Setting[], listId: string): Map<string, string> {
  const value = all.find(({ key }) => key === RESTOCK_ASIDE + listId)?.value;
  return new Map(value == null ? [] : Object.entries(JSON.parse(value) as Record<string, string>));
}

async function settingWrite(key: string, json: unknown): Promise<RowWrite[]> {
  const id = await deterministicId(naturalKeys.setting(key));
  const value = JSON.stringify(json);
  const there = await findRow("settings", id);
  return there ? editRow("settings", there, { value, deletedAt: null }) : [{ table: "settings", row: { id, key, value, deletedAt: null } }];
}

const writeSetting = (key: string, json: unknown) => writeRows(() => settingWrite(key, json));

/** Read inside the write, so another device's dismissal that synced meanwhile is kept. */
export const putRestockAside = (listId: string, key: string) =>
  writeRows(async () => {
    const there = await findRow("settings", await deterministicId(naturalKeys.setting(RESTOCK_ASIDE + listId)));
    const was = there && there.deleted_at == null ? (JSON.parse(String(there.value)) as Record<string, string>) : {};
    const kept = Object.entries({ ...was, [key]: nowIso() })
      .sort(([, a], [, b]) => b.localeCompare(a))
      .slice(0, RESTOCK_ASIDE_MAX);
    return settingWrite(RESTOCK_ASIDE + listId, Object.fromEntries(kept));
  });

export const setAccountFrozen = (frozen: boolean) => writeSetting(ACCOUNT_FROZEN, frozen);
export const setListOrder = (ids: readonly string[]) => writeSetting(LIST_ORDER, ids);

/**
 * The name, and every shared list's row that shows it: a member row keeps the
 * name it was made with, so a correction that stopped at the setting would
 * never reach the others. The server lets a person change only their own
 * (`guard_list_member`), which is all this writes.
 */
export async function setMemberName(input: string): Promise<void> {
  const name = nameFrom(input);
  if (name == null) throw new Error("A member needs a name");
  await writeRows(async () => [...(await settingWrite(MEMBER_NAME, name)), ...(await rowsRenamed(name))]);
}

async function rowsRenamed(name: string): Promise<RowWrite[]> {
  const sqlite = await getSqliteAsync();
  const mine = await sqlite.getAllAsync<RowSnapshot>("SELECT * FROM list_members WHERE user_id = ? AND deleted_at IS NULL", [actingUser()]);
  return mine.flatMap((row) => editRow("list_members", row, { name }));
}

/**
 * After a pull, the person's member rows are brought to the name the setting
 * holds. A row the server made meanwhile — the owner's, by sharing, or a join
 * on another device — arrives with the old name, and a device behind on a
 * rename sends the old name back when it marks a list seen, since an edit
 * sends the whole row. Sending `seen_at` alone was rejected: the outbox keeps
 * only a row's newest event, which would drop an earlier edit's columns.
 */
export const keepMemberName = () =>
  writeRows(async () => {
    const there = await findRow("settings", await deterministicId(naturalKeys.setting(MEMBER_NAME)));
    return there && there.deleted_at == null ? rowsRenamed(JSON.parse(String(there.value)) as string) : [];
  });

export const recordDeviceLogin = (device: string, login: DeviceLogin) => writeSetting(LOGIN_KEY_PREFIX + device, login);
