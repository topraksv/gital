/**
 * The keys react-native-web leaves out (`src/ui/keys.ts`): Space on a
 * checkbox or a switch, the arrows on a sort grip. A key the map names is
 * taken, so the page does not scroll under it; any other passes through.
 */

import { describe, expect, it, vi } from "vitest";

import { keyHandler } from "../../src/ui/keys";

const press = (key: string, extra: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; repeat: boolean }> = {}) => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  repeat: false,
  ...extra,
  preventDefault: vi.fn(),
});

describe("keyHandler", () => {
  it("runs the named key's action and keeps the page from scrolling", () => {
    const up = vi.fn();
    const event = press("ArrowUp");
    keyHandler({ ArrowUp: up })(event);
    expect(up).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("lets every other key through untouched", () => {
    const up = vi.fn();
    const event = press("Tab");
    keyHandler({ ArrowUp: up })(event);
    expect(up).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("leaves a key held with a modifier to the browser", () => {
    const toggle = vi.fn();
    for (const modifier of ["altKey", "ctrlKey", "metaKey"] as const) keyHandler({ " ": toggle })(press(" ", { [modifier]: true }));
    expect(toggle).not.toHaveBeenCalled();
  });

  it("presses a toggle once however long Space is held", () => {
    const toggle = vi.fn();
    const held = press(" ", { repeat: true });
    keyHandler({ " ": toggle }, { repeats: false })(held);
    expect(toggle).not.toHaveBeenCalled();
    expect(held.preventDefault).toHaveBeenCalledOnce();
  });
});
