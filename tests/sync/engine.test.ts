/**
 * Sync (SPEC 10.2, 10.3, 12.9) end to end: two devices of one person, each a
 * real SQLite database under the real migrations and write layer, through the
 * shipped engine, against `fake-cloud.ts` — which keeps the server's clock,
 * its delete generations and its row rules. Only the network is a stand-in.
 *
 * The rule the outbox keeps, Helix's: a row leaves it only when the server
 * has said it has it, under the session that sent it.
 */

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeCloud } from "./fake-cloud";

const harness = vi.hoisted(() => ({ db: null as DatabaseSync | null, cloud: null as unknown as { client(): unknown } }));

vi.mock("../../src/db/client", async () => {
  const { sqliteClientMock } = await import("../helpers");
  return sqliteClientMock(() => harness.db!);
});
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: async (_algorithm: string, value: string) => createHash("sha256").update(value).digest("hex"),
}));
vi.mock("../../src/sync/supabase", () => ({ getSupabase: () => harness.cloud.client() }));

const { addEntries, addScanned, deleteItem, readItems, toggleChecked } = await import("../../src/data/items");
const { createList, editList, readLists } = await import("../../src/data/lists");
const { readProducts, setStarred } = await import("../../src/data/products");
const { readPantry } = await import("../../src/data/pantry");
const { finishShop, readShops, reopenShop } = await import("../../src/data/shops");
const { countDataReset, resetData } = await import("../../src/data/reset");
const { readPhoto } = await import("../../src/data/photos");
const { isFrozen, memberNameOf, readSettings, setAccountFrozen, setMemberName } = await import("../../src/data/settings");
const { fromDbShape, pendingOutboxCount, writeRows } = await import("../../src/db/mutations");
const { leaveList, markSeen, readFresh, readMembers, readSharedLists, removeMember, roleOf, rowPeople, setMemberRole } = await import(
  "../../src/data/members"
);
const { acceptInvite, createInvite, inviteFromPage, inviteLink, inviteTokenFrom } = await import("../../src/sync/sharing");
const { flushOutbox, scheduleSync, startSyncSession, stopSyncSession, syncNow } = await import("../../src/sync/engine");
const { dismissDeadLetter, readDeadLetters, retryDeadLetter } = await import("../../src/sync/dead-letters");
const { purgeOwnPhotos } = await import("../../src/sync/photos");
const { useSyncStatus } = await import("../../src/sync/status");
const { tr } = await import("../../src/i18n/tr");
const { migratedDatabase } = await import("../helpers");

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

let cloud: FakeCloud;
let devices: { A: DatabaseSync; B: DatabaseSync; C: DatabaseSync; D: DatabaseSync };
/** A and B are one person's two devices; C and D another person's. */
const OWNER_OF = { A: USER, B: USER, C: OTHER, D: OTHER } as const;

/** Work on one device, its sync session open for the length of it, as the app holds one while signed in. */
async function on<T>(device: keyof typeof devices, work: () => Promise<T>): Promise<T> {
  harness.db = devices[device];
  cloud.user = signedIn = OWNER_OF[device];
  startSyncSession(signedIn);
  try {
    return await work();
  } finally {
    await stopSyncSession();
  }
}

let signedIn = USER;
const sync = () => syncNow(signedIn);
const add = (listId: string, ...names: string[]) => addEntries(listId, names.map((name) => ({ name, quantityMilli: null, unit: null })));
const names = async (listId: string) => (await readItems(listId)).map((item) => item.name).sort();
const serverRow = (table: string, id: string) => cloud.rows(table).find((row) => row.id === id);
/** A JPEG as far as its first bytes go, which is as far as anything here reads. */
const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64")}`;

beforeEach(() => {
  cloud = new FakeCloud();
  cloud.user = USER;
  harness.cloud = cloud;
  devices = { A: migratedDatabase(), B: migratedDatabase(), C: migratedDatabase(), D: migratedDatabase() };
  useSyncStatus.getState().set({ state: "idle", error: null, lastSyncAt: null });
});

