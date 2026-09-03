#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { applyFixes } from "./fix";
import { analyzeProject } from "./analyze";
import { graphHtml } from "./graph-html";
import { diffGraphs, refuseToDiff } from "./diff";
import type { ComponentGraph } from "./graph";
import { certify, packageRootOf, renderCertificate } from "./certify";
import { type AnyRule, failingRules, RULES } from "./rules";
import { filesOf, splitOf } from "./split";

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
const dryRun = argv.includes("--dry-run");
const values = new Set([graphAt, graphHtmlAt, diffAgainst].filter((v): v is string => v !== undefined));
const arg = argv.find((a) => !a.startsWith("--") && !values.has(a));
const tsconfig = resolve(arg ?? "tsconfig.json");
const TAG = "[ramonda-check]";

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
for (const [flag, value, example] of [
  ["--graph", graphAt, "--graph graph.json"],
  ["--graph-html", graphHtmlAt, "--graph-html graph.html"],
  ["--diff", diffAgainst, "--diff graph.json"],
] as const) {
  if (argv.includes(flag) && (value === undefined || value.startsWith("--"))) {
    console.error(`${TAG} ${flag} wants a file: ramonda-check <tsconfig> ${example}`);
    process.exit(2);
  }
}
if (diffAgainst && !existsSync(resolve(diffAgainst))) {
  console.error(`${TAG} nothing to compare against at ${resolve(diffAgainst)}`);
  process.exit(2);
}

const result = analyzeProject(tsconfig);
const {
  issues,
  findings,
  unresolved,
  annotated,
  unreachable,
  unreachableRoutes,
  paramsOffRoute,
  secondProviders,
  renderCycles,
  classesAsChildren,
  counts,
  graph,
  notes,
} = result;

for (const note of notes) console.warn(`${TAG} ${note}`);

