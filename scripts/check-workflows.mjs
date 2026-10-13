import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Fails when a workflow runs a package script that turbo is supposed to orchestrate.
 *
 * The bug this exists for: `content` (which generates the docs' `src/generated/`) is a turbo task, and
 * `build` reaches it through `dependsOn`. `deploy-docs.yml` ran `pnpm --filter @ramonda/docs build`
 * directly, which skips the dependency graph entirely — so nothing generated the directory and esbuild
 * failed on three imports that had been resolving for months.
 *
 * Every local check passed while that was broken, and would have kept passing: `pnpm check` goes through
 * turbo, which is exactly the path the deploy was not taking. The gap was never in what CI builds, it was
 * in HOW a workflow asks for it, and nothing was looking at that.
 *
 * So this reads the same two files the mistake spans — `turbo.json` for the tasks that have dependencies,
 * the workflows for how they are invoked — and refuses the combination. It is deliberately narrow: only
 * tasks with a `dependsOn` can be broken this way, since those are the only ones where bypassing turbo
 * silently drops a step.
 *
 * `SELFTEST=1` runs it against a synthetic offending workflow and expects the failure, because a check
 * that has only ever seen good input has not been shown to detect anything.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/** Tasks whose correctness depends on turbo running something else first. */
function orchestratedTasks() {
  const turbo = JSON.parse(readFileSync(join(root, "turbo.json"), "utf8"));
  return Object.entries(turbo.tasks ?? {})
    .filter(([, task]) => Array.isArray(task.dependsOn) && task.dependsOn.length > 0)
    .map(([name]) => name);
}

/**
 * The two shapes that bypass the graph:
 *
 *   pnpm --filter <pkg> <task>      (also -F, and --filter=<pkg>)
 *   pnpm|npm run <task>
 *
 * NOT anchored to the start of the line, and that is the whole trick — in a workflow the command sits
 * after `run:`, sometimes after `- run:`. The first version of this anchored with `^`, matched nothing,
 * and reported every workflow clean while `deploy-docs.yml` still carried the exact line it was written
 * to catch. The self-test is what caught that, which is the argument for having one.
 *
 * `pnpm exec turbo run build --filter=…` does not match either pattern: after `pnpm` comes `exec`, not a
 * filter flag, and the `run` belongs to `turbo` rather than to a package manager. That is the correct
 * form, so it has to keep passing.
 */
function bypassesIn(text, tasks) {
  const found = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("check-workflows-ok")) continue; // deliberate, and says so

    const filtered = /pnpm\s+(?:--filter[= ]|-F\s+)\S+\s+(\S+)/.exec(line);
    const scripted = /(?:pnpm|npm)\s+run\s+(\S+)/.exec(line);
    const task = filtered?.[1] ?? scripted?.[1];

    if (task && tasks.includes(task)) found.push({ line: i + 1, task, text: line.trim() });
  }
  return found;
}

const tasks = orchestratedTasks();

/**
 * Inputs `changesets/action` does not have, which it IGNORES rather than refuses.
 *
 * v2 renamed every input it shares with v1 — `version` is `version-script`, `publish` is
 * `publish-script`, `title` is `pr-title`, `commit` is `commit-message`. A workflow that moved to v2
 * and kept the old names gets a warning in the Actions log and a release step with no publish script:
 * the version PR still opens, merging it publishes nothing, and every check stays green. That is the
 * mistake this catches. The list is v2.1.2's `action.yml`, copied 2026-10-09; a later major needs it
 * read again.
 */
const CHANGESETS_INPUTS = new Set([
  "github-token",
  "publish-script",
  "version-script",
  "commit-message",
  "pr-title",
  "pr-draft",
  "pr-base-branch",
  "create-github-releases",
  "push-git-tags",
  "push-with-git-cli",
  "cwd",
]);

function unknownInputsIn(text) {
  const found = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/uses:\s*changesets\/action@/.test(lines[i])) continue;
    const withAt = lines.findIndex((line, j) => j > i && /^\s*with:\s*$/.test(line));
    if (withAt === -1) continue;
    const indent = lines[withAt].search(/\S/);
    for (let j = withAt + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() === "" || line.trim().startsWith("#")) continue;
      if (line.search(/\S/) <= indent) break;
      const key = /^\s*([\w-]+):/.exec(line)?.[1];
      if (key !== undefined && line.search(/\S/) === lines[withAt + 1].search(/\S/) && !CHANGESETS_INPUTS.has(key)) {
        found.push({ line: j + 1, key, text: line.trim() });
      }
    }
  }
  return found;
}

/**
 * An `npm_config_*` setting, which pnpm 11 and later do not read — they read `pnpm_config_*`.
 *
 * Measured 2026-10-13, after the docs deploy failed with ERR_PNPM_ADDING_TO_ROOT: deploy-docs.yml set
 * `npm_config_ignore_workspace_root_check` for wrangler-action's `pnpm add wrangler`, and on pnpm 12
 * the setting is silently ignored. With `pnpm_config_ignore_workspace_root_check` the same `pnpm add`
 * passes the check. The upgrade to pnpm 12 changed the spelling and nothing said so.
 */
