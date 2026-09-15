import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
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
 * ## What it does
 *
 * Runs codegen into memory and compares. A difference means somebody edited the config and did not
 * re-run it, or edited the output by hand — both of which a reviewer should see as a diff rather
 * than discover at run time.
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

const stale = [];
for (const project of projects(root)) {
  const out = /\boutDir\s*:\s*["'`]([^"'`]+)["'`]/.exec(readFileSync(join(project, "ramonda.css.ts"), "utf8"));
  const folder = join(project, out?.[1] ?? "css-system");

  const before = new Map();
  for (const name of ["index.ts", "variables.css"]) {
    try {
      before.set(name, readFileSync(join(folder, name), "utf8"));
    } catch {
      before.set(name, undefined);
    }
  }

  execFileSync(process.execPath, [join(root, "packages", "css", "bin.mjs"), "codegen"], {
    cwd: project,
    stdio: "ignore",
  });

  for (const [name, was] of before) {
    let now;
    try {
      now = readFileSync(join(folder, name), "utf8");
    } catch {
      now = undefined;
    }
    if (was !== now) stale.push(relative(root, join(folder, name)));
  }
}

if (stale.length > 0) {
  console.error(
    `\n${TAG} ${stale.length} generated file(s) do not match the config beside them:\n\n` +
      stale.map((one) => `  - ${one}`).join("\n") +
      `\n\n  Run \`ramonda-css codegen\` in that project and commit the result. These files are\n` +
      `  committed on purpose — the gate is what keeps them honest, not hiding them.\n`,
  );
  process.exit(1);
}

console.log(`${TAG} every committed css-system matches its config`);
