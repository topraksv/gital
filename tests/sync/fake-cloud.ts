/**
 * The server half of sync, as the engine meets it through supabase-js: the
 * PostgREST calls it makes, the two RPCs, Storage and the session. It keeps
 * what `supabase/migrations/00000000000003_sync.sql` decides — the server's
 * clock in microseconds, one `now()` per statement, the delete generation,
 * who may read and write which row, a personal row keyed by its person, a
 * list's members and their invitations (migration 5), the household Kiler
 * (migration 12), offers in the app (migration 13), and a statement that fails whole — so the engine is tested against the rules it
 * will meet, and `supabase/tests/sync_rls.sql` proves the real server keeps
 * the same ones.
 */

import { createHash } from "node:crypto";

type Row = Record<string, unknown>;
// `status` is Storage's: set, possibly undefined, on every error it returns.
type Failure = { message: string; code?: string; status?: number };
type Reply = { data: unknown; error: Failure | null };

const PERSONAL = new Set(["products", "sets", "set_items", "pantry_items", "pantry_moves", "settings"]);
const PANTRY = new Set(["pantry_items", "pantry_moves"]);
const LIST_CHILDREN = new Set(["shops", "items", "wishes", "wish_links"]);
const FRESH_OVER_LIVE = new Set(["shops", "items", "products", "pantry_items"]);
export const TABLES = ["lists", "list_members", "shops", "items", "wishes", "wish_links", "products", "sets", "set_items", "pantry_items", "pantry_moves", "settings"];
const PHOTO_OBJECT = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(full|thumb)\.jpg$/;

/** Microseconds since the epoch, as Postgres keeps a timestamptz. */
function micros(value: string): number {
  const match = /^(.*T\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)$/.exec(value);
  if (!match) return Number.NaN;
  const fraction = (match[2] ?? "").padEnd(6, "0").slice(0, 6);
  return Date.parse(`${match[1]}${match[3]}`) * 1000 + Number(fraction);
}

function timestamptz(us: number): string {
  const iso = new Date(Math.floor(us / 1000)).toISOString();
  return `${iso.slice(0, 19)}.${String(us % 1_000_000).padStart(6, "0")}+00:00`;
}

export class FakeCloud {
  readonly tables = new Map<string, Map<string, Row>>(TABLES.map((table) => [table, new Map()]));
  readonly objects = new Map<string, { owner: string; bytes: Uint8Array; at: number }>();
  /** Who the client's session belongs to; `null` is signed out. */
  user: string | null = null;
  /** The next answers `auth.refreshSession` gives, then a fresh session. */
  refreshFailures: Failure[] = [];
  /** A failure the next PostgREST calls meet before doing anything. */
  failures: Failure[] = [];
  /** What `auth.getSession` answers with while set. */
  sessionFailure: Failure | null = null;
  /** What every Storage download meets while set. */
  downloadFailure: Failure | null = null;
  /** One failure for the first request whose name starts so, as `failures` is for the next of any. */
  readonly failOn = new Map<string, Failure>();
  private readonly holds = new Map<string, Promise<void>>();
  readonly requests: string[] = [];
  /** Ahead of any device's clock, so a pulled row always looks newer than a local edit. */
  private clock = Date.parse("2030-01-01T00:00:00Z") * 1000;

  private now(): number {
    // 1.000123 ms a statement, so two statements never share a millisecond's
    // worth of microseconds and a cursor's truncation is always exercised.
    this.clock += 1123;
    return this.clock;
  }

  private keyOf(table: string, row: Row): string {
    return this.keyColumns(table).map((column) => String(row[column])).join("|");
  }

  /**
   * Migration 14: shops and items are keyed by their list too. Written again
   * rather than imported from `src/sync/rows.ts`, so a key the client gets
   * wrong is one this server does not have.
   */
  keyColumns(table: string): string[] {
    if (PERSONAL.has(table)) return ["user_id", "id"];
    return table === "shops" || table === "items" ? ["list_id", "id"] : ["id"];
  }

