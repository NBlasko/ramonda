import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
 * So this runs `changeset status` and adds the three things it does not give.
 *
 * ## Why it is not in CI
 *
 * `pnpm check` only. Measured on 2026-09-04, in a checkout shaped like the runner's — depth 1, HEAD
 * detached, no `main` ref: `changeset status` exits with *"Failed to find where HEAD diverged from
 * `main`. Does `main` exist and it's synced with remote?"*. It asks git that question to answer one of
 * its own — a package changed with no changeset for it — and a `pull_request` checkout has neither the
 * ref nor a merge base. Putting this in `checks.yml` therefore costs that job a `fetch-depth: 0` and a
 * `git fetch origin main:main` before the step, which is the price of the git half; the two halves
 * below need no git at all.
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
const env = { ...process.env, PATH: `${join(root, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}` };

const status = spawnSync("changeset", ["status"], { cwd: root, encoding: "utf8", env });

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
  process.exit(0);
}

const selftest = (which) => process.env.SELFTEST === which;

/**
 * The release plan, from the release's own code.
 *
 * `--output` writes `{ changesets, releases }` — every pending changeset with the packages it names,
 * and the plan's verdict per package. It is the same `getReleasePlan` the version step runs, so it
 * knows `ignore`, `private`, `linked`, `fixed` and a bump arriving through a dependency, none of which
 * a hand-written reader would.
 *
 * A SECOND `status` run rather than one: with `--output` the command prints nothing at all — measured
 * — so the human output the block above forwards and reads its guidance from would be gone. Each call
 * has one job, and this one only happens once the first has said the tree is processable.
 */
function releasePlan() {
  const into = mkdtempSync(join(tmpdir(), "ramonda-changesets-"));
  const file = join(into, "plan.json");
  const run = spawnSync("changeset", ["status", "--output", file], { cwd: root, encoding: "utf8", env });

  // Every exit below clears the directory FIRST: `process.exit` does not run a `finally`, so a
  // failure path that looked tidy would leave one behind on every red run.
  const broken = (why) => {
    rmSync(into, { recursive: true, force: true });
    process.stderr.write(`${run.stdout ?? ""}${run.stderr ?? ""}`);
    console.error(`\n[changesets] ${why}, so what the release can consume is unknown\n`);
    process.exit(1);
  };

  if (run.status !== 0) broken("`changeset status --output` failed");

  let plan;
  try {
    plan = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    broken(`the plan could not be read (${error.message})`);
  }
  rmSync(into, { recursive: true, force: true });

  // The shape floor. A plan whose two arrays are not there is a changesets whose output format moved,
  // and `every` over a missing list answers TRUE for everything — the check would pass on silence.
  if (!Array.isArray(plan.changesets) || !Array.isArray(plan.releases)) {
    console.error(`\n[changesets] the plan has no \`changesets\`/\`releases\` arrays — its format moved\n`);
    process.exit(1);
  }
  return plan;
}

const plan = releasePlan();

// The planted fault is the plan losing sight of a file, which is the shape the floor exists for.
if (selftest("floor")) plan.changesets = plan.changesets.slice(1);

if (plan.changesets.length !== files.length) {
  // The floor under the check below: it can only speak about changesets the plan actually returned.
  // If those two numbers disagree, the plan is not describing this `.changeset/` directory and every
  // verdict drawn from it is about some other tree.
  console.error(
    `\n[changesets] the plan describes ${plan.changesets.length} changeset(s) but ${files.length} are\n` +
      `  pending on disk. Nothing below can be trusted until those agree.\n`,
  );
  if (selftest("floor")) {
    console.log("[changesets] SELFTEST floor: the plan losing a changeset was reported, as it must be");
    process.exit(0);
  }
  process.exit(1);
}

if (selftest("floor")) {
  console.error("[changesets] SELFTEST floor: the plan losing a changeset was NOT reported — the floor is gone");
  process.exit(1);
}

/**
 * A changeset the release will never CONSUME — which is not the same as one it cannot process.
 *
 * **This cost a stuck release.** Two changesets named `@ramonda/docs` and nothing else. That package
 * is `private` and in `ignore`, so `changeset version` bumps nothing for it and — measured, in the
 * bot's own commit of 2026-09-03, which deleted 28 changesets and left those two — does not delete the
 * file either. `changesets/action` then reads `.changeset/` on every push to `main` and branches on
 * `changesets.length !== 0`: pending changesets mean "open the version PR", an empty directory means
 * "publish". Two files nothing can consume hold that switch down forever, so no version ever reaches
 * npm again. `changeset status` exits 0 on them, because processing them IS doing nothing.
 *
 * The verdict comes from the plan rather than from `ignore` and `private` read here: a package the
 * plan will not bump has `type: "none"`, whatever the reason, and a name the plan never mentions is a
 * misspelling `status` itself reports.
 */
function nothingWillConsume(changesets, releases) {
  const planned = new Map(releases.map((release) => [release.name, release.type]));
  return changesets.filter((changeset) =>
    changeset.releases.every((release) => (planned.get(release.name) ?? "none") === "none"),
  );
}

const stuck = nothingWillConsume(
  selftest("ignored")
    ? [...plan.changesets, { id: "(selftest)", releases: [{ name: "@ramonda/docs", type: "patch" }] }]
    : plan.changesets,
  plan.releases,
);

if (stuck.length > 0) {
  console.error(`\n[changesets] ${stuck.length} changeset(s) the release can never consume:\n`);
  for (const changeset of stuck) {
    console.error(`  .changeset/${changeset.id}.md — names only ${changeset.releases.map((r) => r.name).join(", ")}`);
  }
  console.error(
    `\n  Every package named there is one the release cannot bump — \`private\`, or in \`ignore\` (see\n` +
      `  .changeset/config.json). So \`changeset version\` leaves the file where it is, and a file that\n` +
      `  stays keeps \`changesets/action\` on its "open a version PR" branch: nothing publishes, ever.\n` +
      `  Delete the file. If the change deserves a note, it belongs in the changeset of a package that\n` +
      `  IS released, or in the site's own pages.\n`,
  );
  if (selftest("ignored")) {
    console.log("[changesets] SELFTEST ignored: the planted changeset was reported, as it must be");
    process.exit(0);
  }
  process.exit(1);
}

if (selftest("ignored")) {
  console.error("[changesets] SELFTEST ignored: the planted changeset was NOT reported — this check is asleep");
  process.exit(1);
}

const bumps = plan.releases.filter((release) => release.type !== "none").map((r) => `${r.name}@${r.newVersion}`);

console.log(
  `[changesets] ${files.length} pending, and \`changeset status\` can process them` +
    `${bumps.length === 0 ? "" : ` — bumping ${bumps.join(", ")}`}`,
);
