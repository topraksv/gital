/**
 * The keys react-native-web leaves out (`docs/BACKLOG.md` had both): its press
 * handling takes Space only on a button, so a checkbox and a switch answered
 * Enter alone, and an `adjustable` view's increment and decrement reach a
 * screen reader but never the arrow keys. React Native types no key handler,
 * so the handler is spread in as a web-only prop.
 */

type Key = { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; repeat: boolean; preventDefault: () => void };

/**
 * A `keydown` handler running the action `actions` names for the key. Held
 * with a modifier the key is the browser's; `repeats: false` makes a held key
 * act once, as a toggle must.
 */
export function keyHandler(actions: Partial<Record<string, () => void>>, { repeats = true } = {}): (event: Key) => void {
  return (event) => {
    const action = actions[event.key];
    if (!action || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    if (repeats || !event.repeat) action();
  };
}

/** `keyHandler` as a prop on the web, and nothing on a phone, whose keys are its screen reader's. */
export function webKeys(actions: Partial<Record<string, () => void>>, options?: { repeats: boolean }): object {
  return typeof document === "undefined" ? {} : { onKeyDown: keyHandler(actions, options) };
}
