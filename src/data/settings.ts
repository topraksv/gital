/**
 * What follows the person to every device (`docs/ARCHITECTURE.md`, "Tables"),
 * Helix's key and JSON value. Today that is only whether the account is
 * frozen (SPEC 9.1), which is why a frozen account locks every device.
 */

import { isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { deterministicId, naturalKeys } from "../db/ids";
import { editRow, findRow, writeRows } from "../db/mutations";
import { settings } from "../db/schema";
import type { LiveResult } from "./live-query";

const ACCOUNT_FROZEN = "account_frozen";

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

export async function setAccountFrozen(frozen: boolean): Promise<void> {
  const id = await deterministicId(naturalKeys.setting(ACCOUNT_FROZEN));
  const value = JSON.stringify(frozen);
  await writeRows(async () => {
    const there = await findRow("settings", id);
    return there ? editRow("settings", there, { value, deletedAt: null }) : [{ table: "settings" as const, row: { id, key: ACCOUNT_FROZEN, value, deletedAt: null } }];
  });
}
