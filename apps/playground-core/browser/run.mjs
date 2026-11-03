/**
 * `pnpm test:browser`: the Chromium suite, then the Firefox composition script — both, always — and a
 * failure in either fails the run.
 *
 * A script of its own, so the arguments given to `test:browser` reach Playwright: `test:browser
 * fields.spec.ts` or `-- --grep caret` filters the Chromium suite. Written inline in the script, pnpm
 * appended them to the shell's last word instead.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const chromium = run("playwright", ["test", ...process.argv.slice(2)]);
const firefox = run(process.execPath, [fileURLToPath(new URL("./firefox-composition.mjs", import.meta.url))]);
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
