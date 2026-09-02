import { dirname, resolve as resolvePath, sep } from "node:path";
import ts from "typescript";
import type { AnalyzeResult } from "./analyze";
import { ruleCatalogue } from "./rules";

/**
 * What a package can and cannot claim about its own graph.
 *
 * ## Why this is not a grade
 *
 * A score tells a publisher where they stand and nothing about what to do, and the honest answer to
 * "how far should I go?" is a LIST that gets shorter rather than a number that goes up. So every
 * claim is held or not held, and a claim that is not held carries the sites — with what to write
 * instead, which the analyzer already produces for every hole it records.
 *
 * ## Why it rides on the graph rather than replacing it
 *
 * Every package ships its graph whatever this says: an app splices a fragment in and walks it, and
 * a partial map is still worth more than none. The certificate says how much of that map can be
 * TRUSTED. Made the other way round — a graph only for packages that qualify — a publisher who
 * cannot make the claims has a reason to ship nothing at all, and the consumer loses twice.
 *
 * ## What it cannot do, and it matters more than what it can
 *
 * A publisher writes their own graph, so nothing here proves the graph is a truthful reading of
 * the source. `describes` proves it matches the declaration file SHIPPED, which is a different and
 * much smaller claim. What makes a certificate earned is that a third party can REPRODUCE it:
 * npm provenance attests which commit and which public workflow built a tarball, and from there
 * anyone can run this command themselves and compare. Trust the process, not the file.
 */
export interface Certificate {
  package: { name: string; version: string };
  /** `library` for a package. An `app` has roots and is a different question. */
  scope: "app" | "library";
  /**
   * What the graph covers, which is what every claim below is ABOUT.
   *
   * Printed before the claims and never omitted, because a package with NOTHING in its graph would
   * otherwise hold every claim by holding nothing — and that is the cheapest way to look perfect
   * there is. A reader has to see the size of what was judged before reading the verdict on it.
   */
  covers: { components: number; exported: number };
  claims: Claim[];
}

export interface Claim {
  id: ClaimId;
  /** Held, or not. There is no third state and no partial credit. */
  held: boolean;
  /** What holding it MEANS, in the present tense — one line, shown either way. */
  says: string;
  /** When it is not held: where, and what to write instead. Empty when it is. */
  against: Against[];
}

export type ClaimId = "complete" | "quiet" | "plain" | "current";

/** One place a claim fails, in the shape a reader can act on without opening anything else. */
export interface Against {
  /** `src/Grid.tsx:44:12`, relative to the package root. */
  at: string;
  /** What is wrong, said in terms of the source. */
  why: string;
  /** What to write instead. Absent where the fault has no single spelling to suggest. */
  fix?: string;
}

/**
 * The package root a tsconfig belongs to — the nearest directory above it with a `package.json`.
 *
 * Every claim is scoped to files under this, and that is not a detail. Measured on this repository
 * before the filter existed: `@ramonda/form`, `@ramonda/query` and `@ramonda/router` each reported
 * two written escape hatches, and all six were the SAME two lines in
 * `@ramonda/testing-library` — dragged into the program by their test files. Three packages would
 * have carried somebody else's excuse.
 */
