#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { applyFixes } from "./fix";
import { analyzeProject } from "./analyze";
import { graphHtml } from "./graph-html";
import { diffGraphs, refuseToDiff } from "./diff";
import type { ComponentGraph } from "./graph";
import { certify, packageRootOf, renderCertificate } from "./certify";
import { type AnyRule, failingRules, RULES } from "./rules";
import { filesOf, splitOf } from "./split";
import { OPTIONS } from "./cliOptions";
import { docs, explain } from "./docsCommand";
import { type AnyGraphReport, GRAPH_REPORTS } from "./graphReports";
import { type JsonFinding, locationOf, messageOf, printJson } from "./jsonReport";

/**
 * `ramonda-check [tsconfig]`
 *
 * Reads your source and reports three things a running page would not tell you:
 *
 * - a context consumer with no provider above it on some path the source can produce — the page
 *   renders, the context quietly falls back to its default, and the numbers are wrong;
 * - a class field holding a function literal, which in Ramonda is a closure per instance for
 *   nothing, since every method is already bound;
 * - a single-use decorator declared twice, which the runtime can only report once the class is
 *   reached — a class behind a condition nobody clicked ships with the fault;
 * - a component that READS a form field it was handed without watching it, which never re-renders and
 *   which nothing at runtime can report, because the form cannot see who is rendering.
 *
 * Meant to sit in an app's `build` script: a check nobody runs is a check that does not exist.
 *
 * `--certify` prints what this PACKAGE can and cannot claim about the graph it ships: four claims,
 * each held or not, and every unheld one carrying the sites with what to write instead. A report,
 * never a gate — see `certify.ts` for why the graph ships either way.
 *
 * `--graph <file>` also writes the composition graph the checks are computed from — which
 * components exist and which one can mount which, including the edges nothing could resolve.
 *
 * `--graph-html <file>` writes the same graph as a picture: one self-contained page, rows by
 * distance from the roots, and a band of its own for whatever nothing reaches. Beside `--graph`
 * rather than instead of it — the JSON is what `--diff` reads, and a diff does not want markup.
 *
 * `--split` says what the browser loads before it does anything and what each lazily loaded piece
 * brings with it, and `--diff <graph.json>` compares this run against a graph written earlier.
 *
 * `--fix` writes the answers this run already knows, and `--fix --dry-run` says what it would
 * write. Only a fault whose fix has exactly ONE answer carries an edit — a rename, a deletion —
 * so `--fix` is never "this run is now clean": everything needing a person is still reported.
 * Both are reports: they describe, they never fail a build.
 */
const argv = process.argv.slice(2);
const TAG = "[ramonda-check]";

const HELP = `Usage: ramonda-check [tsconfig.json] [options]

Proves what a running page cannot, from the source: a context consumer with no provider above it,
and every rule on https://ramonda.dev/rules. The project is the tsconfig given, or ./tsconfig.json.

Commands, from the docs for this version, with no network:
  ramonda-check explain <code|rule>   what a diagnostic (RMD020) or a rule (unknown-hook-option) means
  ramonda-check docs [page]           a page of the docs (forms/fields), or with none, every page

Options:
${OPTIONS.map(([flag, takes, what]) => `  ${`${flag} ${takes}`.padEnd(22)} ${what}`).join("\n")}

Exit codes:
  0  nothing to report (reports such as --split and --diff never fail a run)
  1  a rule found something; each finding is printed with what to do
  2  the command line or the project could not be read

https://ramonda.dev/reference/check
`;