describe("two devices of one person", () => {
  it("brings the lists, what is on them and the person's products from one to the other", async () => {
    const listId = await on("A", async () => {
      const id = await createList("Market");
      await add(id, "süt", "elma");
      await setStarred("süt", true);
      expect(await sync()).toBe(true);
      expect(await pendingOutboxCount(), "what the server acknowledged has left the outbox").toBe(0);
      return id;
    });
    expect(cloud.rows("products").map((row) => row.user_id), "a personal row is keyed by its person").toEqual([USER]);
    expect(serverRow("lists", listId)?.owner_id).toBe(USER);

    await on("B", async () => {
      expect(await sync()).toBe(true);
      expect((await readLists()).map((list) => list.name)).toEqual(["Market"]);
      expect(await names(listId)).toEqual(["elma", "süt"]);
      expect(await readProducts()).toMatchObject([{ name: "süt", starred: true }]);
      expect(useSyncStatus.getState()).toMatchObject({ state: "idle", error: null });
      expect(useSyncStatus.getState().lastSyncAt).not.toBeNull();
    });
  });

  it("carries a frozen account to the person's other device, and its reopening back", async () => {
    await on("A", async () => {
      await setAccountFrozen(true);
      await sync();
    });
    expect(cloud.rows("settings").map((row) => row.user_id), "a setting is the person's own").toEqual([USER]);
    await on("B", async () => {
      await sync();
      expect(isFrozen(await readSettings())).toBe(true);
      await setAccountFrozen(false);
      await sync();
    });
    await on("A", async () => {
      await sync();
      expect(isFrozen(await readSettings())).toBe(false);
    });
  });

  it("settles two edits on the server's clock: the later write wins on both", async () => {
    const listId = await on("A", async () => {
      const id = await createList("Market");
      await sync();
      return id;
    });
    await on("B", sync);
    await on("A", async () => {
      await editList(listId, { name: "Pazar", color: null, icon: null });
      await sync();
    });
    await on("B", async () => {
      await editList(listId, { name: "Bakkal", color: null, icon: null });
      await sync();
      expect((await readLists())[0]?.name).toBe("Bakkal");
    });
    await on("A", async () => {
      await sync();
      expect((await readLists())[0]?.name).toBe("Bakkal");
    });
  });

  it("keeps a delete over an edit from a device that never saw it", async () => {
    const { listId, itemId } = await on("A", async () => {
      const id = await createList("Market");
      const [item] = await add(id, "süt");
      await sync();
      return { listId: id, itemId: item! };
    });
    await on("B", sync);
    await on("A", async () => {
      await deleteItem(itemId);
      await sync();
    });
    await on("B", async () => {
      await toggleChecked(itemId);
      await sync();
      expect(await names(listId), "the stale tick did not bring it back").toEqual([]);
      expect(await pendingOutboxCount()).toBe(0);
    });
    expect(serverRow("items", itemId)).toMatchObject({ tombstone_version: 1 });
    expect(serverRow("items", itemId)?.deleted_at).not.toBeNull();
  });

  it("puts a product added again, on a device that never saw it bought, back on the list", async () => {
    const listId = await on("A", async () => {
      const id = await createList("Market");
      await sync();
      return id;
    });
    await on("B", sync);
    await on("A", async () => {
      const [item] = await add(listId, "süt");
      await toggleChecked(item!);
      await finishShop(listId);
      await sync();
      expect(await names(listId)).toEqual([]);
    });
    await on("B", async () => {
      await add(listId, "süt");
      await sync();
      expect(await names(listId), "B's add is not lost to A's older finish").toEqual(["süt"]);
      expect(await pendingOutboxCount()).toBe(0);
    });
    await on("A", async () => {
      await sync();
      expect(await names(listId)).toEqual(["süt"]);
    });
  });

  it("keeps the second buy of a product added again over a tick from a device that never saw it", async () => {
    const listId = await on("A", async () => {
      const id = await createList("Market");
      await sync();
      return id;
    });
    await on("B", sync);
    const itemId = await on("A", async () => {
      const [item] = await add(listId, "süt");
      await toggleChecked(item!);
      await finishShop(listId);
      await sync();
      return item!;
    });
    await on("B", async () => {
      await add(listId, "süt");
      await sync();
    });
    // A takes B's add, and with it the day B made it.
    await on("A", sync);
    await on("B", async () => {
      await toggleChecked(itemId);
      await finishShop(listId);
      await sync();
    });
    await on("A", async () => {
      await toggleChecked(itemId);
      await sync();
      expect(await names(listId), "a tick is an edit, not an add").toEqual([]);
    });
    expect(serverRow("items", itemId)?.deleted_at).not.toBeNull();
  });

  it("brings a shop both devices finished offline home once (SPEC 12.9)", async () => {
    const listId = await on("A", async () => {
      const id = await createList("Market");
      const [item] = await add(id, "süt");
      await toggleChecked(item!);
      await sync();
      return id;
    });
    await on("B", sync);
    const once = await on("A", async () => {
      await finishShop(listId);
      return readPantry();
    });
    expect(once).toMatchObject([{ name: "süt" }]);
    await on("B", async () => {
      await finishShop(listId);
      await sync();
    });
    await on("A", async () => {
      await sync();
      expect(await readPantry()).toEqual(once);
    });
    await on("B", async () => {
      await sync();
      expect(await readPantry()).toEqual(once);
    });
    expect(cloud.rows("pantry_moves")).toHaveLength(1);
  });

  it("pulls a row that committed late, at its table's next change", async () => {
    const listId = await on("A", async () => {
      const id = await createList("Market");
      await sync();
      return id;
    });
    await on("B", sync);
    const late = "019f6bba-2c65-7ea8-a6c9-96d891155e99";
    cloud.insertLate("lists", { id: late, owner_id: USER, name: "Geç", color: null, icon: null, kind: "shop", pantry: true }, 400);
    await on("A", async () => {
      await editList(listId, { name: "Pazar", color: null, icon: null });
      await sync();
    });
    await on("B", async () => {
      await sync();
      expect((await readLists()).map((list) => list.name).sort()).toEqual(["Geç", "Pazar"]);
    });
  });

  it("asks only whether anything moved when nothing did", async () => {
    await on("A", async () => {
      await add(await createList("Market"), "süt");
      await sync();
      cloud.requests.length = 0;
      await sync();
    });
    expect(cloud.requests).toEqual(["rpc sync_cursors"]);
  });
});

