/**
 * The Playwright image a workflow runs in must be the Playwright version the lockfile installs.
 *
 *     node scripts/check-playwright-image.mjs
 *     SELFTEST=skew node scripts/check-playwright-image.mjs   # must report a planted mismatch
 *
 * The Browser job runs inside `mcr.microsoft.com/playwright:v<version>-noble`, which ships the
 * browsers and every system library they need — so the job installs nothing. Before, it downloaded
 * Firefox and WebKit and ~150 apt packages on every run, and on 2026-11-06 that apt step hung for
 * over 47 minutes.
 *
 * The cost is this pairing. The `playwright` package looks for the browser build OF ITS OWN
 * version; an image of another version holds other builds, and every launch fails with "Executable
 * doesn't exist". A dependency bump that moves the lockfile and not the tag would turn the job red
 * for a reason nobody's change explains, so this fails first, on the tree that broke it.
 *
 * A text scan of both files, as `check-test-jobs.mjs` does: what matters is the line a runner reads.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflows = join(root, ".github", "workflows");

/** Every `playwright@<version>` the lockfile resolves. More than one is a fault of its own. */
const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
const installed = [...new Set([...lock.matchAll(/^ {2}playwright@(\d+\.\d+\.\d+):/gm)].map((one) => one[1]))];

/** Every Playwright image a workflow names, with where. */
const images = readdirSync(workflows)
  .filter((name) => /\.ya?ml$/.test(name))
  .flatMap((name) =>
    [...readFileSync(join(workflows, name), "utf8").matchAll(/mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-/g)].map(
      (one) => ({ where: name, version: one[1] }),
    ),
  );

if (process.env.SELFTEST === "skew") images.push({ where: "planted.yml", version: "0.0.1" });

const faults = [];
if (installed.length !== 1)
  faults.push(
    `the lockfile resolves ${installed.length} Playwright version(s) (${installed.join(", ")}); expected one`,
  );
if (images.length === 0) faults.push("no workflow names a Playwright image — the Browser job has none to run in");
for (const image of images)
  if (!installed.includes(image.version))
    faults.push(`${image.where} runs in the v${image.version} image; the lockfile installs ${installed.join(", ")}`);

if (process.env.SELFTEST === "skew") {
  const caught = faults.length === 1 && faults[0].startsWith("planted.yml");
  console.log(
    caught
      ? "[playwright-image] SELFTEST=skew caught its break, as it must"
      : `[playwright-image] SELFTEST=skew did NOT catch its break: ${faults.join("; ") || "nothing reported"}`,
  );
  process.exit(caught ? 0 : 1);
}

if (faults.length > 0) {
  console.error("[playwright-image] the browser image and the installed Playwright disagree:\n");
  for (const one of faults) console.error(`  ${one}`);
  console.error(
    "\nThe package looks for the browsers of its own version, and an image of another holds others.\n" +
      "Move the image tag in the workflow to the version the lockfile installs.",
  );
  process.exit(1);
}
console.log(`[playwright-image] ${images.length} image(s), each v${installed[0]}, as the lockfile installs`);