if (graphAt) {
  const target = resolve(graphAt);
  mkdirSync(dirname(target), { recursive: true });
  // Two spaces and a trailing newline: this is a file people will read in a review, and a diff
  // between two commits is the reason it exists at all.
  writeFileSync(target, `${JSON.stringify(graph, null, 2)}\n`);
  const holes = graph.edges.filter((e) => e.kind === "unresolved").length;
  console.log(
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
  console.log(
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
   * It is the shape `biome format --check` and every tool like it uses, and it is what makes this
   * usable in a gate: a fault the checker knows the answer to, left in the tree, is one nobody has
   * an excuse for. Most of them are warnings and a normal run exits 0 on those — which is right,
   * because a warning is a judgement someone may reasonably defer. A warning with a MECHANICAL
   * answer is not that.
   *
   * It stops here rather than falling through to the report. One question, one answer: a step that
   * also printed every unrelated warning would be read as the whole check and is not.
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

if (
  issues.length === 0 &&
  failing.length === 0 &&
  unresolved.length === 0 &&
  unreachable.length === 0 &&
  unreachableRoutes.length === 0 &&
  secondProviders.length === 0 &&
  paramsOffRoute.length === 0 &&
  renderCycles.length === 0 &&
  classesAsChildren.length === 0
) {
  console.log(
    `${TAG} ${counts.components} components, ${counts.contexts} contexts, ${counts.roots} root(s) — ` +
      `every consumer has a provider above it, and every rule that can fail this run is quiet.`,
  );
  process.exit(0);
}

/**
 * The strict rule: a component this cannot follow is an ERROR.
 *
 * The walk goes quiet below a name it cannot resolve, so everything under it is unjudged and the
 * build passes over a page that may be broken. A map with unmarked blanks is worse than no map,
 * because it is trusted. Whatever this cannot resolve, a bundler could not have code-split either.
 */
if (unresolved.length > 0) {
  console.error(`\n${TAG} ${unresolved.length} place(s) naming a component that cannot be followed:\n`);
  for (const hole of unresolved) {
    console.error(`  ${hole.file}:${hole.line}:${hole.column}`);
    console.error(`    through \`${hole.what}\` — ${hole.why}`);
    console.error("");
    for (const line of hole.fix.split("\n")) console.error(`      ${line}`);
    console.error("");
  }
  console.error(
    `Nothing below one of these is judged, so a broken page can pass. If the source is right and\n` +
      `this is the one that cannot see it, write the reason on the line — it is listed on every run:\n\n` +
      `    // ramonda-check-ignore the chunk is deliberately missing, to demonstrate the failure\n`,
  );
}

/**
 * The first rule computed from the graph rather than from the source.
 *
 * The walk visits everything a root mounts, so what it never arrived at is what nothing mounts. An
 * EXPORTED one is left alone: an app is entered through what it publishes, and an SSR entry is
 * called by the server rather than by this program.
 */
if (unreachable.length > 0) {
  console.error(`\n${TAG} ${unreachable.length} declaration(s) no root reaches:\n`);
  for (const dead of unreachable) {
    console.error(`  ${dead.file}:${dead.line}:${dead.column}`);
    console.error(`    ${dead.name} — nothing mounts this ${dead.kind}, on any path from any root.`);
    console.error("");
  }
  console.error(
    `Delete it, or mount it. Nothing outside its own file can even name it, so no import\n` +
      `elsewhere is keeping it alive — and an EXPORTED one is never reported, because an app is\n` +
      `entered through what it publishes and this cannot see who does the entering.\n`,
  );
}

/**
 * A whole section of a site that can never appear, which each page on its own gives no sign of.
 */
if (unreachableRoutes.length > 0) {
  console.error(`\n${TAG} ${unreachableRoutes.length} route table(s) whose views can never appear:\n`);
  for (const table of unreachableRoutes) {
    console.error(`  ${table.file}:${table.line}:${table.column}`);
    console.error(
      table.why === "unmounted"
        ? `    ${table.views} view(s), and no <RouteOutlet> in this build is handed this table.`
        : `    ${table.views} view(s), and no root reaches the <RouteOutlet> that mounts them.`,
    );
    console.error("");
  }
  console.error(
    `Hand the table to a <RouteOutlet>, and mount that outlet somewhere a root can reach —\n` +
      `or delete the table. Every page in it renders today's nothing, and each one on its own\n` +
      `looks perfectly well formed, which is why nothing else says a word.\n`,
  );
}

/**
 * The other read the runtime throws on, and the one nothing else can see.
 *
 * Two faults printed as one section because they are the same mistake at two distances, and each
 * line says which it is: nothing routes to this component at all, or something does and it is a
 * different route from the one the read names. The router's own two messages make the same split.
 */
if (paramsOffRoute.length > 0) {
  console.error(`\n${TAG} ${paramsOffRoute.length} params(pattern) read(s) the routing cannot answer:\n`);
  for (const read of paramsOffRoute) {
    console.error(`  ${read.file}:${read.line}:${read.column}`);
    // The path from a root, because the READ may be in a package the reader cannot edit — and then
    // the line to change is the mount, which is the only part of this that is theirs.
    if (read.path.length > 1) console.error(`    ${read.path.join(" > ")}`);
    console.error(
      read.why === "no-outlet"
        ? `    <${read.component}> reads \`${read.member}.params("${read.pattern}")\`, and no arrangement in ` +
            `this build puts it under a <RouteOutlet>.`
        : `    <${read.component}> reads \`${read.member}.params("${read.pattern}")\`, but the route that ` +
            `mounts it is "${read.route}", which supplies no ${(read.missing ?? [])
              .map((name) => `\`:${name}\``)
              .join(", ")}.`,
    );
    console.error("");
  }
  console.error(
    `Params are published by the outlet that MATCHED, and each outlet publishes only its own — so a\n` +
      `component reads the pattern of the route that mounts IT, and chrome beside the outlet (a nav\n` +
      `bar, a header, a footer) has a pathname and no params at all. The router throws on both of\n` +
      `these in every build.\n\n` +
      `Name the route this component is really rendered by, or move the read into the page that is\n` +
      `on that route and pass the value down as a prop. Use \`pathname\` if it is not part of a route,\n` +
      `and \`params<T>()\` with no argument when it is genuinely written against no ONE route.\n`,
  );
}

/**
 * The runtime throws when this happens. Here it is said before anything renders, on every path the
 * source can produce — including the branch nobody clicked.
 */
if (secondProviders.length > 0) {
  console.error(`\n${TAG} ${secondProviders.length} second provider(s) for a context that allows one:\n`);
  for (const second of secondProviders) {
    console.error(`  ${second.file}:${second.line}:${second.column}`);
    console.error(`    <${second.provider}> mounts a second "${second.context}", and one is already above it:`);
    console.error(`    ${second.path.join(" → ")}`);
    console.error("");
  }
  console.error(
    `Mount it once, on a component that wraps the rest. A context whose author wrote\n` +
      `\`single: true\` is one where two CONFLICT rather than the nearer winning — for the\n` +
      `router's, both listen to popstate and both write history.\n`,
  );
}

/**
 * A cycle by itself is not a fault — a tree renders itself for each child and stops when the data
 * runs out. This is the ring where nothing can stop.
 */
if (renderCycles.length > 0) {
  console.error(`\n${TAG} ${renderCycles.length} ring(s) of mounts that nothing can skip:\n`);
  for (const ring of renderCycles) {
    console.error(`  ${ring.file}:${ring.line}:${ring.column}`);
    console.error(`    ${ring.path.join(" → ")}`);
    console.error("");
  }
  console.error(
    `Every step on this ring runs on EVERY render — no branch, no callback, no loop — so the\n` +
      `first render recurses until the stack gives out, before a page appears. Put the recursion\n` +
      `behind the data that ends it: a condition, or the callback \`list()\` takes.\n`,
  );
}

/**
 * `{Named}` where `<Named />` was meant. It renders nothing and the runtime says nothing, because a
 * class is a function and the check for an object among children never sees it.
 */
if (classesAsChildren.length > 0) {
  console.error(
    `\n${TAG} ${classesAsChildren.length} component(s) named among children, where an element was meant:\n`,
  );
  for (const named of classesAsChildren) {
    console.error(`  ${named.file}:${named.line}:${named.column}`);
    console.error(`    {${named.name}} renders nothing. Write <${named.name} />.`);
    console.error("");
  }
  console.error(
    `A class among children is dropped, and nothing reports it at run time — the check for an\n` +
      `object that is not markup never sees it, because a class is a function. Handing a component\n` +
      `OVER is an attribute: \`<Slot view={Named} />\` is a binding, not a child.\n`,
  );
}

if (issues.length > 0) {
  console.error(`\n${TAG} ${issues.length} consumer(s) with no provider above them:\n`);
  for (const issue of issues) {
    console.error(`  ${issue.file}:${issue.line}:${issue.column}`);
    console.error(`    <${issue.consumer}> consumes "${issue.context}" — nothing provides it on this path:`);
    console.error(`    ${issue.path.join(" → ")}`);
    console.error("");
  }
  console.error(
    `Mount the matching Provider on a component above it — a context reaches only the providing\n` +
      `component and its descendants. This ran before the app did, so nothing had to render for it\n` +
      `to be found.\n`,
  );
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
