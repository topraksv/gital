/**
 * Photos beside the rows (SPEC 8.2; decision of 2026-09-23): each is two JPEGs
 * in the private `photos` bucket, `<photo id>/full.jpg` and `…/thumb.jpg`,
 * which whoever can read a row naming it may read. A photo is never edited —
 * a new one is a new id — so each is sent once and fetched once.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSqliteAsync } from "../db/client";
import { nowIso } from "../db/mutations";
import { isUuidShaped } from "./merge-policy";
import { SessionEpochCancelledError } from "./session-epoch";
import { getSupabase } from "./supabase";

const BUCKET = "photos";
const SIZES = [
  ["full", "data"],
  ["thumb", "thumb"],
] as const;

/** The photos a live item or wish names. */
const NAMED = "SELECT photo_id FROM items WHERE deleted_at IS NULL UNION SELECT photo_id FROM wishes WHERE deleted_at IS NULL";

/** Photos Storage answered for with no file, not asked again until the next launch. */
const unavailable = new Set<string>();

function bytesOf(dataUri: string): Uint8Array {
  const binary = atob(dataUri.slice(dataUri.indexOf(",") + 1));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/** React Native's Blob has no `arrayBuffer`; its FileReader does the same work natively. */
function base64OfBlob(blob: Blob): Promise<string> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer().then((buffer) => base64Of(new Uint8Array(buffer)));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => (reader.error ? reject(reader.error) : resolve(String(reader.result).slice(String(reader.result).indexOf(",") + 1)));
    reader.readAsDataURL(blob);
  });
}

/**
 * A row's photo is drawn as an image source, and the file came from whoever
 * shared the list: only a JPEG — FF D8 FF, `/9j/` in base64 — becomes one.
 */
function jpegDataUri(base64: string): string | null {
  return base64.startsWith("/9j/") && /^[A-Za-z0-9+/=]+$/.test(base64) ? `data:image/jpeg;base64,${base64}` : null;
}

function checkActive(signal: AbortSignal): void {
  if (signal.aborted) throw new SessionEpochCancelledError();
}

/** Send every photo a live row names and Storage does not have yet. */
export async function sendPendingPhotos(supabase: SupabaseClient, signal: AbortSignal): Promise<void> {
  const sqlite = await getSqliteAsync();
  const pending = await sqlite.getAllAsync<{ id: string; data: string; thumb: string }>(
    `SELECT id, data, thumb FROM photos WHERE uploaded_at IS NULL AND id IN (${NAMED})`,
  );
  // Every id here is the device's own, or one a fetch below checked.
  for (const photo of pending) {
    for (const [size, column] of SIZES) {
      checkActive(signal);
      // `upsert`, so a send cut short between the two sizes is finished by the next.
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(`${photo.id}/${size}.jpg`, bytesOf(photo[column]), { contentType: "image/jpeg", upsert: true });
      if (error) throw new Error(`photo upload: ${error.message}`);
    }
    await sqlite.runAsync("UPDATE photos SET uploaded_at = ? WHERE id = ?", [nowIso(), photo.id]);
  }
}

async function download(supabase: SupabaseClient, path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) {
    // A 4xx is Storage answering: not there, or not this person's to read. A
    // network failure carries the field too, left undefined.
    if (error.status != null && error.status < 500) return null;
    throw new Error(`photo download: ${error.message}`);
  }
  return jpegDataUri(await base64OfBlob(data));
}

/** Fetch every photo a live row names that this device does not hold. */
export async function fetchMissingPhotos(supabase: SupabaseClient, signal: AbortSignal): Promise<void> {
  const sqlite = await getSqliteAsync();
  const missing = await sqlite.getAllAsync<{ id: string }>(
    `SELECT photo_id AS id FROM (${NAMED}) WHERE photo_id IS NOT NULL AND photo_id NOT IN (SELECT id FROM photos)`,
  );
  for (const { id } of missing) {
    if (!isUuidShaped(id) || unavailable.has(id)) continue;
    checkActive(signal);
    const [full, thumb] = await Promise.all(SIZES.map(([size]) => download(supabase, `${id}/${size}.jpg`)));
    if (!full || !thumb) {
      unavailable.add(id);
      continue;
    }
    checkActive(signal);
    const now = nowIso();
    await sqlite.runAsync("INSERT OR IGNORE INTO photos (id, data, thumb, created_at, uploaded_at) VALUES (?, ?, ?, ?, ?)", [id, full, thumb, now, now]);
  }
}

/**
 * Remove every photo the account sent, before the account goes: Storage keeps
 * a file its owner no longer exists for, and nothing cascades to it. The
 * device's copies are marked unsent, so if the account then survives, the
 * next sync sends them again.
 */
export async function purgeOwnPhotos(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { data, error } = await supabase.rpc("own_photo_objects");
  if (error) throw new Error(`photo purge: ${error.message}`);
  const paths = data as string[];
  for (let at = 0; at < paths.length; at += 100) {
    const { error: removal } = await supabase.storage.from(BUCKET).remove(paths.slice(at, at + 100));
    if (removal) throw new Error(`photo purge: ${removal.message}`);
  }
  const sqlite = await getSqliteAsync();
  await sqlite.runAsync("UPDATE photos SET uploaded_at = NULL");
}