describe("two people sharing a list", () => {
  /** A's list with two things on it, and C's own, synced before any invitation, so C's cursors are past A's rows. */
  async function sharedMarket(role: "editor" | "viewer" = "editor"): Promise<string> {
    const listId = await on("A", async () => {
      const id = await createList("Market");
      await add(id, "süt", "elma");
      await sync();
      return id;
    });
    await on("C", async () => {
      await createList("Kendi");
      await sync();
    });
    const token = await on("A", async () => {
      const made = await createInvite(listId, role, "Ömer");
      if ("refused" in made) throw new Error(made.refused);
      return made.token;
    });
    await on("C", async () => {
      expect(await acceptInvite(token, "Deniz")).toEqual({ listId });
      await sync();
    });
    return listId;
  }

  it("brings a shared list, and everything already on it, to the person who joins", async () => {
    const listId = await sharedMarket();
    await on("C", async () => {
      expect((await readLists()).map((list) => list.name).sort()).toEqual(["Kendi", "Market"]);
      expect(await names(listId)).toEqual(["elma", "süt"]);
      expect((await readMembers(listId)).map((member) => [member.name, member.role])).toEqual([["Ömer", "owner"], ["Deniz", "editor"]]);
    });
  });

  it("carries a tick from one person's phone to the other's, with whose it was", async () => {
    const listId = await sharedMarket();
    await on("C", async () => {
      await toggleChecked((await readItems(listId)).find((item) => item.name === "süt")!.id);
      await sync();
    });
    await on("A", async () => {
      await sync();
      const milk = (await readItems(listId)).find((item) => item.name === "süt")!;
      expect(milk.checkedAt).not.toBeNull();
      expect(serverRow("items", milk.id)?.checked_by).toBe(OTHER);
    });
  });

  it("lets the list go from the device of a member the owner removed, with what it had queued for it", async () => {
    const listId = await sharedMarket();
    await on("A", async () => {
      await sync();
      await removeMember((await readMembers(listId)).find((member) => member.userId === OTHER)!.id);
      await sync();
    });
    await on("C", async () => {
      await add(listId, "yağ");
      await sync();
      expect((await readLists()).map((list) => list.name)).toEqual(["Kendi"]);
      expect(await readItems(listId)).toEqual([]);
      expect(await pendingOutboxCount()).toBe(0);
      expect(await readDeadLetters(), "a list it cannot reach leaves nothing to retry").toEqual([]);
    });
  });

  it("lets the list go from the device of a member who leaves, and tells the owner", async () => {
    const listId = await sharedMarket();
    await on("C", async () => {
      await leaveList(listId, OTHER);
      await sync();
      expect((await readLists()).map((list) => list.name)).toEqual(["Kendi"]);
    });
    await on("A", async () => {
      await sync();
      expect((await readMembers(listId)).map((member) => member.role)).toEqual(["owner"]);
    });
  });

  it("fetches a joined list on the joiner's other device too", async () => {
    const listId = await on("A", async () => {
      const id = await createList("Market");
      await add(id, "süt", "elma");
      await sync();
      return id;
    });
    // Its cursors past A's rows before the invitation, as a device in use would be.
    await on("D", async () => {
      await add(await createList("Ev"), "su");
      await sync();
    });
    const made = await on("A", () => createInvite(listId, "editor", "Ömer"));
    await on("C", async () => {
      await acceptInvite("token" in made ? made.token : "", "Deniz");
      await sync();
    });
    await on("D", async () => {
      await sync();
      expect((await readLists()).map((list) => list.name).sort()).toEqual(["Ev", "Market"]);
      expect(await names(listId)).toEqual(["elma", "süt"]);
    });
  });

  it("fetches the list again when a member who left is invited back", async () => {
    const listId = await sharedMarket();
    await on("C", async () => {
      await leaveList(listId, OTHER);
      await sync();
    });
    const token = await on("A", async () => {
      const made = await createInvite(listId, "viewer", "Ömer");
      return "token" in made ? made.token : "";
    });
    await on("C", async () => {
      expect(await acceptInvite(token, "Deniz")).toEqual({ listId });
      await sync();
      expect(await names(listId)).toEqual(["elma", "süt"]);
      expect((await readMembers(listId)).find((member) => member.userId === OTHER)?.role).toBe("viewer");
    });
  });

  it("lets the owner make a viewer an editor, whose writes then land", async () => {
    const listId = await sharedMarket("viewer");
    await on("A", async () => {
      await sync();
      await setMemberRole((await readMembers(listId)).find((member) => member.userId === OTHER)!.id, "editor");
      await sync();
    });
    await on("C", async () => {
      await sync();
      await add(listId, "yağ");
      await sync();
      expect(await readDeadLetters()).toEqual([]);
    });
    expect(cloud.rows("items").map((row) => row.name)).toContain("yağ");
  });

  it("leaves nothing to do for a list the person never joined", async () => {
    await on("A", async () => {
      const listId = await createList("Market");
      await leaveList(listId, USER);
      expect(await pendingOutboxCount()).toBe(1);
    });
  });

  it("reads a link, or its bare token, and nothing else", () => {
    const token = "a".repeat(64);
    expect(inviteTokenFrom(` ${inviteLink(token)} `)).toBe(token);
    expect(inviteTokenFrom(token)).toBe(token);
    expect(inviteTokenFrom("https://example.com/gital/invite#" + token)).toBeNull();
    expect(inviteTokenFrom("a".repeat(63))).toBeNull();
  });

  it("keeps the token a web invitation opened with, and only on its page", () => {
    const token = "b".repeat(64);
    expect(inviteFromPage({ pathname: "/gital/invite", hash: `#${token}` })).toBe(token);
    expect(inviteFromPage({ pathname: "/gital/invite/", hash: `#${token}` })).toBe(token);
    expect(inviteFromPage({ pathname: "/gital/", hash: `#${token}` })).toBeNull();
    expect(inviteFromPage({ pathname: "/gital/invite", hash: "#nope" })).toBeNull();
    expect(inviteFromPage(undefined)).toBeNull();
  });

  it("knows each person's part in a list: the owner's until someone else's row says otherwise", async () => {
    const listId = await sharedMarket("viewer");
    await on("A", async () => {
      expect(roleOf([], USER)).toBe("owner");
      await sync();
      expect(roleOf(await readMembers(listId), USER)).toBe("owner");
    });
    await on("C", async () => {
      await sync();
      expect(roleOf(await readMembers(listId), OTHER)).toBe("viewer");
    });
  });

  it("brings home to each member's pantry what that member ticked, once, and takes it back with the shop", async () => {
    const listId = await sharedMarket();
    const tick = async (name: string) => toggleChecked((await readItems(listId)).find((item) => item.name === name)!.id);
    const pantry = async () => (await readPantry()).map((item) => item.name);
    await on("C", async () => {
      await tick("elma");
      await sync();
    });
    const shopId = await on("A", async () => {
      await sync();
      await tick("süt");
      const finished = await finishShop(listId);
      expect(finished?.stocked).toBe(1);
      expect(await pantry()).toEqual(["süt"]);
      await sync();
      return finished!.id;
    });
    await on("C", async () => {
      await sync();
      expect(await pantry()).toEqual(["elma"]);
      await sync();
      expect((await readPantry()).map((item) => [item.name, item.quantityMilli])).toEqual([["elma", 1000]]);
    });
    await on("A", async () => {
      await sync();
      await reopenShop(shopId);
      await sync();
    });
    await on("C", async () => {
      await sync();
      expect(await pantry()).toEqual([]);
    });
    await on("A", async () => {
      await sync();
      await finishShop(listId);
      await sync();
      expect(await pantry()).toEqual(["süt"]);
    });
    await on("C", async () => {
      await sync();
      await sync();
      expect((await readPantry()).map((item) => [item.name, item.quantityMilli])).toEqual([["elma", 1000]]);
      // Emptied by hand, the pantry stays empty: the shop is still there, and still recent.
      await resetData(["pantry"]);
      await sync();
      await sync();
      expect(await pantry()).toEqual([]);
      // And what comes home next counts from nothing.
      const kendi = (await readLists()).find((list) => list.name === "Kendi")!.id;
      await add(kendi, "elma");
      await toggleChecked((await readItems(kendi))[0]!.id);
      await finishShop(kendi);
      expect((await readPantry()).map((item) => [item.name, item.quantityMilli])).toEqual([["elma", 1000]]);
    });
  });

  it("resets only what is the person's own: a list someone else owns, and its history, stay theirs", async () => {
    const listId = await sharedMarket();
    await on("A", async () => {
      await sync();
      await toggleChecked((await readItems(listId)).find((item) => item.name === "süt")!.id);
      await finishShop(listId);
      await sync();
    });
    await on("C", async () => {
      await sync();
      expect(await countDataReset(["lists", "history"])).toBe(1);
      await resetData(["lists", "history"]);
      await sync();
      expect((await readLists()).map((list) => list.name)).toEqual(["Market"]);
      expect(await readDeadLetters()).toEqual([]);
    });
    await on("A", async () => {
      await sync();
      expect(await names(listId)).toEqual(["elma"]);
      expect(await readShops()).toHaveLength(1);
    });
  });

  it("keeps live the lists a person shares with someone, and only while both are in them", async () => {
    const listId = await sharedMarket();
    await on("A", async () => {
      await sync();
      await createList("Kendi");
      expect(await readSharedLists(USER)).toEqual([listId]);
    });
    await on("C", async () => {
      await sync();
      expect(await readSharedLists(OTHER)).toEqual([listId]);
      await leaveList(listId, OTHER);
      expect(await readSharedLists(OTHER)).toEqual([]);
    });
  });

  it("marks what the other person added since the last look as new, counts it on the card, and lets it go once seen", async () => {
    const listId = await sharedMarket();
    await on("A", async () => {
      await sync();
      // Before a first look nothing is new: joining brings a whole list, none of it news.
      expect(await readFresh(USER)).toEqual([]);
      await markSeen(listId, USER);
      await sync();
      // One device's clock stands in for two: an addition in the look's own millisecond is not after it.
      await new Promise((resolve) => setTimeout(resolve, 2));
    });
    await on("C", async () => {
      await sync();
      await add(listId, "yağ");
      await toggleChecked((await readItems(listId)).find((item) => item.name === "süt")!.id);
      await sync();
    });
    await on("A", async () => {
      await sync();
      expect(await readFresh(USER)).toEqual([{ listId, count: 1 }]);
      const members = await readMembers(listId);
      const people = Object.fromEntries((await readItems(listId)).map((item) => [item.name, rowPeople(item, members, USER)]));
      expect(people).toEqual({
        yağ: { fresh: true, added: "D", checked: null },
        süt: { fresh: false, added: "Ö", checked: "D" },
        elma: { fresh: false, added: "Ö", checked: null },
      });
      await markSeen(listId, USER);
      expect(await readFresh(USER)).toEqual([]);
      expect(rowPeople((await readItems(listId)).find((item) => item.name === "yağ")!, await readMembers(listId), USER).fresh).toBe(false);
      await sync();
    });
    await on("C", async () => {
      // What the person added is never new to them, what came before a first look is not news,
      // and a list nobody shares shows nobody.
      expect(await readFresh(OTHER)).toEqual([]);
      const elma = (await readItems(listId)).find((item) => item.name === "elma")!;
      expect(rowPeople(elma, await readMembers(listId), OTHER)).toEqual({ fresh: false, added: "Ö", checked: null });
      const kendi = (await readLists()).find((list) => list.name === "Kendi")!.id;
      await add(kendi, "un");
      expect(rowPeople((await readItems(kendi))[0]!, await readMembers(kendi), OTHER)).toEqual({ fresh: false, added: null, checked: null });
      await markSeen(kendi, OTHER);
      expect(await pendingOutboxCount()).toBe(1);
    });
  });

  it("remembers the name the other members see, on every device", async () => {
    await on("A", async () => {
      expect(memberNameOf(await readSettings())).toBeNull();
      await setMemberName("  Ömer  ");
      await setMemberName("Ömer T.");
      expect(memberNameOf(await readSettings())).toBe("Ömer T.");
      await sync();
    });
    await on("B", async () => {
      await sync();
      expect(memberNameOf(await readSettings())).toBe("Ömer T.");
    });
    await expect(setMemberName("   ")).rejects.toThrow();
  });

  it("says why an invitation could not be made", async () => {
    const listId = await on("A", () => createList("Market"));
    await on("A", async () => {
      await sync();
      cloud.failures.push({ message: "TypeError: Failed to fetch" }, { message: "boom", code: "XX000" });
      expect(await createInvite(listId, "editor", "Ömer")).toEqual({ refused: tr.sync.errNetwork });
      expect(await createInvite(listId, "editor", "Ömer")).toEqual({ refused: tr.sharing.errGeneric });
    });
    harness.cloud = { client: () => null };
    expect(await acceptInvite("a".repeat(64), "Deniz")).toEqual({ refused: tr.auth.errNotConfigured });
  });

  it("refuses an invitation that is spent, and one that only the owner could make", async () => {
    const listId = await sharedMarket();
    await on("C", async () => {
      expect(await createInvite(listId, "editor", "Deniz")).toEqual({ refused: tr.sharing.errNotOwner });
      expect(await acceptInvite("0".repeat(64), "Deniz")).toEqual({ refused: tr.sharing.errInvite });
    });
  });
});

