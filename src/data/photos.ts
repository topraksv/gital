/**
 * A photo on an item or a wish (SPEC 7.1, 8.2), kept on the device beside the
 * row that names it (`src/db/schema.ts` `photos`).
 */

import { uuidv7 } from "uuidv7";
import { getSqliteAsync } from "../db/client";
import { nowIso } from "../db/mutations";

/** A photo the app took and shrank (`src/ui/photo-picker.ts`), both sizes as JPEG data URIs. */
export interface NewPhoto {
  data: string;
  thumb: string;
}

/** What a panel's save does to a photo: a new one, `null` to take it off, left out to keep it. */
export type PhotoChange = NewPhoto | null | undefined;

// Only what the app itself encoded is drawn: a row's photo is an image source,
// and one arriving by sync must not name a remote address or a script.
const JPEG_DATA = /^data:image\/jpeg;base64,[A-Za-z0-9+/=_-]+$/;

/**
 * Inside a write's transaction: the column a save writes for its photo
 * change, storing a new photo first. Nothing is written for a photo left out.
 */
export async function photoColumn(change: PhotoChange): Promise<{ photoId?: string | null }> {
  if (change === undefined) return {};
  if (change === null) return { photoId: null };
  if (!JPEG_DATA.test(change.data) || !JPEG_DATA.test(change.thumb)) throw new Error("Not a photo the app took");
  const id = uuidv7();
  const sqlite = await getSqliteAsync();
  await sqlite.runAsync("INSERT INTO photos (id, data, thumb, created_at) VALUES (?, ?, ?, ?)", [id, change.data, change.thumb, nowIso()]);
  return { photoId: id };
}

/** The full photo, or `null` where it has not reached this device. */
export async function readPhoto(id: string): Promise<string | null> {
  const sqlite = await getSqliteAsync();
  return (await sqlite.getFirstAsync<{ data: string }>("SELECT data FROM photos WHERE id = ?", [id]))?.data ?? null;
}
