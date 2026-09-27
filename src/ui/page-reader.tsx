/**
 * The web build reads no shop's page: the browser refuses another site's HTML
 * (CORS), and the shops' bot walls refuse a server (`./page-reader.native.tsx`).
 * A link added here is filled on the phone the next time its wish is saved.
 */

export function PageReaderHost() {
  return null;
}

export function readLinkPages(_wishId: string): void {}
