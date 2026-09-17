import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Every committed `css-system/` matches the `ramonda.css.ts` beside it.
 *
 * ## Why this exists rather than a `.gitignore` line
 *
 * The output used to be ignored, and the reason written there was that committing it would let a
 * config and its output drift apart in review. That is the right worry and the wrong answer:
 * hiding a file does not stop it drifting, it stops anybody SEEING that it has — and it costs a
 * fresh clone its `$` until something builds, which an editor meets before any build runs.
 *
 * This repository already answers the same worry the other way for `keywords.generated.ts`: the
 * file is in the tree and `build-css-properties.mjs --check` fails when it is stale. One argument,
 * one answer, and this is it for the second generator.
 *
 * ## What it does, and what it stopped doing
 *
 * It asks `ramonda-css codegen --check`, which writes nothing and exits non-zero when the pair no
 * longer matches. That is one question to the tool that owns the answer.
 *
 * It used to re-derive all of it here: read both files, RUN codegen over the author's tree, and
 * compare. Three faults came with that, and each one was measured.
 *
 *   - A red run left the working copy MODIFIED, then told the reader to run the command it had
 *     just run for them.
 *   - It carried its own copy of the `outDir` regex to find the folder — a third reader of a
 *     setting, and the arrangement this repository keeps finding a fault in.
 *   - `stdio: "ignore"` with no `try`, so a config codegen REFUSES killed the gate with a raw Node
 *     stack trace and a `status: 1` object, and threw away the sentence explaining why.
 */

const root = join(import.meta.dirname, "..");
const TAG = "[css-system]";

/** Every directory holding a `ramonda.css.ts`, which is what makes it a project here. */
function projects(from, found = []) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const path = join(from, entry.name);
    if (entry.isDirectory()) projects(path, found);
    else if (entry.name === "ramonda.css.ts") found.push(from);
  }
  return found;
}

const found = projects(root);

/**
 * A project has to have been found, or every comparison below is vacuous.
 *
 * Measured by emptying the scan: it printed *0 project(s) — every committed css-system matches its
 * config* and exited 0. The sentence is the proof this script exists to give, and it gave it about
 * nothing.
 */
if (found.length === 0) {
  console.error(`\n${TAG} no project with a \`ramonda.css.ts\` was found, so nothing was compared.\n`);
  process.exit(1);
}
let refused = 0;

for (const project of found) {
  const where = relative(root, project) || ".";
  try {
    execFileSync(process.execPath, [join(root, "packages", "css", "bin.mjs"), "codegen", "--check"], {
      cwd: project,
      stdio: ["ignore", "ignore", "inherit"],
    });
  } catch {
    // Codegen has already said what is wrong, on stderr, in its own words — a stale pair or a
    // config it refuses. Naming the project is the only thing this can add.
    console.error(`${TAG} ${where}\n`);
    refused++;
  }
}

if (refused > 0) process.exit(1);

console.log(`${TAG} ${found.length} project(s) — every committed css-system matches its config`);
