/**
 * The web has no scanner (SPEC 2.8): a browser's camera needs a decoding
 * library in the page, which the phone app, where shopping happens, does not
 * need. `barcode-scan.native.ts` is the phone's.
 */

export const canScan = false;

export function onScanned(_read: (code: string) => void): () => void {
  return () => {};
}

export async function launchScanner(): Promise<boolean> {
  return false;
}
