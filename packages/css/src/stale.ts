import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Whether the built package is older than the sources it was built from.
 *
 * ## The fault it exists for, which cost a day
 *
 * Everything a person actually runs reads `dist`: this plugin, the editor's language plugin, the
 * documentation gate, and the build test that compiles a real project. The TESTS read `src`. So a
 * fix can be green in every test and absent from everything the person touches — and there is
 * nothing to see, because the artefact is perfectly valid, just old.
 *
 * On 2026-09-07 that happened three times in one session, and the third one was the expensive one: a
 * fix to nested conditions was committed, the tests were green, and the person testing it was handed
 * a `dist` twenty minutes old. They reported the bug as still present. **They were right, and the
 * source was right, and neither fact helped.**
 *
 * ## Why it warns rather than refusing
 *
 * A refusal would be wrong in the case this is most likely to fire in: somebody who cloned the
 * repository and has not built yet, whose `dist` is missing rather than stale, and whose next
 * command is the build. And a stale `dist` still WORKS — it is a previous version of a working
 * package, not a broken one.
 *
 * What it must not do is be silent, because silence is exactly what cost the day.
 *
 * ## Why mtimes rather than a hash
 *
 * A hash would be exact and would have to read every source file on every plugin construction. This
 * runs once per dev server and answers a question whose only consequence is a sentence on a
 * terminal, so the cheap comparison is the right one — and mtime is what a build tool already trusts
 * for the same decision.
 */
function newest(directory: string): number {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    // Absent, or not ours to read. `0` is "nothing to compare", which the caller is already silent
    // about — and it is a per-DIRECTORY answer now, so it cannot take the other walk down with it.
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
  const root = dirname(dirname(from));
  /**
   * Each walk answers for itself, and a review is the reason. Both used to sit inside ONE `try`, so
   * anything thrown anywhere in either — a directory nobody may read, a file a running build deletes
   * between the listing and the stat — abandoned the comparison and said nothing. Silence is what
   * this warning exists to stop, so it is the one outcome a fault here must not produce.
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
