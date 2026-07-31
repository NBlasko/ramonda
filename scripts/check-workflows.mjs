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
  console.log(`[workflows] SELFTEST passed: the bypass is caught, the turbo form is not.`);
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