if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(HELP);
  process.exit(0);
}
if (argv.includes("--version") || argv.includes("-v")) {
  const own = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  console.log(own.version);
  process.exit(0);
}
// The two commands that read the docs this version was released with — see `docsCommand.ts`. Not where
// a path of that name exists: `ramonda-check docs` checked the project in ./docs before these commands
// did, and a CI step written that way must keep checking it. Found by review.
if ((argv[0] === "explain" || argv[0] === "docs") && !existsSync(resolve(argv[0]))) {
  if (argv[0] === "explain") explain(TAG, argv[1]);
  docs(TAG, argv[1]);
}
{
  const flags = OPTIONS.map(([flag]) => flag);
  const takesValue = new Set(OPTIONS.filter(([, takes]) => takes !== "").map(([flag]) => flag));
  for (const [at, word] of argv.entries()) {
    // A single dash too: `-x` was read as a tsconfig path, and reported missing as one.
    if (!word.startsWith("-") || flags.includes(word) || takesValue.has(argv[at - 1] ?? "")) continue;
    const [flag, value] = word.split("=", 2);
    if (value !== undefined && takesValue.has(flag)) {
      console.error(`${TAG} write ${flag} ${value}, with a space — ${flag}=… is not read. See --help.`);
      process.exit(2);
    }
    const meant = flags.find((one) => editDistance(word, one) <= 2);
    console.error(`${TAG} unknown option ${word}.${meant === undefined ? "" : ` Did you mean ${meant}?`} See --help.`);
    process.exit(2);
  }
}

/** Levenshtein distance — enough to name the option a slip was meant to be. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = row;
  }
  return previous[b.length];
}

/** The value after a flag, so it is never mistaken for the tsconfig argument. */
const valueOf = (flag: string): string | undefined => {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
};
const graphAt = valueOf("--graph");
const graphHtmlAt = valueOf("--graph-html");
const diffAgainst = valueOf("--diff");
const wantsSplit = argv.includes("--split");
const wantsFix = argv.includes("--fix");
const wantsCertify = argv.includes("--certify");
const wantsJson = argv.includes("--json");
const dryRun = argv.includes("--dry-run");
// By POSITION: a word is a path unless the word before it is a flag that takes one. Matched by text,
// `--graph out.json out.json` dropped the second as "the value" and checked ./tsconfig.json instead.
const takesFile = new Set(OPTIONS.filter(([, takes]) => takes !== "").map(([flag]) => flag));
const positionals = argv.filter((a, at) => !a.startsWith("-") && !takesFile.has(argv[at - 1] ?? ""));
// One project per run: a second path was read by nobody, and the run said nothing about it.
if (positionals.length > 1) {
  console.error(`${TAG} one tsconfig per run, not ${positionals.length}: ${positionals.join(" ")}`);
  process.exit(2);
}
if (dryRun && !wantsFix) {
  console.error(`${TAG} --dry-run goes with --fix: ramonda-check --fix --dry-run`);
  process.exit(2);
}
// `--json` is the plain run, read by a program: the reports beside it are prose with no JSON form.
for (const flag of ["--fix", "--split", "--diff", "--certify"]) {
  if (wantsJson && argv.includes(flag)) {
    console.error(`${TAG} --json reports a plain run, and ${flag} has no JSON form. Run them apart.`);
    process.exit(2);
  }
}
// Each option once: `--graph a.json --graph b.json` read the first and dropped the second unsaid.
for (const [flag] of OPTIONS) {
  if (argv.filter((a) => a === flag).length > 1) {
    console.error(`${TAG} ${flag} is given twice; give it once.`);
    process.exit(2);
  }
}
const arg = positionals[0];
const given = resolve(arg ?? "tsconfig.json");
// A folder is read as the tsconfig inside it, as `tsc -p` and `ramonda-css` read one.
const tsconfig = statSync(given, { throwIfNoEntry: false })?.isDirectory() ? join(given, "tsconfig.json") : given;

/**
 * Whether two paths are one file — by what it IS: a different case on a case-insensitive disk, or a
 * link, names the same file in another spelling, and a string comparison let the graph over both.
 */
