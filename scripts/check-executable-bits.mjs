/**
 * Only a script is executable: a tracked file with mode 755 must start with `#!`.
 *
 *     node scripts/check-executable-bits.mjs
 *     SELFTEST=planted node scripts/check-executable-bits.mjs   # must report a planted file
 *
 * The release cannot commit an executable file. `changesets/action` writes the version pull
 * request through GitHub's API, and that API "only supports non-executable files" — so on
 * 2026-11-12 the release after a merge failed the moment the version bump touched
 * `packages/devtools/package.json`, which had carried mode 755 unnoticed since it was added, with
 * seventy other files beside it. Nothing local could see it: git, every test and the build run the
 * same whatever the mode is. It fails only when a release happens to touch that one file.
 *
 * A file that is run directly says so with a shebang, and that is the line drawn here: a `bin` the
 * shell runs keeps its bit, and everything else — a manifest, a README, a test — may not have one.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const executable = execFileSync("git", ["ls-files", "-s"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((line) => line.startsWith("100755 "))
  .map((line) => line.slice(line.indexOf("\t") + 1));

/** Whether a file starts with `#!`, read from the tree. A planted path is read as no script. */
const isScript = (path) => {
  try {
    return readFileSync(join(root, path), "utf8").startsWith("#!");
  } catch {
    return false;
  }
};

if (process.env.SELFTEST === "planted") executable.push("planted/package.json");

const wrong = executable.filter((path) => !isScript(path));

if (process.env.SELFTEST === "planted") {
  const caught = wrong.length === 1 && wrong[0] === "planted/package.json";
  console.log(
    caught
      ? "[executable-bits] SELFTEST=planted caught its break, as it must"
      : `[executable-bits] SELFTEST=planted did NOT catch its break: ${wrong.join(", ") || "nothing reported"}`,
  );
  process.exit(caught ? 0 : 1);
}

if (wrong.length > 0) {
  console.error(`[executable-bits] ${wrong.length} executable file(s) that are not scripts:\n`);
  for (const path of wrong) console.error(`  ${path}`);
  console.error(
    "\nThe release commits through GitHub's API, which refuses an executable file, so a version bump\n" +
      "that touches one fails. Clear the bit: git update-index --chmod=-x <file> && chmod -x <file>",
  );
  process.exit(1);
}
console.log(`[executable-bits] ${executable.length} executable file(s), each a script with a shebang`);
