import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every pending changeset is one the release can actually process.
 *
 * **The gap this closes, and it cost a red CI run.** `pnpm check` was green while
 * `changesets/action` failed on `changeset version` with "Mixed changesets that contain both ignored
 * and not ignored packages are not allowed" — a changeset that named `@ramonda/core` and
 * `@ramonda/docs` together. `@ramonda/docs` is in `ignore`: it is the site, it is private, and it has
 * no version anyone installs, so the release has nothing to bump for it. Nothing on this machine asked
 * the question, so the answer arrived from the runner.
 *
 * ## Why this DELEGATES rather than checks
 *
 * The first version of this file enumerated the workspace, read `ignore` out of `config.json` and
 * decided for itself which names a changeset may hold — about a hundred lines. Reviewing it killed
 * that, for two reasons and the second is the real one.
 *
 * It had a bug of exactly the kind it was written to prevent: it read the workspace globs from
 * `package.json`'s `workspaces` field, which **this repository does not have** — pnpm keeps them in
 * `pnpm-workspace.yaml`. So the field was always `undefined` and the hardcoded fallback always won.
 * It happened to match, so it worked; a third workspace root would have made it silently stop
 * checking those packages, and silently stopping is the worst thing a gate can do.
 *
 * And underneath that: `changeset status` asks the same question with the release's own code. A
 * hand-written copy of it can disagree with the release, which is the one thing a gate about the
 * release must not do — it knows nothing of `linked`, `fixed`, or a bump that arrives through a
 * dependency. Measured against both real cases: `status` exits 1 on the mixed changeset AND on a
 * misspelled package name, and 0 with no changesets at all, which is the state after every release.
 *
 * So this runs `changeset status` and adds the two things it does not give.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, ".changeset");

/**
 * A changeset whose frontmatter names NO package — the one case `changeset status` passes.
 *
 * Measured: `---\n---\n\nProse.` exits 0 there and bumps nothing, so the change it describes reaches
 * no changelog and no version, and the author is told nothing. An absent frontmatter is caught by
 * `status` itself; an empty one is not, which is why this half stays.
 *
 * A targeted read of the frontmatter rather than a parse of it: the question is only whether a
 * `name: bump` line exists at all, and anything more would be the second guess at changesets' format
 * that the rest of this file exists to avoid.
 */
function declaresNothing(text) {
  const end = text.indexOf("\n---", 3);
  if (!text.startsWith("---") || end < 0) return false; // No frontmatter — `status` reports it.
  return !/^\s*["']?[^"':\s]+["']?\s*:/m.test(text.slice(4, end));
}

const files = readdirSync(dir).filter((name) => name.endsWith(".md") && name !== "README.md");
const empty = files.filter((file) => declaresNothing(readFileSync(join(dir, file), "utf8")));

if (empty.length > 0) {
  console.error(`\n[changesets] ${empty.length} changeset(s) that name no package:\n`);
  for (const file of empty) console.error(`  .changeset/${file}`);
  console.error(
    `\n  A changeset with an empty frontmatter bumps nothing, and \`changeset version\` accepts it in\n` +
      `  silence — so the change it describes reaches no changelog and no version. Name the package it\n` +
      `  is about, or delete the file.\n`,
  );
  process.exit(1);
}

/**
 * The release's own validation.
 *
 * `stdio: "pipe"` rather than "inherit" so the guidance below can be decided from what it said; its
 * output is printed either way, so nothing is swallowed.
 *
 * `node_modules/.bin` is put on PATH rather than the binary being named by path: a spawned process
 * does not inherit the one a package manager adds for a script, so a bare `changeset` is ENOENT —
 * measured. Prepended rather than appended, so this cannot pick up some other `changeset` that
 * happens to be installed globally.
 */
const status = spawnSync("changeset", ["status"], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, PATH: `${join(root, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}` },
});

if (status.error !== undefined) {
  console.error(`\n[changesets] could not run \`changeset status\`: ${status.error.message}\n`);
  process.exit(1);
}

const output = `${status.stdout ?? ""}${status.stderr ?? ""}`;

if (status.status !== 0) {
  process.stderr.write(output);
  // The one message worth adding to: changesets names both halves of the mix and does not say what to
  // do about it, and what to do is not obvious — the answer is to say it in prose instead.
  if (output.includes("Mixed changesets")) {
    console.error(
      `\n  A package in \`ignore\` (see .changeset/config.json) or marked \`private\` has no version\n` +
        `  anyone installs, so the release cannot bump it. Drop its line and say what changed there in\n` +
        `  the changeset's BODY — that text becomes the changelog entry, which is where a note about\n` +
        `  the docs site or a playground belongs.\n`,
    );
  }
  process.exit(1);
}

if (files.length === 0) {
  // The state right after every release, and it is not a fault — which is why `status` exits 0 here
  // and why it was safe to gate on. Said plainly rather than as "0 changesets can be processed".
  console.log("[changesets] nothing pending — the last release took everything");
} else {
  const bumps = [...new Set([...output.matchAll(/^🦋\s+-\s+(\S+)$/gm)].map((match) => match[1]))];
  console.log(
    `[changesets] ${files.length} pending, and \`changeset status\` can process them` +
      `${bumps.length === 0 ? "" : ` — bumping ${bumps.join(", ")}`}`,
  );
}