function sameFile(a: string, b: string): boolean {
  if (resolve(a) === resolve(b)) return true;
  const one = statSync(a, { throwIfNoEntry: false });
  const two = statSync(b, { throwIfNoEntry: false });
  return one !== undefined && two !== undefined && one.dev === two.dev && one.ino === two.ino;
}
for (const [flag, value, example] of [
  ["--graph", graphAt, "--graph graph.json"],
  ["--graph-html", graphHtmlAt, "--graph-html graph.html"],
  ["--diff", diffAgainst, "--diff graph.json"],
] as const) {
  if (argv.includes(flag) && (value === undefined || value.startsWith("-"))) {
    console.error(`${TAG} ${flag} wants a file: ramonda-check <tsconfig> ${example}`);
    process.exit(2);
  }
}
// The graph goes to a file of its own — `--graph tsconfig.json` wrote it over the project being read.
for (const written of [graphAt, graphHtmlAt]) {
  if (written === undefined) continue;
  if (sameFile(written, tsconfig)) {
    console.error(`${TAG} not writing the graph over ${written}, the tsconfig this run reads. Name another file.`);
    process.exit(2);
  }
  // The baseline is read AFTER the graph is written, so one file for both compared the graph with itself.
  if (diffAgainst !== undefined && sameFile(written, diffAgainst)) {
    console.error(
      `${TAG} not writing the graph over ${written}, the graph --diff compares against. Name another file.`,
    );
    process.exit(2);
  }
}
if (graphAt !== undefined && graphHtmlAt !== undefined && sameFile(graphAt, graphHtmlAt)) {
  console.error(
    `${TAG} --graph and --graph-html both name ${graphAt}; the page would replace the graph. Name two files.`,
  );
  process.exit(2);
}

/**
 * The line that opens a rule's section, with the rule's ID in it.
 *
 * The id used to appear nowhere in the output, which left a reader with a sentence and no name.
 * The id is the name: it is the key in `findings`, the row on the reference page, and the thing to
 * search for — and the reference is a table keyed by it, so somebody who has it can find the entry
 * and somebody who has only the prose cannot.
 *
 * The URL is deliberately NOT printed beside it. The page has no per-rule anchor, so a link would
 * land at the top of a long reference — the exact failure `links.test.ts` was written about, where
 * "the docs sent me to the wrong place" reads as a broken site rather than a broken link. The
 * package's README carries the address once, which is where an address belongs.
 */
function sectionHeading(rule: AnyRule, found: readonly unknown[]): string {
  return `\n${TAG} ${rule.id} — ${rule.report.heading(found as never)}\n`;
}

if (!existsSync(tsconfig)) {
  console.error(`${TAG} no tsconfig at ${tsconfig}. Pass one: ramonda-check <path>`);
  process.exit(2);
}
if (diffAgainst && !existsSync(resolve(diffAgainst))) {
  console.error(`${TAG} nothing to compare against at ${resolve(diffAgainst)}`);
  process.exit(2);
}

const result = analyzeProject(tsconfig);
// The faults the graph answers are read through `GRAPH_REPORTS`, not here.
const { findings, annotated, counts, graph, notes } = result;

if (!wantsJson) for (const note of notes) console.warn(`${TAG} ${note}`);
/** What the run says about a file it wrote. On stderr under `--json`, where stdout is the object. */
const said = wantsJson ? console.error : console.log;

if (graphAt) {
  const target = resolve(graphAt);
  mkdirSync(dirname(target), { recursive: true });
  // Two spaces and a trailing newline: this is a file people will read in a review, and a diff
  // between two commits is the reason it exists at all.
  writeFileSync(target, `${JSON.stringify(graph, null, 2)}\n`);
  const holes = graph.edges.filter((e) => e.kind === "unresolved").length;
  said(
    `${TAG} graph written to ${graphAt} — ${graph.nodes.length} nodes, ${graph.edges.length} edges` +
      (holes > 0 ? `, ${holes} of them unresolved` : ""),
  );
}

/**
 * What this package can and cannot CLAIM about the graph it ships — see `certify.ts`.
 *
 * Beside `--graph` and never instead of it. Every package ships its graph whatever this says: an
 * app splices the fragment in and walks it, and a partial map is worth more than none. A
 * certificate that gated the graph would give a publisher who cannot qualify a reason to ship
 * nothing at all, and the consumer would lose twice.
 *
 * A report, like `--split` and `--diff`: it describes and never fails a run. What it is FOR is a
 * publisher who will not read a graph — a real one is hundreds of nodes — so the JSON stays the
 * machine\'s artefact and this is the person\'s, and it says what to do rather than what is.
 */
if (wantsCertify) {
  const root = packageRootOf(tsconfig);
  if (root === undefined) {
    console.error(`${TAG} --certify needs a package: no package.json above ${tsconfig}`);
    process.exit(2);
  }
  console.log(renderCertificate(certify(result, root, graph.package)));
  console.log("");
}

