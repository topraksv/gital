/**
 * What follows the person to every device (`docs/ARCHITECTURE.md`, "Tables"),
 * Helix's key and JSON value: whether the account is frozen (SPEC 9.1), which
 * is why a frozen account locks every device, the name a shared list's
 * other members see (SPEC 1.4), and each device's last sign-in (SPEC 9.4).
 */

import { isNull } from "drizzle-orm";
import { getDb, getSqliteAsync } from "../db/client";
import { deterministicId, naturalKeys } from "../db/ids";
import { actingUser, editRow, findRow, writeRows, type RowSnapshot, type RowWrite } from "../db/mutations";
import { settings } from "../db/schema";
import { LOGIN_KEY_PREFIX, type DeviceLogin } from "../domain/logins";
import { nameFrom } from "../domain/names";
import type { LiveResult } from "./live-query";

const ACCOUNT_FROZEN = "account_frozen";
const MEMBER_NAME = "member_name";

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

async function settingWrite(key: string, json: unknown): Promise<RowWrite[]> {
  const id = await deterministicId(naturalKeys.setting(key));
  const value = JSON.stringify(json);
  const there = await findRow("settings", id);
  return there ? editRow("settings", there, { value, deletedAt: null }) : [{ table: "settings", row: { id, key, value, deletedAt: null } }];
}

const writeSetting = (key: string, json: unknown) => writeRows(() => settingWrite(key, json));

export const setAccountFrozen = (frozen: boolean) => writeSetting(ACCOUNT_FROZEN, frozen);

/**
 * The name, and every shared list's row that shows it: a member row keeps the
 * name it was made with, so a correction that stopped at the setting would
 * never reach the others. The server lets a person change only their own
 * (`guard_list_member`), which is all this writes.
 */
export async function setMemberName(input: string): Promise<void> {
  const name = nameFrom(input);
  if (name == null) throw new Error("A member needs a name");
  await writeRows(async () => {
    const sqlite = await getSqliteAsync();
    const mine = await sqlite.getAllAsync<RowSnapshot>("SELECT * FROM list_members WHERE user_id = ? AND deleted_at IS NULL", [actingUser()]);
    return [...(await settingWrite(MEMBER_NAME, name)), ...mine.flatMap((row) => editRow("list_members", row, { name }))];
  });
}

export const recordDeviceLogin = (device: string, login: DeviceLogin) => writeSetting(LOGIN_KEY_PREFIX + device, login);
