import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";
import { certify, packageRootOf, renderCertificate } from "../certify";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");

/**
 * Most fixtures have no `package.json`, so the package that owns them is `@ramonda/check` itself —
 * which is the right root to pass, because that is what `--certify` would compute for them.
 */
function certificateFor(fixture: string) {
  const at = join(fixtures, fixture, "tsconfig.json");
  const root = packageRootOf(at);
  return certify(analyzeProject(at), root as string, { name: `@fixture/${fixture}`, version: "0.0.0" });
}

const heldIn = (fixture: string) =>
  Object.fromEntries(certificateFor(fixture).claims.map((claim) => [claim.id, claim.held]));

/**
 * What a package can and cannot claim about its own graph.
 *
 * Every package ships its graph whatever this says — a partial map is worth more than none, and a
 * certificate that gated the graph would give a publisher who cannot qualify a reason to ship
 * nothing. So this says how much of the map can be TRUSTED, as a list of claims that is meant to
 * get shorter rather than a score that is meant to go up.
 */
describe("what a package may claim", () => {
  test("a project with holes cannot claim to be complete", () => {
    const found = certificateFor("holes");
    const complete = found.claims.find((claim) => claim.id === "complete");

    expect(complete?.held).toBe(false);
    // Every unheld claim carries the work, not just the count: the site, what is wrong, and what to
    // write instead — which the analyzer already produces for every hole it records.
    expect(complete?.against.length).toBeGreaterThan(0);
    expect(complete?.against[0].at).toMatch(/^[^/].*:\d+:\d+$/);
    expect(complete?.against[0].fix).toBeTruthy();
  });

  test("a project with none can", () => {
    expect(heldIn("ok").complete).toBe(true);
  });

  /**
   * The measurement that produced this filter, and it is the reason the claims are scoped at all.
   *
   * Before it existed, `@ramonda/form`, `@ramonda/query` and `@ramonda/router` each reported two
   * written exemptions — and all six were the SAME two lines in `@ramonda/testing-library`, pulled
   * into the program by their test files. Three packages would have carried somebody else's excuse.
   */
  test("only this package's own files are judged", () => {
    const at = join(fixtures, "certify-scope", "tsconfig.json");
    const root = packageRootOf(at);
    expect(root).toBe(join(fixtures, "certify-scope"));

    // The program really does contain both faults — otherwise the assertion below would hold by
    // there being nothing to filter, which is how a scoping test passes while scoping nothing.
    const raw = analyzeProject(at);
    expect(raw.unresolved).toHaveLength(1);
    expect(raw.annotated).toHaveLength(1);

    // …and the package's own source really has something to judge, so this is not the empty case.
    expect(raw.graph.nodes.length).toBe(5);

    const found = certify(raw, root as string, { name: "@fixture/certified", version: "1.2.3" });
    const held = Object.fromEntries(found.claims.map((claim) => [claim.id, claim.held]));

    expect(held.complete).toBe(true);
    expect(held.plain).toBe(true);
    // `current` is the one claim a fixture cannot make: there is no built `dist` to fingerprint.
    expect(held.current).toBe(false);

    /**
     * And the HEADER counts the same surface the claims judge.
     *
     * The graph holds five nodes, two of them the nested package's — so counting `graph.nodes`
     * printed a size a fifth larger than what was judged, above three claims about something else.
     * Measured on `apps/docs` before the fix: 161 nodes, 33 of them core's, form's, query's and the
     * router's. The header exists so a reader sees the size of what was judged BEFORE reading the
     * verdict on it, which makes a count of something else worse than no count.
     */
    expect(found.covers.components).toBe(3);
  });

  test("the package root is the nearest directory above with a package.json", () => {
    expect(packageRootOf(join(fixtures, "certify-scope", "tsconfig.json"))).toBe(join(fixtures, "certify-scope"));
  });

  /**
   * The faults sit in a package NESTED inside the certified one, which a path prefix calls
   * "inside" and which is exactly what `node_modules` under an app looks like. What decides is the
   * file's own nearest `package.json`.
   */
  test("a nested package's faults are not the outer package's", () => {
    expect(packageRootOf(join(fixtures, "certify-scope", "vendor", "other.ts"))).toBe(
      join(fixtures, "certify-scope", "vendor"),
    );
  });
});

/**
 * A package with an EMPTY graph would hold every claim by holding nothing, which is the cheapest
 * route to a perfect certificate there is. Measured on this repository: `@ramonda/lens` and
 * `@ramonda/check` both have no components and would otherwise print four ticks.
 */
describe("a package with nothing in its graph", () => {
  test("says so before any verdict is read", () => {
    const empty = {
      package: { name: "@acme/nothing", version: "1.0.0" },
      scope: "library" as const,
      covers: { components: 0, exported: 0 },
      claims: [{ id: "complete" as const, held: true, says: "…", against: [] }],
    };

    const printed = renderCertificate(empty);
    expect(printed).toContain("Nothing to judge");
    expect(printed).not.toContain("Every claim holds");
    // And NO ticks: a tick reads as approval whatever sentence sits beside it, so a package with
    // nothing in its graph must not be able to print four of them.
    expect(printed).not.toContain("✓");
  });

  test("and a package that covers something and holds everything says THAT", () => {
    const full = {
      package: { name: "@acme/grid", version: "1.0.0" },
      scope: "library" as const,
      covers: { components: 4, exported: 3 },
      claims: [{ id: "complete" as const, held: true, says: "…", against: [] }],
    };

    expect(renderCertificate(full)).toContain("Every claim holds");
  });
});

/** Unheld claims come FIRST, because they are the only part a publisher has work in. */
describe("the report a publisher reads", () => {
  test("puts what is missing above what is done", () => {
    const printed = renderCertificate({
      package: { name: "@acme/grid", version: "1.0.0" },
      scope: "library",
      covers: { components: 4, exported: 3 },
      claims: [
        { id: "current", held: true, says: "held one", against: [] },
        { id: "complete", held: false, says: "missing one", against: [{ at: "src/a.tsx:1:1", why: "because" }] },
      ],
    });

    expect(printed.indexOf("missing one")).toBeLessThan(printed.indexOf("held one"));
  });
});
