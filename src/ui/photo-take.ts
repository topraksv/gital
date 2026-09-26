/**
 * Taking a photo for an item or a wish (SPEC 8.2), and shrinking it before it
 * is stored. Its own chunk on the web, as the calculator's pad is
 * (`./photo-field.tsx` loads it), so the entry carries neither library.
 */

import { launchCameraAsync, launchImageLibraryAsync, requestCameraPermissionsAsync } from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import type { NewPhoto } from "../data/photos";

/**
 * The longest edge kept, and a row tile's. 1024 shows a label's print across
 * a phone's panel; stored as base64 it is ~100 KB, where a camera's own
 * 12-megapixel file is ~3 MB and would weigh on every sync to come.
 */
export const PHOTO_EDGE = 1024;
export const THUMB_EDGE = 160;
// JPEG quality, the usual web compromise; the owner's phone test at the
// project's end is where it is measured against a price label's print.
const QUALITY = 0.7;

/** What a take came to: a photo, nothing chosen, or the camera refused. */
export type Taken = NewPhoto | "cancelled" | "denied";

/** One edge given, so the other follows the photo's own proportions; never enlarged. */
export function edgeOf(width: number, height: number, edge: number): { width: number } | { height: number } {
  return width >= height ? { width: Math.min(width, edge) } : { height: Math.min(height, edge) };
}

async function shrunk(uri: string, width: number, height: number, edge: number): Promise<string> {
  const image = await ImageManipulator.manipulate(uri).resize(edgeOf(width, height, edge)).renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: QUALITY, base64: true });
  if (!saved.base64) throw new Error("The photo was not encoded");
  return `data:image/jpeg;base64,${saved.base64}`;
}

export default async function takePhoto(from: "camera" | "library"): Promise<Taken> {
  if (from === "camera" && !(await requestCameraPermissionsAsync()).granted) return "denied";
  // The library needs no permission: the system's own picker hands over only what was chosen.
  const launch = from === "camera" ? launchCameraAsync : launchImageLibraryAsync;
  const picked = await launch({ mediaTypes: ["images"], quality: 1 });
  const asset = picked.canceled ? null : picked.assets[0];
  if (!asset) return "cancelled";
  const [data, thumb] = await Promise.all([
    shrunk(asset.uri, asset.width, asset.height, PHOTO_EDGE),
    shrunk(asset.uri, asset.width, asset.height, THUMB_EDGE),
  ]);
  return { data, thumb };
}
