import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Refuses a gate that runs in `pnpm check` and in no workflow.
 *
 * ## The fault it exists for
 *
 * Measured on 2026-09-22: `pnpm check` ran twenty gate scripts, the workflows ran fourteen, and
 * **ten of the twenty appeared in no workflow at all** — `check-test-probes`, `check-tsconfigs`,
 * `check-event-spelling`, `check-css-system`, `check-css-blocks`, `check-css-splitting`,
 * `check-decorator-duplication`, `check-third-party`, `build-package-readmes --check` and
 * `build-css-properties --check`. So `main` was protected by whether the author happened to run the
 * checks on their own machine, and one of those ten is the very gate whose docstring records a
 * debug probe reaching `main` through a green run. A second leftover reached `main` the same way
 * while all ten were missing.
 *
 * They were added. Nothing stopped the next one from being missed, which is what this is.
 *
 * ## One direction only, and that is the point
 *
 * Every invocation in `pnpm check` must also be in a workflow. **The reverse is not asked**, and its
 * absence is deliberate rather than forgotten: CI legitimately runs things `pnpm check` cannot — the
 * four `build-*` scripts that read what real browser engines say, and `merge-lcov`, which has no
 * meaning outside a coverage upload. A workflow doing MORE than the local gate costs nothing; a
 * workflow doing less is `main` unguarded.
 *
 * ## Why the whole invocation and not the file name
 *
 * `SELFTEST=` and the arguments are what a run MEANS. `build-package-readmes.mjs` writes the READMEs
 * and `build-package-readmes.mjs --check` fails when they are stale — the same file, and only the
 * second is a gate. A self-test is the same argument one step further: `SELFTEST=scaffold` proves a
 * check can fail, and one that proves it only on somebody's laptop has not proved it for `main`.
 * Measured before this was written, comparing whole invocations found exactly two and neither was
 * noise: `preflight-node.mjs`, decided below, and `SELFTEST=scaffold check-changesets.mjs`, which
 * was a real gap and is now in `checks.yml`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/**
 * Run locally and deliberately nowhere else, each with the reason.
 *
 * The shape every check in this directory has, and for the reason they all learnt: a rule with no
 * way to say *this one is on purpose* is a rule somebody deletes instead. A stale entry is reported
 * below, so an exception cannot outlive the thing it excuses.
 */
const DECIDED = {
  "scripts/preflight-node.mjs":
    "it warns when the Node running the gate is not the Node CI runs, and in CI those are the same " +
    "Node — it could never speak there",
};

/**
 * One invocation of a gate script, normalised so the two files can be compared.
 *
 * `[^&|\n]*` for the arguments, because a chain writes `a.mjs && b.mjs` on one line in
 * `package.json` and a workflow writes one per line under `run: |`. Whitespace is collapsed so the
 * two spellings of the same call are one string.
 *
 * **A leading `./`, a quote and extra whitespace are all tolerated, and that is not politeness.**
 * The first version matched `node scripts/x.mjs` exactly, and a review of this file measured what
 * the other spellings do. They are not symmetrical: in a WORKFLOW an unmatched spelling is a gate
 * this cannot see CI running, which reports a gap that is not there — noisy, and somebody looks. In
 * `package.json` it is the opposite and it is silent: the gate is never asked about, this check
 * says every invocation is covered, and the one written `node ./scripts/x.mjs` is unguarded with
 * nothing anywhere to say so. A check whose own blind spot reads as success is the shape it exists
 * to refuse.
 */
const INVOCATION = /(?:SELFTEST=([A-Za-z0-9_-]+)\s+)?node\s+["']?(?:\.\/)?(scripts\/[a-z0-9-]+\.mjs)["']?([^&|\n]*)/g;

function invocationsIn(text) {
  const found = new Set();
  for (const [, selftest, script, rest] of text.matchAll(INVOCATION)) {
    const args = rest.trim().split(/\s+/).filter(Boolean).join(" ");
    found.add(`${selftest === undefined ? "" : `SELFTEST=${selftest} `}${script}${args === "" ? "" : ` ${args}`}`);
  }
  return found;
}

/**
 * Everything `pnpm check` reaches, including through a package script it calls.
 *
 * `check` ends in `pnpm check:scaffold`, and a gate hidden one level down is still a gate. Following
 * the call rather than listing the names means a new nested script is covered the day it is written.
 */
function whatTheGateRuns(scripts, name, seen = new Set()) {
  if (seen.has(name)) return new Set();
  seen.add(name);

  const body = scripts[name] ?? "";
  const found = invocationsIn(body);
  for (const [, nested] of body.matchAll(/pnpm (?:run )?([a-z:-]+)/g)) {
    if (scripts[nested] !== undefined) for (const one of whatTheGateRuns(scripts, nested, seen)) found.add(one);
  }
  return found;
}

/**
 * Every workflow, and every composite action a workflow can reach.
 *
 * `.github/actions/*` holds `action.yml` files that a job invokes with `uses:`, and a gate run from
 * one is a gate CI runs. None does today — `setup` is the only action and it installs — but reading
 * them costs nothing and closes the whole class rather than the instance, which is the difference
 * between this being a check and being a note about today.
 */
function whatCiRuns(directory, found = new Set()) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      whatCiRuns(path, found);
      continue;
    }
    if (!/\.ya?ml$/.test(entry.name)) continue;
    for (const one of invocationsIn(readFileSync(path, "utf8"))) found.add(one);
  }
  return found;
}

