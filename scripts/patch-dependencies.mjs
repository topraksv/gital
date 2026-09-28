// Changes applied to installed dependencies, Helix's runner. Runs on every
// install. A dependency whose text no longer matches fails the install: check
// whether the change is still needed, then drop or redo the patch.
import { readFileSync, writeFileSync } from "node:fs";

const PATCHES = [
  {
    // expo-sqlite keeps every web database in one OPFS folder named after its
    // VFS, and its pool holds an exclusive handle on each file in that folder.
    // Gital and Helix share the topraksv.github.io origin, so whichever opened
    // first locked the other out: "Listeler açılamadı" here, "Helix başka bir
    // sekmede açık" there (2026-09-28). A folder of Gital's own ends that.
    file: "node_modules/expo-sqlite/web/worker.ts",
    edits: [["const VFS_NAME_PERSISTENT = 'expo-sqlite';", "const VFS_NAME_PERSISTENT = 'gital-sqlite';"]],
  },
];

for (const { file, edits } of PATCHES) {
  let text = readFileSync(file, "utf8");
  if (edits.every(([, after]) => text.includes(after))) continue;
  for (const [before, after] of edits) {
    if (text.split(before).length !== 2) throw new Error(`${file} no longer matches its patch; check whether it is still needed.`);
    text = text.replace(before, after);
  }
  writeFileSync(file, text);
}
