/**
 * The split `test` jobs must together run every test task, and neither may run one twice.
 *
 *     node scripts/check-test-jobs.mjs
 *
 * ## The fault this exists for, and it has already happened here
 *
 * `test` used to be one job. It was split so the two halves get a runner each — measured, the single
 * job saturates all four of a runner's cores, so more cores is the only thing that shortens it.
 *
 * **The last time a task was split off in this repository it silently dropped three of them.** The
 * `coverage` task ran 18 where `test` ran 21, because `create-ramonda`, `@ramonda/docs` and
 * `@ramonda/playground-ssr` have nothing to instrument and so had no `coverage` script. Under that
 * gate the SSR smoke test — the one that caught the open-in-editor regression — did not run at all,
 * and nothing said so. `.github/workflows/README.md` tells that story under *Coverage*.
 *
 * A filter pair is the same shape of mistake waiting to happen: edit one side, forget the other, and
 * a package's tests stop running while both jobs stay green. Nothing else would notice, because a
 * task that is never scheduled reports nothing.
 *
 * ## What it asks
 *
 * The filters are read out of `checks.yml` rather than repeated here — a copy would be the second
 * place to edit, which is the fault itself. Then it asks turbo, which is the only thing that knows
 * what a filter expands to, and compares the two halves against the whole:
 *
 * - every task appears in exactly one half
 * - together they are the unfiltered set, with nothing missing and nothing extra
 *
 * `--dry-run` so it schedules nothing and costs a second.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = join(root, ".github", "workflows", "checks.yml");

/**
 * Every `turbo run test --filter=…` a job runs, in file order.
 *
 * Deliberately a text scan rather than a YAML parse: what is being checked is the command line a
 * runner will execute, and a parse would have to reassemble it anyway. A `--filter` that moved into
 * a variable or a matrix would not be found — and would fail the count below, which is the right
 * way to find out.
 */
function filtersInTheWorkflow() {
  const text = readFileSync(workflow, "utf8");
  return [...text.matchAll(/turbo run test\s+--filter=(\S+)/g)].map((one) => one[1].replace(/^['"]|['"]$/g, ""));
}

/** What turbo says a filter expands to. The only authority on that, so it is the one asked. */
function tasksFor(filter) {
  const args = ["turbo", "run", "test", "--dry-run=json"];
  if (filter !== undefined) args.push(`--filter=${filter}`);
  const out = execFileSync("npx", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return new Set(
    JSON.parse(out)
      .tasks.filter((one) => one.task === "test")
      .map((one) => one.taskId),
  );
}

const filters = filtersInTheWorkflow();

if (filters.length !== 2) {
  console.error(
    `\n[test-jobs] Found ${filters.length} \`turbo run test --filter=…\` command(s) in checks.yml, ` +
      `and this expects exactly 2.\n\n` +
      `        The test job is split in two so each half gets a runner. If that changed, change this\n` +
      `        check with it — a partition of three halves is fine, a partition nobody verifies is not.\n`,
  );
  process.exit(1);
}

const whole = tasksFor(undefined);
const halves = filters.map((filter) => ({ filter, tasks: tasksFor(filter) }));

const covered = new Set(halves.flatMap((one) => [...one.tasks]));
const missing = [...whole].filter((one) => !covered.has(one)).sort();
const twice = [...halves[0].tasks].filter((one) => halves[1].tasks.has(one)).sort();
const extra = [...covered].filter((one) => !whole.has(one)).sort();

if (missing.length > 0 || twice.length > 0 || extra.length > 0) {
  console.error(`\n[test-jobs] The two test jobs do not partition the test tasks.\n`);
  for (const { filter, tasks } of halves) console.error(`    --filter=${filter}  →  ${tasks.size} task(s)`);
  console.error(`    unfiltered          →  ${whole.size} task(s)\n`);

  if (missing.length > 0) {
    console.error(`    NOT RUN BY EITHER JOB — these tests would stop running, silently:`);
    for (const one of missing) console.error(`      • ${one}`);
    console.error("");
  }
  if (twice.length > 0) {
    console.error(`    RUN BY BOTH — paid for twice, and the coverage merge sees it twice:`);
    for (const one of twice) console.error(`      • ${one}`);
    console.error("");
  }
  if (extra.length > 0) {
    console.error(`    IN A HALF BUT NOT IN THE WHOLE — a filter naming something turbo does not schedule:`);
    for (const one of extra) console.error(`      • ${one}`);
    console.error("");
  }
  process.exit(1);
}

console.log(
  `[test-jobs] ${halves[0].tasks.size} + ${halves[1].tasks.size} = ${whole.size} test tasks, ` +
    `each run by exactly one job`,
);
