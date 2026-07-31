import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Warns when the Node running the gate is not the Node CI runs.
 *
 * Written after a green local run pushed a build that died on its first line:
 *
 *     SyntaxError: The requested module 'node:fs' does not provide an export named 'globSync'
 *
 * `fs.globSync` arrived in Node 22. CI pinned 20, this machine had 24, and no amount of running the
 * checks locally could have caught it — the difference was the runtime, not the code. `pnpm check` was
 * built to be "what CI runs"; this is the part of that promise it could not keep on its own.
 *
 * CI is on 24 now, so the gap that caused it is closed. This stays because the gap can reopen quietly:
 * `.nvmrc` moves, or a machine lags a major behind, and the symptom is a build that fails only where you
 * cannot attach a debugger.
 *
 * It WARNS rather than fails. Failing would stop the work of anyone whose Node is merely newer, which is
 * most people most of the time, and the mismatch is usually harmless — the point is that when a build
 * does break on CI, this line was already on screen and the first guess is a good one.
 *
 * `.nvmrc` is the single source: both the setup action and release.yml read it with `node-version-file`,
 * so there is no second copy for this to disagree with.
 */
const here = dirname(fileURLToPath(import.meta.url));
const nvmrc = join(here, "..", ".nvmrc");

const pinned = /(\d+)/.exec(readFileSync(nvmrc, "utf8"))?.[1];
if (!pinned) {
  console.warn(`[preflight] could not read a version from ${nvmrc} — skipping the check.`);
  process.exit(0);
}

const local = process.versions.node.split(".")[0];
if (local === pinned) process.exit(0);

const newer = Number(local) > Number(pinned);
console.warn(
  `\n[preflight] You are on Node ${process.versions.node}; CI runs Node ${pinned}.\n` +
    (newer
      ? `[preflight] A newer Node accepts APIs CI does not have, so a green run here can still fail there.\n` +
        `[preflight] If a build fails on CI and passes locally, suspect this first.\n`
      : `[preflight] An older Node may reject code CI accepts, so a failure here may not be real.\n`),
);
