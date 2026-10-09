/** The web holds nothing: `stay-awake.ts` says why, and `screen-hold.native.ts` is the phone's. */
export function stayAwake(): () => void {
  return () => {};
}
