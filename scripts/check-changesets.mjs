import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every pending changeset names packages the release can actually bump.
 *
 * **The gap this closes, and it cost a red CI run.** `pnpm check` was green while
 * `changesets/action` failed on `changeset version` with "Mixed changesets that contain both ignored
 * and not ignored packages are not allowed" — a changeset that named `@ramonda/core` and
 * `@ramonda/docs` together. `@ramonda/docs` is in `ignore` (it is the site, it is private, and it has
 * no version anyone installs), so it may not share a changeset with a published package. Nothing on
 * this machine asked the question, so the answer arrived from the runner.
 *
 * The rule is easy to trip for an honest reason: a change that touches a published package AND the
 * docs app looks like two packages to declare, and the second one is not a package the release knows
 * how to move. Say it in the BODY instead — the changelog entry is prose, and a sentence about the
 * docs is worth more there than a version bump nobody consumes.
 *
 * Read off `config.json` rather than hardcoded, so adding a package to `ignore` cannot leave this
 * checking a stale list. A private package that is NOT in `ignore` is reported too, and for the same
 * reason: the release has no version to give it.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, ".changeset");

const config = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
const ignored = new Set(config.ignore ?? []);

/** Every workspace package, by name, with whether it is private. */
function workspacePackages() {
  const globs = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).workspaces ?? ["packages/*", "apps/*"];
  const dirs = new Set();
  for (const glob of globs) {
    const base = glob.replace(/\/\*$/, "");
    let entries = [];
    try {
      entries = readdirSync(join(root, base), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) if (entry.isDirectory()) dirs.add(join(root, base, entry.name));
  }

  const found = new Map();
  for (const at of dirs) {
    try {
      const pkg = JSON.parse(readFileSync(join(at, "package.json"), "utf8"));
      if (typeof pkg.name === "string") found.set(pkg.name, pkg.private === true);
    } catch {
      // Not a package. A workspace glob matches directories, not manifests.
    }
  }
  return found;
}

/** The `"name": bump` lines in a changeset's frontmatter. */
function namesIn(text) {
  const end = text.indexOf("\n---", 3);
  const frontmatter = text.startsWith("---") && end > 0 ? text.slice(4, end) : "";
  return [...frontmatter.matchAll(/^\s*["']?([^"':\s]+)["']?\s*:/gm)].map((match) => match[1]);
}

const packages = workspacePackages();
const files = readdirSync(dir).filter((name) => name.endsWith(".md") && name !== "README.md");
const problems = [];

for (const file of files) {
  const names = namesIn(readFileSync(join(dir, file), "utf8"));
  if (names.length === 0) {
    problems.push({ file, why: "names no package at all — the frontmatter is empty or malformed" });
    continue;
  }

  const unknown = names.filter((name) => !packages.has(name));
  if (unknown.length > 0) {
    problems.push({ file, why: `names ${unknown.join(", ")}, which is not a package in this workspace` });
  }

  const blocked = names.filter((name) => ignored.has(name) || packages.get(name) === true);
  const releasable = names.filter((name) => !ignored.has(name) && packages.get(name) === false);
  if (blocked.length > 0 && releasable.length > 0) {
    problems.push({
      file,
      mixed: true,
      why:
        `names ${blocked.join(", ")}, which the release cannot bump, beside ${releasable.join(", ")}, ` +
        `which it can — and \`changeset version\` refuses that mix`,
    });
  }
}

if (problems.length > 0) {
  console.error(`\n[changesets] ${problems.length} changeset(s) the release cannot process:\n`);
  for (const problem of problems) {
    console.error(`  .changeset/${problem.file}`);
    console.error(`      ${problem.why}.\n`);
  }
  // Only for the mix, which is the one with a non-obvious way out. A misspelled package name needs
  // no paragraph, and printing this beside it would be advice about the wrong thing.
  if (problems.some((problem) => problem.mixed === true)) {
    console.error(
      `  A package in \`ignore\` or marked \`private\` has no version anyone installs, so it cannot be\n` +
        `  bumped. Drop its line and say what changed there in the changeset's BODY instead — that text\n` +
        `  becomes the changelog entry, which is where a note about the docs site belongs.\n`,
    );
  }
  process.exit(1);
}

console.log(`[changesets] ${files.length} pending changeset(s), every package named is one the release can bump`);