  private readonly invites = new Map<string, { list: string; role: string }>();
  /** Offers by `list|invitee`: who made each, and as what. */
  private readonly offers = new Map<string, { list: string; role: string; by: string; to: string }>();

  private isOwner(list: unknown, uid: string): boolean {
    return this.tables.get("lists")!.get(String(list))?.owner_id === uid;
  }

  private membership(list: unknown, uid: string): Row | undefined {
    return this.rows("list_members").find((row) => row.list_id === list && row.user_id === uid && row.deleted_at == null);
  }

  /** `private.my_pantry()`: the household the person joined, else their own Kiler. */
  home(uid: string): string {
    const joined = this.rows("list_members").find(
      (row) => row.user_id === uid && row.role !== "owner" && row.deleted_at == null && this.tables.get("lists")!.get(String(row.list_id))?.kind === "pantry",
    );
    return joined ? String(joined.list_id) : uid;
  }

  /** Whose a personal row is: a pantry row the Kiler's the person is in. */
  private scopeOf(table: string, uid: string): string {
    return PANTRY.has(table) ? this.home(uid) : uid;
  }

  private canRead(list: unknown, uid: string): boolean {
    return this.isOwner(list, uid) || this.membership(list, uid) != null;
  }

  private canWrite(list: unknown, uid: string): boolean {
    return this.isOwner(list, uid) || this.membership(list, uid)?.role === "editor";
  }

  private visible(table: string, row: Row, uid: string): boolean {
    if (table === "lists") return this.canRead(row.id, uid);
    if (table === "list_members") return row.user_id === uid || this.canRead(row.list_id, uid);
    if (LIST_CHILDREN.has(table)) return this.canRead(row.list_id, uid);
    return row.user_id === this.scopeOf(table, uid);
  }

  private writable(table: string, row: Row, uid: string, old: Row | undefined): boolean {
    if (table === "lists") return old ? this.canWrite(old.id, uid) : row.owner_id === uid && row.kind !== "pantry";
    if (table === "list_members") return old != null && (old.user_id === uid || this.isOwner(old.list_id, uid));
    if (LIST_CHILDREN.has(table)) return this.canWrite(row.list_id, uid);
    return row.user_id === this.scopeOf(table, uid);
  }

  /** The triggers `keep_list_owner` and `guard_list_member`: what a write may not change. */
  private guard(table: string, next: Row, old: Row, uid: string): void {
    const keepDelete = () => Object.assign(next, { deleted_at: old.deleted_at, tombstone_version: old.tombstone_version });
    if (table === "lists") {
      Object.assign(next, { owner_id: old.owner_id, kind: old.kind });
      if (old.owner_id !== uid) keepDelete();
    }
    if (table !== "list_members") return;
    Object.assign(next, { list_id: old.list_id, user_id: old.user_id });
    if (old.role === "owner") {
      next.role = "owner";
      keepDelete();
    } else if (!this.isOwner(old.list_id, uid)) next.role = old.role;
    if (old.deleted_at != null) keepDelete();
    if (old.user_id !== uid) Object.assign(next, { name: old.name, seen_at: old.seen_at });
  }

  /** What `rows` holds on the server now, whoever it belongs to. */
  rows(table: string): Row[] {
    return [...this.tables.get(table)!.values()].map((row) => ({ ...row }));
  }

  /** A row a statement wrote this long before the latest one: a transaction that committed late. */
  insertLate(table: string, row: Row, microsBefore: number): void {
    const latest = Math.max(...this.rows(table).map((stored) => micros(String(stored.updated_at))));
    const stored = { created_at: timestamptz(latest - microsBefore), deleted_at: null, tombstone_version: 0, ...row, updated_at: timestamptz(latest - microsBefore) };
    this.tables.get(table)!.set(this.keyOf(table, stored), stored);
  }