/**
 * The same graph as a picture, in ONE file.
 *
 * Beside `--graph` rather than instead of it: the JSON is what a diff reads and what `--diff`
 * compares, and neither of those wants markup. This is for the other question — the one a hundred
 * kilobytes of JSON cannot answer, which is what the shape of the app actually is.
 */
if (graphHtmlAt) {
  const target = resolve(graphHtmlAt);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, graphHtml(graph));
  const lost = graph.nodes.filter(
    (node) => node.kind !== "root" && !graph.edges.some((edge) => edge.to === node.id),
  ).length;
  said(
    `${TAG} graph drawn to ${graphHtmlAt} — ${graph.nodes.length} nodes, ${graph.edges.length} edges` +
      (lost > 0 ? `, ${lost} that nothing points at` : ""),
  );
}

/**
 * What the browser loads before it does anything, and what each lazily loaded piece brings.
 *
 * A description and never a verdict: there is no budget to exceed here and nothing fails. The
 * counts are DECLARATIONS, not bytes — nothing in this program has weighed a bundle, and a
 * number that looks like a size and is not would be read as one.
 */
if (wantsSplit) {
  if (graph.scope === "library") {
    console.log(
      `\n${TAG} ${graph.package.name} is a library, so nothing here loads first — what its\n` +
        `        pieces cost is decided by the app that mounts them.\n`,
    );
  } else {
    const split = splitOf(graph);
    console.log(`\n${TAG} what loads when — ${graph.package.name}\n`);
    console.log(`  before anything      ${split.initial.length} declaration(s) in ${filesOf(split.initial)} file(s)`);
    console.log(`  loaded on demand     ${split.points.length} split point(s)`);
    console.log(`  shared between them  ${split.shared.length} declaration(s)\n`);

    if (split.points.length > 0) {
      const SHOWN = 10;
      const header = `${"split point".padEnd(52)}${"reach".padStart(6)}${"already".padStart(9)}${"shared".padStart(8)}${"its own".padStart(9)}`;
      console.log(`  ${header}`);
      for (const point of split.points.slice(0, SHOWN)) {
        // The file and not the name alone: `class Page` is declared once per generated page here,
        // so a column of names is a column of one word repeated.
        const named = `${point.name}  ${point.file}`;
        console.log(
          `  ${(named.length > 51 ? `…${named.slice(named.length - 50)}` : named).padEnd(52)}` +
            `${String(point.reach).padStart(6)}${String(point.loaded).padStart(9)}` +
            `${String(point.shared).padStart(8)}${String(point.own.length).padStart(9)}`,
        );
        if (point.sites.length > 1) console.log(`    loaded from ${point.sites.length} places, one chunk`);
      }
      if (split.points.length > SHOWN) {
        console.log(
          `  … and ${split.points.length - SHOWN} more. Sorted by what each carries alone, so the ` +
            `ones\n    left out are the ones whose weight is already counted above as shared.`,
        );
      }
      console.log("");
    }

    if (split.shared.length > 0) {
      const most = split.shared[0];
      console.log(
        `  ${split.shared.length} declaration(s) are reached by more than one split point — ` +
          `${most?.name} by ${most?.by} of them.\n  A bundler puts those in a chunk the others pull ` +
          `in, so they are downloaded once and not per point.\n`,
      );
    }
    if (split.points.length === 0) {
      console.log(`  Nothing is loaded on demand: every declaration this app mounts is in the first payload.\n`);
    }
  }
}

/**
 * What a change moved — and above all, what it moved into the first payload.
 */
