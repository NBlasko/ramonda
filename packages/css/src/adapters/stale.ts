import { readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * Whether the built package is older than the sources it was built from.
 *
 * ## The fault it exists for
 *
 * Everything a person actually runs reads `dist`: this plugin, the editor's language plugin, the
 * documentation gate, and the build test that compiles a real project. The TESTS read `src`. So a
 * fix can be green in every test and absent from everything the person touches — and there is
 * nothing to see, because the artefact is perfectly valid, just old. A person testing a committed
 * fix against a `dist` twenty minutes old reports the bug as still present, and is right.
 *
 * ## Why it warns rather than refusing
 *
 * A refusal would be wrong in the case this is most likely to fire in: somebody who cloned the
 * repository and has not built yet, whose `dist` is missing rather than stale, and whose next
 * command is the build. And a stale `dist` still WORKS — it is a previous version of a working
 * package, not a broken one.
 *
 * What it must not do is be silent.
 *
 * ## Why mtimes rather than a hash
 *
 * A hash would be exact and would have to read every source file on every plugin construction. This
 * runs once per dev server and answers a question whose only consequence is a sentence on a
 * terminal, so the cheap comparison is the right one — and mtime is what a build tool already
 * trusts for the same decision.
 */
function newest(directory: string): number {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    // Absent, or not ours to read. `0` is "nothing to compare", which the caller is already silent
    // about — and it is a per-DIRECTORY answer, so it cannot take the other walk down with it.
    return 0;
  }

  let latest = 0;
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue;
    const path = join(directory, entry.name);
    let at: number;
    try {
      at = entry.isDirectory() ? newest(path) : statSync(path).mtimeMs;
    } catch {
      // A file that vanished between the listing and the stat, which is a build writing into the
      // directory this is reading — exactly when it runs. One entry skipped, not the whole answer.
      continue;
    }
    if (at > latest) latest = at;
  }
  return latest;
}

/**
 * Says so, once, when `dist` is behind `src`.
 *
 * Silent in every other case, including when there are no sources to compare against — a published
 * package has no `src`, and warning there would be telling somebody about a directory they will
 * never have.
 */
export function warnIfStale(from: string, say: (message: string) => void): void {
  // The package root holds `dist` and `src`, so it is the parent of the nearest of them above
  // `from` — `dist/vite.js` once built, `src/adapters/vite.ts` in a test.
  let below = dirname(from);
  while (!["dist", "src"].includes(basename(below)) && dirname(below) !== below) below = dirname(below);
  const root = dirname(below);
  /**
   * Each walk answers for itself. In one shared `try`, anything thrown in either — a directory
   * nobody may read, a file a running build deletes between the listing and the stat — would
   * abandon the comparison and say nothing, and silence is what this warning exists to stop.
   *
   * `0` is "nothing to compare with", which is also what an absent directory gives: no `src` is a
   * published package, no `dist` is a checkout about to be built, and neither is a fault.
   */
  const source = newest(join(root, "src"));
  const built = newest(join(root, "dist"));

  if (source === 0 || built === 0 || built >= source) return;

  const behind = Math.round((source - built) / 60_000);
  say(
    `[ramonda-css] this package's \`dist\` is ${behind === 0 ? "older than" : `${behind} minute(s) behind`} ` +
      `its \`src\`, so you are running a previous version of the compiler.\n` +
      `             Run \`pnpm --filter @ramonda/css build\` — the tests read \`src\` and everything ` +
      `else reads \`dist\`, so a fix can be green and absent from what you are running.`,
  );
}