  private upsert(table: string, rows: Row[]): Reply {
    const uid = this.user;
    if (!uid) return { data: null, error: { message: "permission denied for table " + table, code: "42501" } };
    const stored = this.tables.get(table)!;
    const staged = new Map(stored);
    const now = this.now();
    const answer: Row[] = [];
    // PostgREST's bulk insert names the union of the rows' keys, and a row
    // that lacks one writes null into it (supabase-js's `defaultToNull`).
    const named = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    for (const incoming of rows) {
      const row: Row = { ...Object.fromEntries(named.map((column) => [column, null])), ...incoming };
      if (table === "lists") row.owner_id ??= uid;
      if (PERSONAL.has(table)) row.user_id ??= uid;
      const key = this.keyOf(table, row);
      const old = staged.get(key);
      const refused = { data: null, error: { message: `new row violates row-level security policy for table "${table}"`, code: "42501" } };
      if (old && !this.writable(table, old, uid, old)) return refused;
      let next: Row = { ...old, ...row };
      // `private.keep_live_values` (migration 16): a row made afresh over a live one fills only what it lacks.
      if (old && FRESH_OVER_LIVE.has(table) && old.deleted_at == null && next.deleted_at == null && micros(String(next.created_at)) !== micros(String(old.created_at))) {
        next = { ...old, ...Object.fromEntries(Object.entries(row).filter(([, value]) => value != null)), created_at: old.created_at };
      }
      if (old) this.guard(table, next, old, uid);
      if (!this.writable(table, next, uid, old)) return refused;
      if (typeof next.name === "string" && ([...next.name].length < 1 || [...next.name].length > 200)) {
        return { data: null, error: { message: `new row for relation "${table}" violates check constraint`, code: "23514" } };
      }
      const version = Number(next.tombstone_version ?? 0);
      let kept = false;
      if (!old) {
        if (next.deleted_at != null && version === 0) next.tombstone_version = 1;
      } else if (version < Number(old.tombstone_version)) {
        next = { ...old };
        kept = true;
      } else if (old.deleted_at == null && next.deleted_at != null) {
        if (version !== Number(old.tombstone_version) && version !== Number(old.tombstone_version) + 1) {
          return { data: null, error: { message: "invalid tombstone generation", code: "23514" } };
        }
        next.tombstone_version = Number(old.tombstone_version) + 1;
      } else if (version !== Number(old.tombstone_version)) {
        return { data: null, error: { message: "invalid tombstone generation", code: "23514" } };
      }
      if (!kept) {
        next.updated_at = timestamptz(now);
        for (const column of ["created_at", "deleted_at", "checked_at", "bought_at", "finished_at"]) {
          if (typeof next[column] === "string") next[column] = timestamptz(micros(String(next[column])));
        }
      }
      staged.set(key, next);
      answer.push({ ...next });
    }
    this.tables.set(table, staged);
    return { data: answer, error: null };
  }

  private select(table: string, filter: { after?: { us: number; id: string }; from?: number; limit: number; eq?: [string, string][] }): Reply {
    const uid = this.user;
    if (!uid) return { data: null, error: { message: "permission denied for table " + table, code: "42501" } };
    const sorted = this.rows(table)
      .filter((row) => this.visible(table, row, uid) && (filter.eq ?? []).every(([column, value]) => row[column] === value))
      .map((row) => ({ row, us: micros(String(row.updated_at)) }))
      .filter(({ row, us }) =>
        filter.after
          ? us > filter.after.us || (us === filter.after.us && String(row.id) > filter.after.id)
          : us >= (filter.from ?? 0))
      .sort((a, b) => a.us - b.us || String(a.row.id).localeCompare(String(b.row.id)));
    return { data: sorted.slice(0, filter.limit).map(({ row }) => row), error: null };
  }

  /** A row a statement writes as the server, past every policy. */
  private serverWrite(table: string, row: Row): void {
    const at = timestamptz(this.now());
    const stored = { created_at: at, deleted_at: null, tombstone_version: 0, ...row, updated_at: at };
    this.tables.get(table)!.set(this.keyOf(table, stored), stored);
  }

