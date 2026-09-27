/**
 * The server half of sync, as the engine meets it through supabase-js: the
 * PostgREST calls it makes, the two RPCs, Storage and the session. It keeps
 * what `supabase/migrations/00000000000003_sync.sql` decides — the server's
 * clock in microseconds, one `now()` per statement, the delete generation,
 * who may read and write which row, a personal row keyed by its person, and a
 * statement that fails whole — so the engine is tested against the rules it
 * will meet, and `supabase/tests/sync_rls.sql` proves the real server keeps
 * the same ones.
 */

type Row = Record<string, unknown>;
// `status` is Storage's: set, possibly undefined, on every error it returns.
type Failure = { message: string; code?: string; status?: number };
type Reply = { data: unknown; error: Failure | null };

const PERSONAL = new Set(["products", "sets", "set_items", "pantry_items", "pantry_moves", "settings"]);
const LIST_CHILDREN = new Set(["shops", "items", "wishes", "wish_links"]);
export const TABLES = ["lists", "shops", "items", "wishes", "wish_links", "products", "sets", "set_items", "pantry_items", "pantry_moves", "settings"];
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
  readonly objects = new Map<string, { owner: string; bytes: Uint8Array }>();
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
    return PERSONAL.has(table) ? `${String(row.user_id)}|${String(row.id)}` : String(row.id);
  }

  private visible(table: string, row: Row, uid: string): boolean {
    if (table === "lists") return row.owner_id === uid;
    if (LIST_CHILDREN.has(table)) return this.tables.get("lists")!.get(String(row.list_id))?.owner_id === uid;
    return row.user_id === uid;
  }

  private writable(table: string, row: Row, uid: string): boolean {
    if (table === "lists") return row.owner_id === uid;
    return this.visible(table, row, uid);
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
    for (const incoming of rows) {
      const row = { ...incoming };
      if (table === "lists") row.owner_id ??= uid;
      if (PERSONAL.has(table)) row.user_id ??= uid;
      const key = this.keyOf(table, row);
      const old = staged.get(key);
      const refused = { data: null, error: { message: `new row violates row-level security policy for table "${table}"`, code: "42501" } };
      if (old && !this.writable(table, old, uid)) return refused;
      let next: Row = { ...old, ...row };
      if (table === "lists" && old) next.owner_id = old.owner_id;
      if (!this.writable(table, next, uid)) return refused;
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

  private select(table: string, filter: { after?: { us: number; id: string }; from?: number; limit: number }): Reply {
    const uid = this.user;
    if (!uid) return { data: null, error: { message: "permission denied for table " + table, code: "42501" } };
    const sorted = this.rows(table)
      .filter((row) => this.visible(table, row, uid))
      .map((row) => ({ row, us: micros(String(row.updated_at)) }))
      .filter(({ row, us }) =>
        filter.after
          ? us > filter.after.us || (us === filter.after.us && String(row.id) > filter.after.id)
          : us >= (filter.from ?? 0))
      .sort((a, b) => a.us - b.us || String(a.row.id).localeCompare(String(b.row.id)));
    return { data: sorted.slice(0, filter.limit).map(({ row }) => row), error: null };
  }

  private rpc(name: string): Reply {
    const uid = this.user;
    if (!uid) return { data: null, error: { message: "permission denied for function " + name, code: "42501" } };
    if (name === "own_photo_objects") {
      return { data: [...this.objects].filter(([, object]) => object.owner === uid).map(([path]) => path), error: null };
    }
    if (name !== "sync_cursors") return { data: null, error: { message: "no such function", code: "PGRST202" } };
    return {
      data: TABLES.map((table) => {
        const head = (this.select(table, { limit: Number.MAX_SAFE_INTEGER }).data as Row[]).at(-1);
        return { table_name: table, max_updated_at: head?.updated_at ?? null, max_id: head?.id ?? null };
      }),
      error: null,
    };
  }

  private canSeePhoto(photo: string, uid: string): boolean {
    return ["items", "wishes"].some((table) =>
      this.rows(table).some((row) => row.photo_id === photo && this.visible(table, row, uid)));
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
    const failure = this.failures.shift();
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
      const filter: { after?: { us: number; id: string }; from?: number; limit: number } = { limit: 1000 };
      const builder = {
        upsert(rows: Row[], options: { onConflict?: string }) {
          upserting = rows;
          conflict = options.onConflict;
          return builder;
        },
        select: () => builder,
        order: () => builder,
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
            const expected = PERSONAL.has(table) ? "user_id,id" : "id";
            if (conflict !== expected) throw new Error(`upsert ${table} on ${conflict}, not ${expected}`);
            return cloud.upsert(table, upserting);
          });
        },
      };
      return builder;
    };
    return {
      from,
      rpc(name: string) {
        // Lazy, as PostgREST's builder is: nothing is asked until it is awaited.
        const call = (signal?: AbortSignal) => cloud.answer(`rpc ${name}`, signal, () => cloud.rpc(name));
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
                if (!uid || !PHOTO_OBJECT.test(path) || options.contentType !== "image/jpeg") {
                  return { data: null, error: { message: "new row violates row-level security policy" } };
                }
                if (existing && (!options.upsert || existing.owner !== uid)) return { data: null, error: { message: "The resource already exists" } };
                cloud.objects.set(path, { owner: uid, bytes: new Uint8Array(body) });
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
