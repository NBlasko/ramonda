import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Fails with a sentence instead of three unresolved imports.
 *
 * `src/generated/` is written by `npm run content`, which is a TURBO task rather than a step inside this
 * script — `check-types` and `build` both used to call it, turbo runs those concurrently, and two
 * processes rewrote the directory while `tsc` was reading it. Making it a task with declared outputs is
 * what fixed that, and `build` gets it via `dependsOn`.
 *
 * The cost is that `npm run build` on its own no longer generates anything, and what you see is esbuild
 * reporting `Could not resolve "./generated/content"` three times — which reads like the repository is
 * missing a file rather than like a step was skipped. That is exactly how the docs deploy failed: its
 * workflow called the package script directly, bypassing turbo and its `dependsOn`.
 *
 * So this says which step is missing, and how to get it. It costs one `existsSync` per build.
 *
 * The task also `dependsOn: ["^build"]`, and that is not decoration either: `build-content.mjs`
 * imports `ruleCatalogue()` from `@ramonda/check`, because a page is generated per rule. Without
 * the dependency CI failed on a clean checkout — `ERR_MODULE_NOT_FOUND` for
 * `@ramonda/check/dist/index.js` — while every machine that had ever built passed, because the
 * `dist` was left over from a previous run. Turbo's cache then hid it a second time by replaying
 * this task's output over a `dist` that was no longer there, so the first attempt to reproduce it
 * locally came back green.
 */
const here = dirname(fileURLToPath(import.meta.url));
const generated = join(here, "..", "src", "generated", "content.ts");

if (!existsSync(generated)) {
  console.error(
    `\n[docs] src/generated/ has not been built, so the bundle cannot resolve its content.\n` +
      `[docs] Run \`npm run content\` first, or build through turbo — \`turbo run build --filter=@ramonda/docs\` —\n` +
      `[docs] which declares \`content\` as a dependency and runs it exactly once.\n`,
  );
  process.exit(1);
}