export function packageRootOf(tsconfigPath: string): string | undefined {
  let dir = dirname(resolvePath(tsconfigPath));
  for (;;) {
    if (ts.sys.fileExists(`${dir}/package.json`)) return dir;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

/**
 * Whether a file belongs to the package being certified, rather than to something else in its
 * program — decided by the file's OWN nearest `package.json`, never by the path.
 *
 * A prefix test looks equivalent and is not: everything under `app/node_modules/@acme/ui` is
 * "inside" the app by string, and a certificate built on that would let a package claim its
 * dependencies' faults as its own, or hide behind them. Asking each file which package OWNS it
 * gets both directions right, and costs one climb per directory because the answer is cached.
 */
function owns(root: string, file: string, cache: Map<string, string | undefined>): boolean {
  const dir = dirname(resolvePath(file));
  let found = cache.get(dir);
  if (found === undefined && !cache.has(dir)) {
    found = packageRootOf(resolvePath(file));
    cache.set(dir, found);
  }
  return (found ?? cache.get(dir)) === root;
}

/** `src/Grid.tsx:44:12`, relative to the package root, which is how a publisher reads their own tree. */
function where(root: string, at: { file: string; line: number; column: number }): string {
  const file = resolvePath(at.file);
  const trimmed = file.startsWith(root + sep) ? file.slice(root.length + 1) : file;
  return `${trimmed.split(sep).join("/")}:${at.line}:${at.column}`;
}

export function certify(result: AnalyzeResult, root: string, pkg: { name: string; version: string }): Certificate {
  const graph = result.graph;
  /** Directory → the package root that owns it. One climb per directory, not per finding. */
  const owner = new Map<string, string | undefined>();
  const mine = (file: string): boolean => owns(root, file, owner);

  /**
   * Holes in this package's OWN source. A hole is a place the source names a component this cannot
   * follow, and the walk goes quiet below it — so everything under it is unjudged and an app
   * splicing this fragment gets a map with an unmarked blank.
   */
  const holes = result.unresolved.filter((issue) => mine(issue.file));

  /**
   * Warnings. Not errors: an error already fails the run, so a package that publishes at all has
   * none, and a claim nobody can fail is not worth printing.
   */
  const warns = new Set(
    ruleCatalogue()
      .filter((rule) => rule.severity === "warn")
      .map((rule) => rule.id),
  );
  const warned: Against[] = [];
  for (const [id, found] of Object.entries(result.findings)) {
    if (!warns.has(id)) continue;
    for (const issue of found as { file: string; line: number; column: number }[]) {
      if (mine(issue.file)) warned.push({ at: where(root, issue), why: id });
    }
  }

  /**
   * Written escape hatches. A hole with a reason beside it is a RECORD rather than a silence, which
   * is why it is allowed at all — but it is still a blank on the map, so a package carrying one
   * cannot claim to be plain reading.
   */
  const excused = result.annotated.filter((site) => mine(site.file));

  return {
    package: pkg,
    scope: graph.scope,
    covers: {
      components: graph.nodes.length,
      exported: graph.nodes.filter((node) => node.exported).length,
    },
    claims: [
      {
        id: "complete",
        held: holes.length === 0,
        says: "every component it names, it can follow",
        against: holes.map((hole) => ({ at: where(root, hole), why: hole.why, fix: hole.fix })),
      },
      {
        id: "plain",
        held: excused.length === 0,
        says: "nothing needed an exemption written beside it",
        against: excused.map((site) => ({
          at: where(root, site),
          why: `${site.what} is exempted: ${site.reason}`,
        })),
      },
      {
        id: "quiet",
        held: warned.length === 0,
        says: "no rule warns about anything it ships",
        against: warned,
      },
      {
        id: "current",
        held: graph.describes !== undefined,
        says: "the graph fingerprints the declaration file it ships",
        against:
          graph.describes === undefined
            ? [
                {
                  at: "package.json",
                  why: "the graph does not say which declaration file it describes, so nothing can tell whether it is stale",
                  fix: "build the graph from the package that ships the types: `ramonda-check tsconfig.json --graph dist/ramonda-graph.json`",
                },
              ]
            : [],
      },
    ],
  };
}

const TAG = "[ramonda-certify]";

/**
 * The certificate as a publisher reads it: unheld claims FIRST, each with its work.
 *
 * Nobody reads a graph. A real app's graph is hundreds of nodes and the whole reason this exists is
 * that a publisher will not go looking — so the graph stays the machine's artefact and this is the
 * human's, and it says what to do rather than what is.
 */
export function renderCertificate(certificate: Certificate): string {
  const lines: string[] = [];
  const { name, version } = certificate.package;
  lines.push(`${TAG} ${name} ${version}`, "");

  /**
   * Said before any verdict, because a package with an EMPTY graph holds every claim by holding
   * nothing. Not a hypothetical: measured on this repository, `@ramonda/lens` and `@ramonda/check`
   * both report nothing to describe and would otherwise print four ticks — making "ship no
   * components" the cheapest route to a perfect certificate there is.
   */
  if (certificate.covers.components === 0) {
    /**
     * No claims are printed here at all, and that is the point rather than a shortcut.
     *
     * Every claim would hold — there is nothing to fail them with — so four ticks would appear
     * beside a sentence saying they mean nothing, and a tick reads as approval whatever is written
     * next to it. Printing them would make "ship no components" the cheapest route to a perfect
     * certificate there is.
     */
    lines.push(
      "  Nothing to judge: this package has no components or hooks, so it has no graph an app",
      "  could walk. Installing it neither adds to the picture nor takes anything away.",
    );
    return lines.join("\n");
  }

  if (certificate.scope === "app") {
    /**
     * An app is not certified, and saying so is more useful than refusing.
     *
     * A certificate is a promise to whoever INSTALLS the thing, and nobody installs an app. But the
     * same four questions asked of an app are worth asking — they are the ones its own `check` run
     * answers — so the report is printed with its subject named rather than withheld.
     */
    lines.push(
      "  An app, not a package. Nobody installs this, so the claims below are for you, not for a consumer.",
      "",
    );
  }

  lines.push(
    `  Covers ${certificate.covers.components} component(s) and hook(s), ` +
      `${certificate.covers.exported} of them exported.`,
    "",
  );

  const order = [...certificate.claims].sort((a, b) => Number(a.held) - Number(b.held));
  for (const claim of order) {
    lines.push(`  ${claim.held ? "✓" : "✗"} ${claim.id.padEnd(9)} ${claim.says}`);
    for (const against of claim.against) {
      lines.push("", `      ${against.at}`, `        ${against.why}`);
      if (against.fix) lines.push(`        → ${against.fix}`);
    }
    if (claim.against.length > 0) lines.push("");
  }

  const missing = certificate.claims.filter((claim) => !claim.held);
  lines.push("");
  lines.push(
    missing.length === 0
      ? "  Every claim holds. An app that installs this can walk its graph end to end."
      : `  ${missing.length} claim(s) not made. An app installing this gets a map with blanks in it,\n` +
          "  and the report above is the list of them — it is meant to get shorter, not to score.",
  );
  return lines.join("\n");
}
