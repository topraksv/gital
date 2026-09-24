/**
 * The migration runner over drizzle-kit's journal, Helix's (`src/db/migrate.ts`):
 * asynchronous, and with the same bookkeeping as Drizzle's own migrator — the
 * `__drizzle_migrations` table, compared by the journal's `when`. Its `hash`
 * column exists for that compatibility and is left empty.
 */

import { getSqliteAsync, withTransaction } from "./client";
import migrations from "./migrations/migrations";

export async function migrateDb(): Promise<void> {
  const db = await getSqliteAsync();
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`,
  );
  const last = await db.getFirstAsync<{ created_at: number }>(
    `SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
  );
  const appliedUpTo = Number(last?.created_at ?? 0);

  for (const entry of migrations.journal.entries) {
    if (entry.when <= appliedUpTo) continue;
    const key = `m${String(entry.idx).padStart(4, "0")}` as keyof typeof migrations.migrations;
    const sqlBundle = migrations.migrations[key];
    if (!sqlBundle) throw new Error(`Missing migration: ${entry.tag}`);
    // Each migration and its bookkeeping row land together, so a failure part
    // way leaves the database at the previous migration rather than between two.
    await withTransaction(async () => {
      for (const statement of sqlBundle.split("--> statement-breakpoint")) {
        await db.execAsync(statement);
      }
      await db.runAsync(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, ["", entry.when]);
    });
  }
}