/**
 * Settings meant for NPM itself, each with why. A rule with no way to say *this one is on purpose* is a
 * rule somebody deletes instead.
 */
const FOR_NPM = {
  NPM_CONFIG_PROVENANCE:
    "release.yml: read by npm, which `changeset publish` runs to publish — measured, 0.10.0, published " +
    "after the move to pnpm 12, carries its SLSA provenance",
};

function npmConfigIn(text) {
  const found = [];
  for (const [index, line] of text.split("\n").entries()) {
    const key = /(?:^|\s)(npm_config_[\w]+)\s*[:=]/i.exec(line)?.[1];
    if (key === undefined || line.trim().startsWith("#") || FOR_NPM[key] !== undefined) continue;
    found.push({ line: index + 1, key, text: line.trim() });
  }
  return found;
}

if (process.env.SELFTEST === "1") {
  // The offending line exactly as it was, plus the correct form, because a check that flags everything is
  // as useless as one that flags nothing.
  const bad = "      - name: Build the docs site\n        run: pnpm --filter @ramonda/docs build\n";
  const good = "      - name: Build the docs site\n        run: pnpm exec turbo run build --filter=@ramonda/docs\n";

  const hits = bypassesIn(bad, tasks);
  if (hits.length !== 1 || hits[0].task !== "build") {
    console.error(`[workflows] SELFTEST failed: the real regression was not flagged.`);
    process.exit(1);
  }
  if (bypassesIn(good, tasks).length !== 0) {
    console.error(`[workflows] SELFTEST failed: the CORRECT form was flagged, so this would block the fix.`);
    process.exit(1);
  }
  const v1 =
    "      - uses: changesets/action@v2\n        with:\n          # a comment\n          publish: pnpm release\n          pr-title: x\n";
  const v2 =
    "      - uses: changesets/action@v2\n        with:\n          publish-script: pnpm release\n          pr-title: x\n";
  const caught = unknownInputsIn(v1);
  if (caught.length !== 1 || caught[0].key !== "publish") {
    console.error(`[workflows] SELFTEST failed: a v1 input on changesets/action v2 was not flagged.`);
    process.exit(1);
  }
  if (unknownInputsIn(v2).length !== 0) {
    console.error(`[workflows] SELFTEST failed: v2's own inputs were flagged.`);
    process.exit(1);
  }
  const npmEnv = '        env:\n          npm_config_ignore_workspace_root_check: "true"\n';
  const pnpmEnv = '        env:\n          pnpm_config_ignore_workspace_root_check: "true"\n';
  if (npmConfigIn(npmEnv).length !== 1) {
    console.error(`[workflows] SELFTEST failed: an npm_config_ setting pnpm ignores was not flagged.`);
    process.exit(1);
  }
  if (npmConfigIn(pnpmEnv).length !== 0) {
    console.error(`[workflows] SELFTEST failed: the pnpm_config_ spelling was flagged.`);
    process.exit(1);
  }
  console.log(
    `[workflows] SELFTEST passed: the bypass is caught, the turbo form is not; an ignored input is caught; an ignored npm_config_ is caught.`,
  );
  process.exit(0);
}

const dir = join(root, ".github", "workflows");
const problems = [];

for (const name of readdirSync(dir)) {
  if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
  for (const hit of bypassesIn(readFileSync(join(dir, name), "utf8"), tasks)) {
    problems.push({ file: `.github/workflows/${name}`, ...hit });
  }
}

const ignored = [];
for (const name of readdirSync(dir)) {
  if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
  for (const hit of unknownInputsIn(readFileSync(join(dir, name), "utf8"))) {
    ignored.push({ file: `.github/workflows/${name}`, ...hit });
  }
}
const npmConfig = [];
for (const name of readdirSync(dir)) {
  if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
  for (const hit of npmConfigIn(readFileSync(join(dir, name), "utf8"))) {
    npmConfig.push({ file: `.github/workflows/${name}`, ...hit });
  }
}
if (npmConfig.length > 0) {
  console.error(`\n[workflows] pnpm 11 and later read pnpm_config_*, not npm_config_*, so these are ignored:\n`);
  for (const p of npmConfig)
    console.error(`  ${p.file}:${p.line}\n      ${p.text}  →  ${p.key.replace(/^npm_/i, "pnpm_")}\n`);
  process.exit(1);
}

if (ignored.length > 0) {
  console.error(`\n[workflows] changesets/action has no input by these names, and ignores them:\n`);
  for (const p of ignored) console.error(`  ${p.file}:${p.line}\n      ${p.text}\n`);
  console.error(`  Its inputs are: ${[...CHANGESETS_INPUTS].join(", ")}.\n`);
  process.exit(1);
}

if (problems.length > 0) {
  console.error(`\n[workflows] These run a task directly that turbo is meant to orchestrate:\n`);
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}`);
    console.error(`      ${p.text}`);
    console.error(
      `      \`${p.task}\` declares dependsOn in turbo.json, so calling the script skips whatever it ` +
        `depends on.\n      Use \`pnpm exec turbo run ${p.task} --filter=<package>\`.\n`,
    );
  }
  process.exit(1);
}

console.log(`[workflows] No workflow bypasses turbo for: ${tasks.join(", ")}`);