describe("what the server will not take", () => {
  it("sets a refused row aside and sends the rest of its batch", async () => {
    await on("A", async () => {
      await createList("Market");
      await writeRows([{ table: "lists", row: { id: "019f6bba-2c65-7ea8-a6c9-96d891155e01", name: "x".repeat(201) } }]);
      expect(await sync()).toBe(true);
      expect(cloud.rows("lists").map((row) => row.name)).toEqual(["Market"]);
      expect(await pendingOutboxCount()).toBe(0);
      expect(await readDeadLetters(), "named as the person wrote it").toMatchObject([{ tableName: "lists", reason: "refused", subject: "x".repeat(201) }]);
      expect(useSyncStatus.getState()).toMatchObject({ state: "attention", error: null });
    });
  });

  it("sets aside an event it cannot read, and still sends the others", async () => {
    await on("A", async () => {
      await createList("Market");
      devices.A.prepare(
        "INSERT INTO outbox (table_name, row_id, op, payload, idempotency_key, created_at) VALUES ('lists', 'x', 'upsert', '{', 'broken', '2026-09-27')",
      ).run();
      await sync();
      expect(cloud.rows("lists")).toHaveLength(1);
      const letters = await readDeadLetters();
      expect(letters).toMatchObject([{ rowId: "x", reason: "malformed_payload", subject: null }]);
      expect(await retryDeadLetter(letters[0]!.id), "no row on the device to send").toBe("missing");
    });
  });

  it("fails the sync and keeps the outbox when the server fails for another reason", async () => {
    await on("A", async () => {
      await createList("Market");
      cloud.failures.push({ message: "upstream connect error", code: "XX000" });
      expect(await sync()).toBe(false);
      expect(useSyncStatus.getState()).toMatchObject({ state: "error", error: tr.sync.errGeneric });

      await writeRows([{ table: "lists", row: { id: "019f6bba-2c65-7ea8-a6c9-96d891155e03", name: "x".repeat(201) } }]);
      const release = cloud.hold("upsert lists");
      const running = sync();
      await vi.waitFor(() => expect(cloud.requests).toContain("upsert lists"));
      cloud.failures.push({ message: "Failed to fetch" });
      release();
      expect(await running, "a row sent alone that meets the network, not a refusal").toBe(false);
      expect(await readDeadLetters()).toEqual([]);
      expect(await pendingOutboxCount()).toBe(2);
    });
  });

  it("pulls every table when the server cannot say what moved, and keeps its place when a pull fails", async () => {
    await on("A", async () => {
      await createList("Market");
      await sync();
      cloud.failures.push({ message: "Could not find the function public.sync_cursors", code: "PGRST202" });
      expect(await sync()).toBe(true);
      expect(await sync()).toBe(true);
      expect(cloud.requests.filter((request) => request === "rpc sync_cursors"), "asked once this session").toHaveLength(1);
    });
    await on("A", async () => {
      cloud.failures.push({ message: "canceling statement due to statement timeout", code: "57014" });
      expect(await sync(), "a probe that fails otherwise fails the sync").toBe(false);
    });
    await on("B", async () => {
      cloud.failures.push({ message: "canceling statement due to statement timeout", code: "57014" });
      expect(await sync()).toBe(false);
      expect(await readLists()).toEqual([]);
      expect(await sync()).toBe(true);
      expect((await readLists()).map((list) => list.name)).toEqual(["Market"]);
    });
  });

  it("pulls a table longer than one page", async () => {
    const rows = Array.from({ length: 1001 }, (_, at) => ({
      table: "products" as const,
      row: { id: `019f6bba-2c65-7ea8-a6c9-${String(at).padStart(12, "0")}`, name: `ürün ${at}`, starred: true },
    }));
    await on("A", async () => {
      await writeRows(rows);
      expect(await sync()).toBe(true);
    });
    await on("B", async () => {
      expect(await sync()).toBe(true);
      expect(await readProducts()).toHaveLength(1001);
    });
  });

  it("names a set-aside row by its name or its link, and has nothing to send for a table this build does not know", async () => {
    await on("A", async () => {
      const insert = devices.A.prepare(
        "INSERT INTO sync_dead_letters (outbox_id, table_name, row_id, payload, reason, quarantined_at) VALUES (?, ?, ?, ?, ?, '2026-09-27T00:00:00.000Z')",
      );
      insert.run(1, "wish_links", "019f6bba-2c65-7ea8-a6c9-96d891155e04", '{"url":"https://example.com/a"}', "refused");
      insert.run(2, "baskets", "019f6bba-2c65-7ea8-a6c9-96d891155e05", '{"name":5}', "invalid_row");
      const letters = await readDeadLetters();
      expect(letters.map((letter) => letter.subject)).toEqual(["https://example.com/a", null]);
      expect(await retryDeadLetter(letters[1]!.id)).toBe("missing");
    });
  });

  it("sends a set-aside row again on a retry, forgets it once a newer version lands, and forgets the clue on a dismiss", async () => {
    await on("A", async () => {
      const id = "019f6bba-2c65-7ea8-a6c9-96d891155e02";
      await writeRows([{ table: "lists", row: { id, name: "x".repeat(201) } }]);
      await sync();
      const [letter] = await readDeadLetters();
      expect(await retryDeadLetter(letter!.id)).toBe("requeued");
      expect(await pendingOutboxCount()).toBe(1);
      await sync();
      expect(await readDeadLetters(), "refused again, set aside again").toMatchObject([{ rowId: id, reason: "refused" }]);

      await writeRows([{ table: "lists", row: { id, name: "Market" } }]);
      await sync();
      expect(serverRow("lists", id)?.name).toBe("Market");
      expect(await readDeadLetters(), "the version it named is history").toEqual([]);
      expect(useSyncStatus.getState().state).toBe("idle");

      await writeRows([{ table: "lists", row: { id, name: "y".repeat(201) } }]);
      await sync();
      const [again] = await readDeadLetters();
      await dismissDeadLetter(again!.id);
      expect(await readDeadLetters()).toEqual([]);
      expect(devices.A.prepare("SELECT name FROM lists WHERE id = ?").get(id), "the row itself stays").toEqual({ name: "y".repeat(201) });
      expect(await retryDeadLetter(again!.id)).toBe("missing");
    });
  });
});