  /**
   * `private.join_household`: refused (and the token kept) while the person is
   * in another household or others are in theirs; otherwise what they brought
   * arrives as counted, and their own Kiler is emptied.
   */
  private joinHousehold(household: string, uid: string, pantry: unknown): Failure | "joined" | "already" {
    if (this.home(uid) === household) return "already";
    if (pantry == null) return { message: "this version cannot join a household", code: "ZK003" };
    if (this.home(uid) !== uid) return { message: "in another household", code: "ZK001" };
    if (this.rows("list_members").some((row) => row.list_id === uid && row.role !== "owner" && row.deleted_at == null)) {
      return { message: "others are in this Kiler", code: "ZK002" };
    }
    for (const [token, invite] of this.invites) if (invite.list === uid) this.invites.delete(token);
    for (const [key, offer] of this.offers) if (offer.list === uid) this.offers.delete(key);
    for (const entry of pantry as Row[]) {
      const held = this.tables.get("pantry_items")!.get(`${household}|${String(entry.id)}`);
      if (!held) {
        this.serverWrite("pantry_items", { user_id: household, id: entry.id, name: entry.name, list_id: entry.list_id, expires_on: entry.expires_on, sort_order: 0 });
      } else if (held.deleted_at != null) {
        this.serverWrite("pantry_items", { ...held, deleted_at: null });
      }
      if (Number(entry.quantity_milli) > 0) {
        this.serverWrite("pantry_moves", { user_id: household, id: crypto.randomUUID(), pantry_item_id: entry.id, quantity_milli: entry.quantity_milli, unit: entry.unit });
      }
    }
    for (const table of PANTRY) {
      for (const row of this.rows(table)) {
        if (row.user_id === uid && row.deleted_at == null) {
          this.serverWrite(table, { ...row, deleted_at: timestamptz(this.clock), tombstone_version: Number(row.tombstone_version) + 1 });
        }
      }
    }
    return "joined";
  }

  /**
   * `private.admit`: the person joins `list` as `role`, the offer to them
   * going with it. A refusal changes nothing, as the statement it fails rolls back.
   */
  private admit(list: string, role: string, uid: string, name: unknown, pantry: unknown): Failure | null {
    if (!this.isOwner(list, uid)) {
      const joined = this.tables.get("lists")!.get(list)?.kind === "pantry" ? this.joinHousehold(list, uid, pantry) : null;
      if (typeof joined === "object" && joined) return joined;
      if (joined !== "already") {
        const held = this.rows("list_members").find((row) => row.list_id === list && row.user_id === uid);
        this.serverWrite("list_members", { ...held, id: held?.id ?? crypto.randomUUID(), list_id: list, user_id: uid, role, name: name ?? "", seen_at: held?.seen_at ?? null, deleted_at: null });
      }
    }
    this.offers.delete(`${list}|${uid}`);
    return null;
  }

  private isLive(list: string): boolean {
    const row = this.tables.get("lists")!.get(list);
    return row != null && row.deleted_at == null;
  }

