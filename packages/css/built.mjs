/**
 * Whether `dist` was built from the source as it stands.
 *
 * **A test or a probe that reads `dist` is measuring the LAST BUILD, not the source.** `bin.mjs` is
 * `import "./dist/cli.js"`, `viteBuild.test.ts` loads `dist/vite.js` by path, and every
 * `prototype-*.mjs` here imports `dist/compiler/index.js`. When `dist` is older than `src` they all
 * measure a previous version of the package and say nothing about it.
 *
 * Measured: with `src/cli.ts` replaced by a line that throws, and no rebuild, **57 tests passed** —
 * every test in `cli.test.ts`, `toolingCli.test.ts`, `extension.test.ts` and `viteBuild.test.ts`.
 *
 * A probe is worse than a test in one way: its numbers get written down as facts.
 *
 * Plain JavaScript at the package root so the TypeScript tests and the `.mjs` probes share ONE copy.
 * Two would be this repository's recurring fault — one question, two answers, drifting apart the
 * first time one of them is corrected.
 */
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = dirname(fileURLToPath(import.meta.url));

/** The newest change under a directory, in milliseconds — `0` when it does not exist. */
function newestUnder(at, skip = () => false) {
  let newest = 0;
  let entries;
  try {
    entries = readdirSync(at);
  } catch {
    return 0;
  }
  for (const name of entries) {
    if (skip(name)) continue;
    const path = join(at, name);
    const when = statSync(path).isDirectory() ? newestUnder(path, skip) : statSync(path).mtimeMs;
    if (when > newest) newest = when;
  }
  return newest;
}

/**
 * Throws when `dist` is behind `src`, naming the command that fixes it.
 *
 * `__tests__` is skipped on the source side because a test is not built — editing one must not ask
 * for a rebuild. Everything else under `src` is, generated files included.
 */
export function builtFromThisSource() {
  const source = newestUnder(join(PACKAGE, "src"), (name) => name === "__tests__");
  const built = newestUnder(join(PACKAGE, "dist"));

  if (built === 0) {
    throw new Error("this reads the BUILD, and there is no `dist`. Run `pnpm --filter @ramonda/css build` first.");
  }
  if (source > built) {
    throw new Error(
      `this reads the BUILD, and \`dist\` is ${Math.round((source - built) / 1000)}s older than \`src\` — ` +
        "so it would measure a previous version of the package and pass. " +
        "Run `pnpm --filter @ramonda/css build` first.",
    );
  }
}