if (diffAgainst) {
  const file = resolve(diffAgainst);
  let saved: ComponentGraph | undefined;
  try {
    saved = JSON.parse(readFileSync(file, "utf8")) as ComponentGraph;
  } catch {
    console.error(`${TAG} ${diffAgainst} is not readable JSON, so there is nothing to compare against`);
    process.exit(2);
  }
  const refused = refuseToDiff(saved as ComponentGraph, graph);
  if (refused) {
    console.error(`${TAG} refusing to compare: ${refused}`);
    process.exit(2);
  }

  const change = diffGraphs(saved as ComponentGraph, graph);
  console.log(`\n${TAG} against ${diffAgainst} — ${graph.package.name}\n`);
  if (change.identical) {
    console.log(`  The same sources, byte for byte. Nothing moved.\n`);
  } else {
    console.log(
      `  nodes  +${change.nodesAdded.length}  -${change.nodesRemoved.length}` +
        `        edges  +${change.edgesAdded.length}  -${change.edgesRemoved.length}`,
    );
    const delta = change.initialAfter - change.initialBefore;
    console.log(
      `  before anything: ${change.initialBefore} → ${change.initialAfter} declaration(s)` +
        (delta === 0 ? "" : ` (${delta > 0 ? "+" : ""}${delta})`),
    );
    console.log("");
    for (const [title, list] of [
      ["in the first payload now, and not before", change.intoInitial],
      ["no longer in the first payload", change.outOfInitial],
    ] as const) {
      if (list.length === 0) continue;
      console.log(`  ${list.length} ${title}:`);
      for (const node of list.slice(0, 12)) console.log(`    ${node.name ?? node.id} — ${node.at}`);
      if (list.length > 12) console.log(`    … and ${list.length - 12} more`);
      console.log("");
    }
    if (change.intoInitial.length === 0 && change.outOfInitial.length === 0) {
      console.log(`  Nothing moved in or out of the first payload.\n`);
    }
  }
}

/**
 * Every annotated site, on every run.
 *
 * The escape hatch is a RECORD, not a silence: printed whether or not anything failed, so the
 * number cannot creep up unread. This is also the only place a reader learns what the map does not
 * cover.
 */
/**
 * `--json`: everything the text run would report, as one object — see `jsonReport.ts`. The same
 * readers as the text below, so the two cannot report different things.
 */
if (wantsJson) {
  const own = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  const found: JsonFinding[] = [];
  for (const graphReport of GRAPH_REPORTS as readonly AnyGraphReport[]) {
    for (const item of graphReport.items(result)) {
      const at = locationOf(item);
      found.push({
        code: graphReport.id,
        severity: "error",
        ...at,
        message: messageOf(graphReport.lines(item)),
        data: item,
      });
    }
  }
  for (const rule of RULES) {
    for (const issue of findings[rule.id]) {
      const at = locationOf(issue);
      found.push({
        code: rule.id,
        severity: rule.report.severity,
        ...at,
        message: messageOf(rule.report.lines(issue as never), at),
        data: issue,
      });
    }
  }
  const ok = !found.some((finding) => finding.severity === "error");
  printJson({
    tool: "ramonda-check",
    version: own.version,
    ok,
    findings: found,
    notes,
    ignored: annotated,
    counts,
  });
  process.exit(ok ? 0 : 1);
}

if (annotated.length > 0) {
  console.warn(`\n${TAG} ${annotated.length} site(s) this cannot resolve, with a reason written beside them:\n`);
  for (const site of annotated) {
    console.warn(`  ${site.file}:${site.line}:${site.column}`);
    console.warn(`    ${site.what} — ${site.reason}`);
  }
  console.warn("");
}

/**
 * A component asking the browser where it is, where the router already knows.
 *
 * A WARNING and not a failure, which is the rule for a new rule here: one version that says so,
 * the next that refuses. It is printed above the verdict and counts for nothing in it.
 */
/**
 * Whether anything below would fail the run.
 *
 * The rule half is DERIVED rather than listed. It was a clause per rule — `arrowFields.length === 0
 * && duplicateDecorators.length === 0 && …` — and a rule added without its clause would have made
 * this print "everything is fine" above its own report. That is the worst shape a bug in a checker
 * can take, and the list is the only thing that made it possible.
 */

/**
 * `--fix` writes the answers this run already knows, and `--dry-run` says what it would write.
 *
 * Placed BEFORE the report, so what is printed afterwards is the state of the code as it now
 * stands rather than the state it was in when the run started. A reader who fixes and then sees the
 * same list would rightly stop believing either half.
 *
 * Only a fault whose fix has ONE answer carries an edit; everything else still prints its advice
 * and is still counted below. So `--fix` never means "this run is now clean".
 */