  /** `private.my_offers()`: a hash of the offers to `uid` on live lists, null when none waits. */
  private offersHash(uid: string): string | null {
    const mine = [...this.offers.values()].filter((offer) => offer.to === uid && this.isLive(offer.list));
    if (mine.length === 0) return null;
    const hex = createHash("md5").update(mine.map((offer) => `${offer.list}:${offer.role}`).sort().join(",")).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /** `offer_list`: the owner of a live list, to someone in a live list with them and not yet in this one. */
  private offerList(uid: string, args: Record<string, unknown>): Reply {
    const invalid = (message: string) => ({ data: null, error: { message, code: "22023" } });
    const list = String(args.list);
    const person = typeof args.person === "string" ? args.person : null;
    if (args.role == null) {
      if (person && this.isOwner(list, uid)) this.offers.delete(`${list}|${person}`);
      return { data: null, error: null };
    }
    if (args.role !== "editor" && args.role !== "viewer") return invalid("invalid role");
    if (list === uid) {
      if (this.home(uid) !== uid) return { data: null, error: { message: "in another household", code: "ZK001" } };
      if (args.role !== "editor") return invalid("a household has no viewers");
      if (!this.tables.get("lists")!.has(uid)) {
        this.serverWrite("lists", { id: uid, owner_id: uid, name: "Kiler", kind: "pantry", color: null, icon: null, pantry: true });
      }
    }
    if (!this.isOwner(list, uid) || !this.isLive(list)) return { data: null, error: { message: "not the owner of this list", code: "42501" } };
    if (!person || person === uid) return invalid("an offer is to someone else");
    if (this.membership(list, person)) return { data: null, error: { message: "already in this list", code: "ZK004" } };
    const shared = this.rows("list_members").some(
      (theirs) => theirs.user_id === person && theirs.deleted_at == null && this.isLive(String(theirs.list_id)) && this.membership(theirs.list_id, uid),
    );
    if (!shared) return { data: null, error: { message: "shares no list with you", code: "ZK005" } };
    if (!this.rows("list_members").some((row) => row.list_id === list && row.user_id === uid)) {
      this.serverWrite("list_members", { id: crypto.randomUUID(), list_id: list, user_id: uid, role: "owner", name: args.owner_name ?? "", seen_at: null });
    }
    this.offers.set(`${list}|${person}`, { list, role: String(args.role), by: uid, to: person });
    return { data: null, error: null };
  }

  /** `answer_offer`: decline deletes the offer; accept admits, and a refusal leaves it waiting. */
  private answerOffer(uid: string, args: Record<string, unknown>): Reply {
    const invalid = (message: string) => ({ data: null, error: { message, code: "22023" } });
    const list = String(args.list);
    const offer = this.offers.get(`${list}|${uid}`);
    if (typeof args.accept !== "boolean") return invalid("accept or decline");
    if (!offer) return invalid("offer not found");
    if (!args.accept) {
      this.offers.delete(`${list}|${uid}`);
      return { data: null, error: null };
    }
    if (!this.isLive(list)) return invalid("offer not found");
    const refused = this.admit(list, offer.role, uid, args.member_name, args.pantry);
    return refused ? { data: null, error: refused } : { data: list, error: null };
  }

  private rpc(name: string, args: Record<string, unknown> = {}): Reply {
    const uid = this.user;
    if (!uid) return { data: null, error: { message: "permission denied for function " + name, code: "42501" } };
    const invalid = (message: string) => ({ data: null, error: { message, code: "22023" } });
    if (name === "create_list_invite") {
      const list = String(args.list);
      if (args.invite_role !== "editor" && args.invite_role !== "viewer") return invalid("invalid role");
      if (list === uid) {
        if (this.home(uid) !== uid) return { data: null, error: { message: "in another household", code: "ZK001" } };
        if (args.invite_role !== "editor") return invalid("a household has no viewers");
        if (!this.tables.get("lists")!.has(uid)) {
          this.serverWrite("lists", { id: uid, owner_id: uid, name: "Kiler", kind: "pantry", color: null, icon: null, pantry: true });
        }
      }
      if (!this.isOwner(list, uid) || this.tables.get("lists")!.get(list)?.deleted_at != null) {
        return { data: null, error: { message: "not the owner of this list", code: "42501" } };
      }
      if (!this.rows("list_members").some((row) => row.list_id === list && row.user_id === uid)) {
        this.serverWrite("list_members", { id: crypto.randomUUID(), list_id: list, user_id: uid, role: "owner", name: args.owner_name ?? "", seen_at: null });
      }
      const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
      this.invites.set(token, { list, role: String(args.invite_role) });
      return { data: token, error: null };
    }
    if (name === "peek_list_invite") {
      const invite = this.invites.get(String(args.token));
      const list = invite && this.tables.get("lists")!.get(invite.list);
      const owner = list && this.rows("list_members").find((row) => row.list_id === list.id && row.role === "owner");
      return { data: list ? [{ kind: list.kind, name: list.name, inviter: owner?.name ?? "" }] : [], error: null };
    }
    if (name === "accept_list_invite") {
      const invite = this.invites.get(String(args.token));
      if (!invite) return invalid("invite not found");
      const refused = this.admit(invite.list, invite.role, uid, args.member_name, args.pantry);
      if (refused) return { data: null, error: refused };
      this.invites.delete(String(args.token));
      return { data: invite.list, error: null };
    }
    if (name === "offer_list") return this.offerList(uid, args);
    if (name === "answer_offer") return this.answerOffer(uid, args);
    if (name === "list_offers") {
      const offers = [...this.offers.values()].filter((offer) => (offer.to === uid || offer.by === uid) && this.isLive(offer.list));
      return {
        data: offers.map((offer) => {
          const list = this.tables.get("lists")!.get(offer.list)!;
          const owner = this.rows("list_members").find((row) => row.list_id === offer.list && row.user_id === list.owner_id);
          return { list_id: offer.list, list_name: list.name, kind: list.kind, role: offer.role, from_name: owner?.name ?? "", to_user: offer.to };
        }),
        error: null,
      };
    }
    if (name === "unnamed_photos") {
      const named = (photo: string) => ["items", "wishes", "shops"].some((table) => this.rows(table).some((row) => row.photo_id === photo && row.deleted_at == null));
      const month = Date.now() - 30 * 86_400_000;
      return { data: [...this.objects].filter(([path, object]) => object.owner === uid && object.at < month && !named(PHOTO_OBJECT.exec(path)![1]!)).map(([path]) => path), error: null };
    }
    if (name === "own_photo_objects") {
      return { data: [...this.objects].filter(([, object]) => object.owner === uid).map(([path]) => path), error: null };
    }
    if (name !== "sync_cursors") return { data: null, error: { message: "no such function", code: "PGRST202" } };
    return {
      data: [
        ...TABLES.map((table) => {
          const head = (this.select(table, { limit: Number.MAX_SAFE_INTEGER }).data as Row[]).at(-1);
          return { table_name: table, max_updated_at: head?.updated_at ?? null, max_id: head?.id ?? null };
        }),
        { table_name: "pantry_home", max_updated_at: null, max_id: this.home(uid) },
        { table_name: "offers", max_updated_at: null, max_id: this.offersHash(uid) },
      ],
      error: null,
    };
  }

  private canSeePhoto(photo: string, uid: string): boolean {
    return ["items", "wishes", "shops"].some((table) =>
      this.rows(table).some((row) => row.photo_id === photo && this.visible(table, row, uid)));
  }

  /** `private.can_place_photo` (migration 14): where the uploader may write every list a row naming it is on. */
  private canPlacePhoto(photo: string, uid: string): boolean {
    return ["items", "wishes", "shops"].every((table) =>
      this.rows(table).every((row) => row.photo_id !== photo || this.canWrite(row.list_id, uid)));
  }

  /** Keep the next `request` (`"upsert lists"`) unanswered until the returned release, so a test can act while it is in flight. */
  hold(request: string): () => void {
    let release!: () => void;
    this.holds.set(request, new Promise((resolve) => (release = resolve)));
    return release;
  }

  private async answer<T>(request: string, signal: AbortSignal | undefined, reply: () => T): Promise<T> {
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    this.requests.push(request);
    const aimed = [...this.failOn.keys()].find((prefix) => request.startsWith(prefix));
    const failure = aimed ? this.failOn.get(aimed) : this.failures.shift();
    if (aimed) this.failOn.delete(aimed);
    const held = this.holds.get(request);
    this.holds.delete(request);
    // Once sent, a request is the server's: an abort meanwhile does not undo it.
    if (held) await held;
    if (failure) return { data: null, error: failure } as T;
    return reply();
  }

  /** The slice of a `SupabaseClient` the engine touches. */
  client() {
    const cloud = this;
    const from = (table: string) => {
      let upserting: Row[] | null = null;
      let conflict: string | undefined;
      const filter: { after?: { us: number; id: string }; from?: number; limit: number; eq?: [string, string][] } = { limit: 1000 };
      const builder = {
        upsert(rows: Row[], options: { onConflict?: string }) {
          upserting = rows;
          conflict = options.onConflict;
          return builder;
        },
        select: () => builder,
        order: () => builder,
        eq(column: string, value: string) {
          filter.eq = [...(filter.eq ?? []), [column, value]];
          return builder;
        },
        limit(count: number) {
          filter.limit = count;
          return builder;
        },
        gte(_column: string, value: string) {
          filter.from = micros(value);
          return builder;
        },
        or(expression: string) {
          const match = /^updated_at\.gt\.(.+),and\(updated_at\.eq\.(.+),id\.gt\.(.+)\)$/.exec(expression);
          if (!match || match[1] !== match[2]) throw new Error(`unexpected filter ${expression}`);
          filter.after = { us: micros(match[1]!), id: match[3]! };
          return builder;
        },
        abortSignal(signal: AbortSignal) {
          return cloud.answer(`${upserting ? "upsert" : "select"} ${table}`, signal, () => {
            if (!upserting) return cloud.select(table, filter);
            const expected = cloud.keyColumns(table).join(",");
            if (conflict !== expected) throw new Error(`upsert ${table} on ${conflict}, not ${expected}`);
            return cloud.upsert(table, upserting);
          });
        },
      };
      return builder;
    };
    return {
      from,
      rpc(name: string, args?: Record<string, unknown>) {
        // Lazy, as PostgREST's builder is: nothing is asked until it is awaited.
        const call = (signal?: AbortSignal) => cloud.answer(`rpc ${name}`, signal, () => cloud.rpc(name, args));
        return { abortSignal: call, then: (resolve: (reply: Reply) => unknown, reject: (error: unknown) => unknown) => call().then(resolve, reject) };
      },
      auth: {
        getSession: async () =>
          cloud.sessionFailure
            ? { data: { session: null }, error: Object.assign(new Error(cloud.sessionFailure.message), { name: "AuthRetryableFetchError" }) }
            : { data: { session: cloud.user ? { user: { id: cloud.user } } : null }, error: null },
        refreshSession: async () => {
          const failure = cloud.refreshFailures.shift();
          if (failure) return { data: { session: null }, error: Object.assign(new Error(failure.message), { name: failure.code ?? "AuthApiError" }) };
          return { data: { session: cloud.user ? { user: { id: cloud.user } } : null }, error: null };
        },
      },
      storage: {
        from: (bucket: string) => {
          if (bucket !== "photos") throw new Error(`unexpected bucket ${bucket}`);
          return {
            upload: (path: string, body: Uint8Array, options: { contentType?: string; upsert?: boolean }) =>
              cloud.answer(`upload ${path}`, undefined, () => {
                const uid = cloud.user;
                const existing = cloud.objects.get(path);
                const photo = PHOTO_OBJECT.exec(path)?.[1];
                const refused = { data: null, error: { message: "new row violates row-level security policy", status: 403 } };
                if (!uid || !photo || options.contentType !== "image/jpeg") return refused;
                if (existing && (!options.upsert || existing.owner !== uid)) return { data: null, error: { message: "The resource already exists", status: 409 } };
                if (!existing && !cloud.canPlacePhoto(photo, uid)) return refused;
                cloud.objects.set(path, { owner: uid, bytes: new Uint8Array(body), at: Date.now() });
                return { data: { path }, error: null };
              }),
            download: (path: string) =>
              cloud.answer(`download ${path}`, undefined, () => {
                if (cloud.downloadFailure) return { data: null, error: cloud.downloadFailure };
                const uid = cloud.user;
                const object = cloud.objects.get(path);
                const photo = PHOTO_OBJECT.exec(path)?.[1];
                if (!uid || !object || !photo || (object.owner !== uid && !cloud.canSeePhoto(photo, uid))) {
                  return { data: null, error: { message: "Object not found", status: 404 } };
                }
                return { data: new Blob([object.bytes as BlobPart], { type: "image/jpeg" }), error: null };
              }),
            remove: (paths: string[]) =>
              cloud.answer(`remove ${paths.length}`, undefined, () => {
                for (const path of paths) if (cloud.objects.get(path)?.owner === cloud.user) cloud.objects.delete(path);
                return { data: [], error: null };
              }),
          };
        },
      },
    };
  }
}
