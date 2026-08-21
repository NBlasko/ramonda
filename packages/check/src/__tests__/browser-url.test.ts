import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = (name: string) => analyzeProject(join(here, "fixtures", name, "tsconfig.json"));

/**
 * Asking the browser where you are, in a project whose router already knows.
 *
 * The two are the same fact from two sources and only one is reactive: read from the router a
 * component re-renders when the route moves, read from `window` it is a snapshot taken once. The
 * failure is quiet — the page is simply out of date — which is why it is worth a rule rather than a
 * matter of taste.
 */
describe("a component reading the browser's URL", () => {
  test("is reported, with the router's answer where there is one", () => {
    const browserUrlReads = run("browser-url").findings["browser-url"];
    expect(browserUrlReads.map((r) => `${r.read} -> ${r.instead ?? "—"}`)).toEqual([
      "window.location.pathname -> pathname",
      "location.hash -> hashTags",
      "window.location.search -> searchParams",
      // Nothing on the router answers `origin`, and none is invented for it.
      "window.location.origin -> —",
      // The three spellings beside `window.` — see the test below for what each is.
      "self.location.pathname -> pathname",
      "{ pathname } = window.location -> pathname",
      'window.location["hash"] -> hashTags',
      // One `this.method()` away, which is where a read like this actually lives.
      "location.pathname -> pathname",
    ]);
    expect(new Set(browserUrlReads.map((r) => r.component))).toEqual(
      new Set(["Astray", "OtherSpellings", "ViaAHelper"]),
    );
  });

  /**
   * How far it looks: the whole class, and no further.
   *
   * A read in a helper the component calls is found. A utility in ANOTHER FILE is not, and that is
   * a decision — this report names a component and a line with nothing to say how the two are
   * connected, so following the import would name a component that did not write the line, once per
   * caller. The two rules that DO follow imports carry a `through` path for exactly that reason.
   */
  test("a read one this.method() away is found, and one across a file boundary is not", () => {
    const components = run("browser-url").findings["browser-url"].map((issue) => issue.component);
    expect(components).toContain("ViaAHelper");
    expect(components).not.toContain("ViaAnotherFile");
  });

  /**
   * A local of the same name is not the global, and the difference costs no type: the program is
   * built with `noLib` and no `@types`, so the browser's own `location` resolves to nothing while
   * one written in the source resolves where it is written.
   */
  /**
   * The same read, spelled three other ways — all silent until they were planted.
   *
   * `self` is the third name for the global and the package's other rules already list it;
   * `const { pathname } = window.location` is a read of exactly that member with the member's name
   * on the left; and `location["hash"]` is the dotted read with brackets round it.
   */
  test("`self`, a destructure and a bracketed key are the same read", () => {
    const found = run("browser-url").findings["browser-url"].filter((i) => i.component === "OtherSpellings");

    expect(found.map((i) => `${i.line}:${i.read}`)).toEqual([
      "41:self.location.pathname",
      // Quoted as the reader sees it, not rewritten into a dotted form that is not on the line.
      "42:{ pathname } = window.location",
      '43:window.location["hash"]',
    ]);
    expect(found.map((i) => i.instead)).toEqual(["pathname", "pathname", "hashTags"]);
  });

  test("a local called `location` is left alone", () => {
    const browserUrlReads = run("browser-url").findings["browser-url"];
    expect(browserUrlReads.some((r) => r.component === "Careful")).toBe(false);
  });

  /**
   * A read, and only a read. `window.location.href = "…"` is a different fault with a different
   * answer, and `location.reload()` is the one thing the router genuinely cannot replace —
   * reported as "reads", both would be advice to do something impossible.
   */
  test("a write and a method call are not reads", () => {
    const browserUrlReads = run("browser-url").findings["browser-url"];
    expect(browserUrlReads.some((r) => r.component === "Leaving")).toBe(false);
  });

  /**
   * Without a router there is nowhere else to read it from, and a rule that reports the only thing
   * a reader could have written is a rule people switch off.
   */
  test("a project with no router is not reported at all", () => {
    // The same read as above, in a project that imports no router. Asserted against a fixture that
    // HAS the read: pointed at one without it, this test passes whatever the rule does.
    expect(run("browser-url-no-router").findings["browser-url"]).toEqual([]);
  });

  /**
   * The router's OWN code is left alone, which is the other side of the same argument.
   *
   * Somewhere inside the router, something has to read `window.location` or the router would have
   * nothing to tell anybody. A rule about reaching past an abstraction is always wrong about the
   * code that implements it.
   *
   * **This fixture exists because the guard was unreachable and nothing said so.** The exemption
   * had been written by hand inside the rule since it was added, and deleting it failed no test —
   * measured. The reason is that the other gate fires first: a rule with `needs` only runs in a
   * project that IMPORTS the package, and `@ramonda/router` does not import itself, so the rule
   * never reached its own source to be exempted from. This fixture is a package that does both —
   * it is named `@ramonda/router` and it reaches for itself by name — which is the shape a
   * workspace self-reference actually takes, and the only shape in which the guard can speak.
   */
  test("the router's own package is not reported, even reaching for itself by name", () => {
    const result = run("inside-router");
    // The read is really there and really inside the router: without both, this passes vacuously.
    expect(result.counts.components).toBeGreaterThan(0);
    expect(result.findings["browser-url"]).toEqual([]);
  });

  /**
   * It is a WARNING for now, which is this repository's rule for a new rule: one version that says
   * so, the next that refuses. Nothing must fail a build on it yet.
   */
  test("it does not fail the run", () => {
    const result = run("browser-url");
    expect(result.findings["browser-url"].length).toBeGreaterThan(0);
    expect(result.issues).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });
});
