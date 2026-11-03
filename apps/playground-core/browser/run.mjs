/**
 * `pnpm test:browser`: the Chromium suite, then the Firefox composition script, and a failure in either
 * fails the run.
 *
 * A script of its own, so the arguments given to `test:browser` reach Playwright: `test:browser
 * fields.spec.ts --grep paste` runs that part of the Chromium suite. Any argument narrows the run to
 * Chromium; the Firefox script runs with the whole suite, given none. A `--` pnpm passes through ahead
 * of them is dropped. Playwright is found where this package installs it, so the script runs the same
 * through pnpm and as `node browser/run.mjs`.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const given = process.argv.slice(2);
const filters = given[0] === "--" ? given.slice(1) : given;
const playwright = createRequire(import.meta.url).resolve("@playwright/test/cli");
const chromium = run(process.execPath, [playwright, "test", ...filters]);
const firefox =
  filters.length > 0
    ? 0
    : run(process.execPath, [fileURLToPath(new URL("./firefox-composition.mjs", import.meta.url))]);
process.exit(chromium !== 0 ? chromium : firefox);

/** Runs a command with this terminal, and answers its exit code — 1 when it could not start, or ended on a signal. */
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error !== undefined) {
    console.error(`${command} could not start: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}
