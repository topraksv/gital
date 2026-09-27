/**
 * Where the account last signed in (SPEC 9.4). Each device keeps one setting
 * of its own, `login.<device>`, so two devices signing in at once never write
 * the same row, and the account screen reads them all: another device's
 * latest sign-in, or this device's one before the present session.
 */

export const LOGIN_KEY_PREFIX = "login.";

export interface DeviceLogin {
  at: string;
  /** This device's sign-in before `at`, which the account screen shows here. */
  previous: string | null;
  device: string | null;
}

const SYSTEMS: readonly [RegExp, string][] = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/CrOS/, "ChromeOS"],
  [/Macintosh|Mac OS X/, "Mac"],
  [/Windows/, "Windows"],
  [/Linux/, "Linux"],
];

// Order matters: Edge and Opera say Chrome, and Chrome says Safari.
const BROWSERS: readonly [RegExp, string][] = [
  [/Edg(A|iOS)?\//, "Edge"],
  [/OPR\//, "Opera"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const first = (table: readonly [RegExp, string][], agent: string) => table.find(([pattern]) => pattern.test(agent))?.[1];

/** "iPhone · Safari" from a browser's user agent; `null` when it names neither. */
export function deviceFromAgent(agent: string): string | null {
  const named = [first(SYSTEMS, agent), first(BROWSERS, agent)].filter(Boolean);
  return named.length > 0 ? named.join(" · ") : null;
}

function parse(value: string): DeviceLogin | null {
  try {
    const login = JSON.parse(value) as Partial<DeviceLogin> | null;
    return typeof login?.at === "string" ? { at: login.at, previous: login.previous ?? null, device: login.device ?? null } : null;
  } catch {
    return null;
  }
}

/** The account's sign-in before this session, and on which device. */
export function lastLogin(
  settings: readonly { key: string; value: string }[],
  thisDevice: string,
): { at: string; device: string | null; here: boolean } | null {
  let latest: { at: string; device: string | null; here: boolean } | null = null;
  for (const { key, value } of settings) {
    if (!key.startsWith(LOGIN_KEY_PREFIX)) continue;
    const login = parse(value);
    const here = key === LOGIN_KEY_PREFIX + thisDevice;
    const at = here ? login?.previous : login?.at;
    if (login && at && (!latest || at > latest.at)) latest = { at, device: login.device, here };
  }
  return latest;
}

/** What the account screen names a device by: the browser on the web, the phone in the app. */
export function deviceName({ os, isPad, model, agent }: { os: string; isPad: boolean; model?: string; agent?: string }): string | null {
  if (os === "web") return agent ? deviceFromAgent(agent) : null;
  if (os === "ios") return isPad ? "iPad" : "iPhone";
  return model ? `Android · ${model}` : "Android";
}