function missing() {
  const { scripts } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const local = whatTheGateRuns(scripts, "check");
  const ci = whatCiRuns(join(root, ".github"));
  return { local, gaps: [...local].filter((one) => !ci.has(one)).sort() };
}

function run() {
  const { local, gaps } = missing();
  const seen = new Set();
  const reported = [];

  for (const one of gaps) {
    const script = one.replace(/^SELFTEST=\S+\s+/, "").split(" ")[0];
    if (DECIDED[script] !== undefined) {
      seen.add(script);
      continue;
    }
    reported.push(`        ${one}`);
  }

  if (reported.length > 0) {
    throw new Error(
      `[gate-parity] ${reported.length} gate(s) run in \`pnpm check\` and in no workflow:\n\n` +
        `${reported.join("\n")}\n\n` +
        `        A gate CI does not run protects the machine it was run on, not \`main\`. Add it to\n` +
        `        .github/workflows/checks.yml — to \`lint\` if it reads source, to \`build\` if it\n` +
        `        needs the built tree.\n\n` +
        `        If it genuinely cannot run in CI, add it to DECIDED in scripts/check-gate-parity.mjs\n` +
        `        with the reason.`,
    );
  }

  const stale = Object.keys(DECIDED).filter((script) => !seen.has(script));
  if (stale.length > 0) {
    throw new Error(
      `[gate-parity] These are listed as deliberately local-only and are no longer missing from CI:\n` +
        stale.map((script) => `        ${script} — listed because ${DECIDED[script]}`).join("\n") +
        `\n\n        Remove the entry, so the next gate that goes missing is reported.`,
    );
  }

  console.log(`[gate-parity] ${local.size} gate invocation(s) in \`pnpm check\`, every one of them run by CI`);
}

/**
 * The check checked, the way every other one here is.
 *
 * A gate that cannot fail is a gate nobody notices has stopped working, and this one is exactly the
 * kind that rots: it is about a file nobody edits often, and the message would be missed by anyone
 * not looking for it.
 */
/**
 * The spellings, which is where a review found this check reading its own blind spot as success.
 *
 * Asserted on `invocationsIn` directly, because the fault is in the reading rather than in the
 * comparison: a spelling it cannot see in `package.json` is a gate it never asks about, and the run
 * then prints that every invocation is covered.
 */
if (process.env.SELFTEST === "spelling") {
  const same = ["node scripts/x.mjs", "node ./scripts/x.mjs", 'node "scripts/x.mjs"', "node  scripts/x.mjs"];
  const read = same.map((one) => [...invocationsIn(one)][0]);

  if (read.every((one) => one === "scripts/x.mjs")) {
    console.log("[gate-parity] SELFTEST spelling: four spellings of one call read as one, as they must");
    process.exit(0);
  }
  console.error(`[gate-parity] SELFTEST spelling: they read as ${JSON.stringify(read)} — a gate could hide here`);
  process.exit(1);
}

if (process.env.SELFTEST === "missing") {
  const scripts = { check: "node scripts/check-nothing-runs-this.mjs && pnpm check:inner", "check:inner": "" };
  const local = whatTheGateRuns(scripts, "check");
  const ci = whatCiRuns(join(root, ".github"));
  const gaps = [...local].filter((one) => !ci.has(one));

  if (gaps.length === 1 && gaps[0] === "scripts/check-nothing-runs-this.mjs") {
    console.log("[gate-parity] SELFTEST missing: a gate no workflow runs was reported, as it must be");
    process.exit(0);
  }
  console.error("[gate-parity] SELFTEST missing: the planted gap was NOT reported — this check is asleep");
  process.exit(1);
}

/**
 * And the half that would make it useless: a gate CI DOES run must not be reported.
 *
 * The first version compared file names and would have passed this; comparing whole invocations is
 * what makes `--check` and a `SELFTEST=` different runs, so the equality has to be shown to hold on
 * a real pair as well as to fail on a planted one.
 */
if (process.env.SELFTEST === "present") {
  const scripts = { check: "SELFTEST=probe node scripts/check-test-probes.mjs && node scripts/check-tsconfigs.mjs" };
  const local = whatTheGateRuns(scripts, "check");
  const ci = whatCiRuns(join(root, ".github"));
  const gaps = [...local].filter((one) => !ci.has(one));

  if (gaps.length === 0) {
    console.log("[gate-parity] SELFTEST present: a gate CI does run was left alone, as it must be");
    process.exit(0);
  }
  console.error(`[gate-parity] SELFTEST present: reported a gate CI runs — ${gaps.join(", ")}`);
  process.exit(1);
}

run();