if (wantsFix) {
  const fixed = applyFixes(findings, !dryRun);

  if (fixed.applied === 0) {
    console.error(`${TAG} nothing to fix — no fault reported here has a single answer.`);
  } else {
    console.error(
      `${TAG} ${dryRun ? "would apply" : "applied"} ${fixed.applied} fix(es) across ${fixed.files.length} file(s):`,
    );
    for (const said of fixed.said) console.error(`  ${said}`);
  }

  if (fixed.overlapping > 0) {
    console.error(
      `\n${TAG} ${fixed.overlapping} fix(es) left alone: another fix wanted the same characters, and choosing between them would be a guess.`,
    );
  }

  /**
   * `--fix --dry-run` is a CHECK, and answers with its exit code.
   *
   * It is the shape `biome format --check` and every tool like it uses, and it answers one question:
   * is there a fault in the tree that the checker already knows the edit for?
   *
   * **What it no longer buys, since every rule is an error.** This step used to be the only thing
   * that failed on a mechanical fault: most rules warned, a normal run exited 0 on a warning, and a
   * warning with a mechanical answer was not a judgement anyone could reasonably defer. There are no
   * warnings now — measured, 87 rules and none of them `warn`, with `verdict.test.ts` holding that —
   * so a finding with a fix fails the plain run too, because fixes come only from rules and
   * `failingRules` takes every rule that reported. As a gate over rule findings it was therefore
   * redundant with the run before it, and it left `pnpm check` on 2026-09-04 — measured at 25-30
   * seconds for an answer the run before it had already given. What puts this path through its
   * paces now is `fix-gate.test.ts`, against the same built CLI.
   *
   * It stops here rather than falling through to the report. One question, one answer: a step that
   * also printed every unrelated finding would be read as the whole check and is not.
   */
  if (dryRun) {
    if (fixed.applied > 0) {
      console.error(`\n${TAG} run \`--fix\` to apply them, or fix them by hand — this run is failing on them.`);
      process.exit(1);
    }
    process.exit(0);
  }
}

const failing = failingRules(findings);

// From `GRAPH_REPORTS`, the list both printers read — a hand-written list beside it was a second one to
// keep in step, and a report added to only one would have made the plain run say "quiet" above its own
// finding while `--json` said `ok: false`. Found by review.
if (
  failing.length === 0 &&
  (GRAPH_REPORTS as readonly AnyGraphReport[]).every((report) => report.items(result).length === 0)
) {
  console.log(
    `${TAG} ${counts.components} components, ${counts.contexts} contexts, ${counts.roots} root(s) — ` +
      `every consumer has a provider above it, and every rule that can fail this run is quiet.`,
  );
  process.exit(0);
}

/**
 * The faults computed from the whole graph, each printed from what `graphReports.ts` says about it —
 * after the verdict above, before the rules. Why each one is a fault is written there.
 */
for (const graphReport of GRAPH_REPORTS as readonly AnyGraphReport[]) {
  const items = graphReport.items(result);
  if (items.length === 0) continue;
  console.error(`\n${TAG} ${graphReport.heading(items.length)}:\n`);
  for (const item of items) {
    console.error(`  ${item.file}:${item.line}:${item.column}`);
    for (const line of graphReport.lines(item)) console.error(line);
    console.error("");
  }
  if (graphReport.advice !== undefined) console.error(graphReport.advice);
}

/**
 * Every rule that reported, printed from what the rule itself says.
 *
 * After the graph's own errors rather than before them, because a missing provider is a fact about
 * the whole app and one of these is a fact about one class: the reader wants the first one first.
 *
 * **Not filtered by severity, and that is deliberate.** Every rule is an error today, so a filter
 * would have one arm — and the arm it dropped would be the one a future warning rule landed in,
 * which would then report NOWHERE. A severity decides the exit code, through `failingRules`. It
 * does not decide whether the reader is told.
 */
for (const rule of RULES) {
  const found = findings[rule.id];
  if (found.length === 0) continue;
  console.error(sectionHeading(rule, found));
  for (const issue of found) for (const line of rule.report.lines(issue as never)) console.error(line);
  console.error(`${rule.report.advice}\n`);
}

process.exit(1);