describe("the session", () => {
  it("sends nothing under another account's session", async () => {
    await on("A", async () => {
      await createList("Market");
      cloud.user = OTHER;
      expect(await sync()).toBe(false);
      cloud.user = null;
      expect(await sync(), "nor under none").toBe(false);
      expect(cloud.requests.some((request) => request.startsWith("upsert"))).toBe(false);
      expect(await pendingOutboxCount()).toBe(1);
      expect(useSyncStatus.getState()).toMatchObject({ state: "error", error: tr.sync.errReauth });
    });
  });

  it("keeps everything and says so when the session cannot be read", async () => {
    await on("A", async () => {
      await createList("Market");
      cloud.sessionFailure = { message: "Failed to fetch" };
      expect(await sync()).toBe(false);
      expect(useSyncStatus.getState()).toMatchObject({ state: "error", error: tr.sync.errNetwork });
      expect(await pendingOutboxCount()).toBe(1);
    });
  });

  it("renews an expired token and carries on without asking", async () => {
    await on("A", async () => {
      await createList("Market");
      cloud.failures.push({ message: "JWT expired", code: "PGRST301" });
      await sync();
      await vi.waitFor(async () => expect(await pendingOutboxCount()).toBe(0));
      expect(useSyncStatus.getState().state).toBe("idle");
    });
  });

  it("renews once, and asks for a sign-in when the renewed token is refused too", async () => {
    await on("A", async () => {
      await createList("Market");
      cloud.failures.push({ message: "JWT expired", code: "PGRST301" }, { message: "JWT expired", code: "PGRST301" });
      await sync();
      await vi.waitFor(() => expect(useSyncStatus.getState()).toMatchObject({ state: "error", error: tr.sync.errReauth }));
      expect(await pendingOutboxCount()).toBe(1);
    });
  });

  it("waits and tries again, asking nothing, when the renewal cannot reach Auth", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await on("A", async () => {
        await createList("Market");
        cloud.failures.push({ message: "JWT expired", code: "PGRST301" });
        cloud.refreshFailures.push({ message: "Failed to fetch", code: "AuthRetryableFetchError" });
        expect(await sync()).toBe(false);
        expect(useSyncStatus.getState()).toMatchObject({ state: "error", error: tr.sync.errNetwork });
        await vi.advanceTimersByTimeAsync(5000);
        await vi.waitFor(() => expect(useSyncStatus.getState().state).toBe("idle"));
        expect(await pendingOutboxCount()).toBe(0);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks for a sign-in once the session cannot be renewed, and keeps what is unsent", async () => {
    await on("A", async () => {
      await createList("Market");
      cloud.failures.push({ message: "JWT expired", code: "PGRST301" });
      cloud.refreshFailures.push({ message: "Invalid Refresh Token: Already Used" });
      await sync();
      expect(useSyncStatus.getState()).toMatchObject({ state: "error", error: tr.sync.errReauth });
      expect(await pendingOutboxCount()).toBe(1);
    });
  });

  it("keeps the outbox when the session ends while the server is answering", async () => {
    harness.db = devices.A;
    startSyncSession(USER);
    await createList("Market");
    const release = cloud.hold("upsert lists");
    const running = sync();
    await vi.waitFor(() => expect(cloud.requests).toContain("upsert lists"));
    const stopping = stopSyncSession();
    release();
    await stopping;
    expect(await running).toBe(false);
    expect(cloud.rows("lists"), "the server took it").toHaveLength(1);
    expect(await pendingOutboxCount(), "but this session never heard so").toBe(1);
  });

  it("keeps an edit made while its row's push was in flight, even when sending it fails", async () => {
    await on("A", async () => {
      const id = await createList("Market");
      const release = cloud.hold("upsert lists");
      const running = sync();
      await vi.waitFor(() => expect(cloud.requests).toContain("upsert lists"));
      await editList(id, { name: "Pazar", color: null, icon: null });
      cloud.failures.push({ message: "Failed to fetch" });
      release();
      expect(await running).toBe(false);
      expect((await readLists())[0]?.name, "the answer for the older name did not put it back").toBe("Pazar");
      expect(await pendingOutboxCount()).toBe(1);
    });
  });

  it("does not let a pull put back a row whose newer edit is still to be sent", async () => {
    await on("A", async () => {
      const id = await createList("Market");
      await setStarred("süt", true);
      const release = cloud.hold("upsert products");
      const running = sync();
      await vi.waitFor(() => expect(cloud.requests).toContain("upsert products"));
      await editList(id, { name: "Pazar", color: null, icon: null });
      release();
      await running;
      expect((await readLists())[0]?.name).toBe("Pazar");
      await sync();
      expect(serverRow("lists", id)?.name).toBe("Pazar");
    });
  });

  it("does nothing for an account whose session is not open, nor on a build with no server", async () => {
    harness.db = devices.A;
    await createList("Market");
    expect(await sync()).toBe(false);
    scheduleSync(USER);
    await flushOutbox(USER);
    expect(cloud.requests).toEqual([]);

    harness.cloud = { client: () => null };
    await on("A", async () => {
      expect(await sync()).toBe(true);
      await flushOutbox(USER);
      await purgeOwnPhotos();
    });
    expect(await pendingOutboxCount()).toBe(1);
  });

  it("runs one more pass for a write made while a sync was running", async () => {
    await on("A", async () => {
      await createList("Market");
      // Held while pulling, so its push has already emptied the outbox.
      const release = cloud.hold("select lists");
      const running = sync();
      await vi.waitFor(() => expect(cloud.requests).toContain("select lists"));
      await createList("Pazar");
      const joined = sync();
      release();
      expect(await joined, "the second call waits on the run under way").toBe(await running);
      expect(cloud.rows("lists")).toHaveLength(1);
      await vi.waitFor(() => expect(cloud.rows("lists"), "sooner than the write's own 1.5 s").toHaveLength(2), { timeout: 1000 });
    });
  });

  it("flushes the outbox without pulling, for a sign-out", async () => {
    await on("A", async () => {
      await createList("Market");
      await flushOutbox(USER);
      expect(await pendingOutboxCount()).toBe(0);
      expect(cloud.requests.filter((request) => request.startsWith("select") || request.startsWith("rpc"))).toEqual([]);
    });
  });
});

describe("photos", () => {
  it("sends a photo before the row naming it, and the other device fetches it", async () => {
    const { listId, photoId } = await on("A", async () => {
      const id = await createList("Market");
      await addScanned(id, { name: "süt", note: null, photo: { data: JPEG, thumb: JPEG } });
      await sync();
      return { listId: id, photoId: (await readItems(id))[0]!.photoId! };
    });
    expect(cloud.requests.indexOf(`upload ${photoId}/full.jpg`)).toBeLessThan(cloud.requests.indexOf("upsert items"));
    expect([...cloud.objects.keys()].sort()).toEqual([`${photoId}/full.jpg`, `${photoId}/thumb.jpg`]);

    await on("B", async () => {
      await sync();
      expect((await readItems(listId))[0]).toMatchObject({ photoId, photo: JPEG });
      expect(await readPhoto(photoId)).toBe(JPEG);
    });
  });

  it("asks again for a photo that the network, not Storage, kept from arriving", async () => {
    const { listId } = await on("A", async () => {
      const id = await createList("Market");
      await addScanned(id, { name: "süt", note: null, photo: { data: JPEG, thumb: JPEG } });
      await sync();
      return { listId: id };
    });
    await on("B", async () => {
      cloud.downloadFailure = { message: "Failed to fetch", status: undefined };
      expect(await sync(), "an unreachable Storage fails the sync").toBe(false);
      cloud.downloadFailure = null;
      expect(await sync()).toBe(true);
      expect((await readItems(listId))[0]?.photo).toBe(JPEG);
    });
  });

  it("keeps the row naming a photo back while the photo cannot be sent", async () => {
    await on("A", async () => {
      const id = await createList("Market");
      await addScanned(id, { name: "süt", note: null, photo: { data: JPEG, thumb: JPEG } });
      cloud.failures.push({ message: "Failed to fetch" });
      expect(await sync()).toBe(false);
      expect(cloud.rows("items")).toEqual([]);
      expect(await sync()).toBe(true);
      expect(cloud.rows("items")).toHaveLength(1);
    });
  });

  it("reads a fetched photo through FileReader where the Blob cannot give its bytes, as on a phone", async () => {
    const { listId } = await on("A", async () => {
      const id = await createList("Market");
      await addScanned(id, { name: "süt", note: null, photo: { data: JPEG, thumb: JPEG } });
      await sync();
      return { listId: id };
    });
    const bytes = Blob.prototype.arrayBuffer;
    const failing = new Set(["first"]);
    vi.stubGlobal(
      "FileReader",
      class {
        result: string | null = null;
        error: Error | null = null;
        onloadend: () => void = () => {};
        readAsDataURL(blob: Blob) {
          void bytes.call(blob).then((buffer) => {
            if (failing.delete("first")) this.error = new Error("read failed");
            else this.result = `data:application/octet-stream;base64,${Buffer.from(buffer).toString("base64")}`;
            this.onloadend();
          });
        }
      },
    );
    Object.defineProperty(Blob.prototype, "arrayBuffer", { value: undefined, configurable: true });
    try {
      await on("B", async () => {
        expect(await sync(), "a read that fails fails the sync").toBe(false);
        expect(await sync()).toBe(true);
        expect((await readItems(listId))[0]?.photo).toBe(JPEG);
      });
    } finally {
      Object.defineProperty(Blob.prototype, "arrayBuffer", { value: bytes, configurable: true });
      vi.unstubAllGlobals();
    }
  });

  it("asks Storage once a launch for a photo it does not have, and never for a path a row made up", async () => {
    const { listId } = await on("A", async () => {
      const id = await createList("Market");
      await addScanned(id, { name: "süt", note: null, photo: { data: JPEG, thumb: JPEG } });
      await add(id, "ekmek");
      const bread = (await readItems(id)).find((item) => item.name === "ekmek")!;
      // What a sharer's own build could send: the server takes any text here.
      await writeRows([{ table: "items", row: { ...fromDbShape("items", devices.A.prepare("SELECT * FROM items WHERE id = ?").get(bread.id) as Record<string, unknown>), photoId: "../../avatars/someone" } }]);
      await sync();
      return { listId: id };
    });
    cloud.objects.clear();
    await on("B", async () => {
      expect(await sync()).toBe(true);
      expect(await sync()).toBe(true);
      expect(cloud.requests.filter((request) => request.startsWith("download")), "one ask per size, and only for a photo's own path").toHaveLength(2);
      expect((await readItems(listId)).map((item) => item.photo)).toEqual([null, null]);
    });
  });

  it("takes a file that is not a JPEG for no photo at all", async () => {
    const { listId } = await on("A", async () => {
      const id = await createList("Market");
      await addScanned(id, { name: "süt", note: null, photo: { data: JPEG, thumb: JPEG } });
      await sync();
      return { listId: id };
    });
    for (const object of cloud.objects.values()) object.bytes = new TextEncoder().encode("<script>");
    await on("B", async () => {
      expect(await sync()).toBe(true);
      expect((await readItems(listId))[0]?.photo).toBeNull();
    });
  });

  it("removes every photo the account sent, and marks them to send again", async () => {
    await on("A", async () => {
      const id = await createList("Market");
      await addScanned(id, { name: "süt", note: null, photo: { data: JPEG, thumb: JPEG } });
      await sync();
      cloud.failures.push({ message: "Failed to fetch" });
      await expect(purgeOwnPhotos(), "a list it could not get").rejects.toThrow("photo purge");
      const release = cloud.hold("rpc own_photo_objects");
      const purging = purgeOwnPhotos();
      await vi.waitFor(() => expect(cloud.requests.at(-1)).toBe("rpc own_photo_objects"));
      cloud.failures.push({ message: "Failed to fetch" });
      release();
      await expect(purging, "a removal that failed").rejects.toThrow("photo purge");
      expect(devices.A.prepare("SELECT uploaded_at FROM photos").all(), "still marked sent").not.toEqual([{ uploaded_at: null }]);

      await purgeOwnPhotos();
      expect(cloud.objects.size).toBe(0);
      expect(devices.A.prepare("SELECT uploaded_at FROM photos").all()).toEqual([{ uploaded_at: null }]);
    });
  });
});
