/** The lists a screen reads and the four things it can do to one. */

import { asc, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb } from "../db/client";
import { fromDbShape, readLiveRow, restoreRow, softDelete, writeRows, type RowSnapshot } from "../db/mutations";
import { lists } from "../db/schema";
import { listNameFrom } from "../domain/lists";

export interface ListSummary {
  id: string;
  name: string;
}

/** Oldest first, so a new list joins the end and nothing already there moves. */
export function readLists(): Promise<ListSummary[]> {
  return getDb()
    .select({ id: lists.id, name: lists.name })
    .from(lists)
    .where(isNull(lists.deletedAt))
    .orderBy(asc(lists.createdAt), asc(lists.id));
}

function nameOrThrow(input: string): string {
  const name = listNameFrom(input);
  // The screens never offer an empty name; this is the layer that cannot rely on it.
  if (name == null) throw new Error("A list needs a name");
  return name;
}

export async function createList(input: string): Promise<string> {
  const name = nameOrThrow(input);
  const id = uuidv7();
  await writeRows([{ table: "lists", row: { id, name } }]);
  return id;
}

export async function renameList(id: string, input: string): Promise<void> {
  const name = nameOrThrow(input);
  const current = await readLiveRow("lists", id);
  // An unchanged name is not an edit: stamped as one, it would beat a real
  // rename made elsewhere under last-writer-wins.
  if (current.name === name) return;
  // The whole row, never the changed column alone: the server may meet this
  // event before it has the row. Checked again inside the write, because the
  // list can be deleted between the read and the commit.
  await writeRows([{ table: "lists", row: { ...fromDbShape("lists", current), name } }], async () => {
    await readLiveRow("lists", id);
  });
}

/** Returns what undo needs, or `null` when the list was already gone. */
export function deleteList(id: string): Promise<RowSnapshot | null> {
  return softDelete("lists", id);
}

export function restoreList(snapshot: RowSnapshot): Promise<void> {
  return restoreRow("lists", snapshot);
}
