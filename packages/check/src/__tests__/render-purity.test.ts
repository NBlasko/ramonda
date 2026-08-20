import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "render-purity", "tsconfig.json"));

/**
 * What a render REACHES, which is never what a render is written to contain.
 *
 * Both rules here would be easy and nearly useless without the walk: the fault is almost always in
 * a helper the render calls, a utility imported from another file, or the third branch of a chain
 * of conditionals. The fixture pairs every case with its opposite, because that pairing is the
 * whole test — a rule that reports the helper AND the handler has not found a fault, it has found
 * functions.
 */
describe("state written by something a render reaches", () => {
  test("is reported from the body, from a helper, from a list callback and from a @compute", () => {
    const found = run().findings["state-written-while-rendering"];
    expect(found.map((issue) => `${issue.field} via ${issue.through.join(" → ")}`)).toEqual([
      "n via total",
      "n via render",
      "label via render → stamp",
      "n via render",
      "hits via render → count",
      "n via render → viaArrowField",
    ]);
  });

  /**
   * The reach used to stop at the class's own members, so an INHERITED method was never followed
   * and state declared on a base was not state as far as the rule was concerned. Both were gaps
   * rather than decisions — a base is another class and the same object — and both were found by
   * planting the write and watching nothing be reported.
   */
  test("a write through an inherited method, to state declared on the base, is reported", () => {
    const found = run().findings["state-written-while-rendering"];
    const inherited = found.find((issue) => issue.field === "hits");
    expect(inherited?.through).toEqual(["render", "count"]);
    expect(inherited?.file).toContain("inherited.tsx");
  });

  /**
   * The four shapes it must stay quiet about, and the third is the one that matters most.
   *
   * `@memoized pick(id) { return () => { this.n += 1; } }` is called BY the render — so the
   * walk is right to follow it — and what it returns runs on a click. A first version of this rule
   * walked into everything that was not written directly as a JSX attribute, and it reported five
   * places in this repository, every one of them that idiom. A checker that reports a first-class
   * pattern of the framework is a checker somebody switches off.
   */
  test("a handler, a handler factory, a lifecycle and a plain field are all left alone", () => {
    const found = run().findings["state-written-while-rendering"];
    // `cache` is not state; `@mounted` is never reached from a render; the two handlers run later.
    expect(found.some((issue) => issue.field === "cache")).toBe(false);
    expect(found).toHaveLength(6);
  });

  /**
   * An arrow FIELD is a property, not a method — and `this.helper()` looked for a method, so the
   * walk ended there without a word. It is not an exotic shape: it is the one `arrow-fields` exists
   * to talk about, so a codebase that has any at all has them being called.
   */
  test("a write inside an arrow field the render calls is reported", () => {
    const found = run().findings["state-written-while-rendering"];
    const viaField = found.find((issue) => issue.through.includes("viaArrowField"));
    expect(viaField?.component).toBe("OtherPaths");
  });
});

describe("a clock or a random number reached from a render", () => {
  /**
   * The third of these is the reason the walk exists: `Date.now()` sits in another file, three
   * names from the render that reaches it. Nothing about the body of `render()` shows it.
   */
  test("is reported through a helper and across a file boundary", () => {
    const found = run().findings["clock-read-while-rendering"];
    expect(found.map((issue) => `${issue.read} via ${issue.through.join(" → ")}`)).toEqual([
      "Math.random() via render",
      "new Date() via render",
      "Date.now() via render → decorate → stampedLabel",
      "Date.now() via render → viaArrowField",
      "Date.now() via render → viaStatic",
      "Date.now() via render → viaGetter",
      "Date.now() via render → stampFromBase",
    ]);
  });

  /**
   * Four ways of reaching a render that are not a `this.method()` call, and every one of them was
   * missed against a claim that says "by any path". Each was planted and measured; the runtime
   * reports all four, because `renderPhase.component` is set whatever the path was.
   *
   * - an arrow FIELD, which is a property rather than a method
   * - a GETTER, which is read rather than called — `{this.total}` runs its body right there
   * - `super.method()`, whose callee is not `this`
   * - a STATIC, walked with `this` meaning the constructor rather than the instance, so a write
   *   through it is nobody's state and only what does not depend on `this` is reported
   */
  /**
   * A subclass OVERRIDING a base's method: only the subclass's body runs, and walking both reported
   * the version that never does. Found in review, with a base whose `stamp()` reads a clock and a
   * subclass whose `stamp()` returns a constant.
   *
   * The lookup takes the NEAREST declaration now, which is how JS resolves a method — and `super.`
   * starts at the BASES, which is the whole meaning of the keyword and is what keeps
   * `ThroughSuper` reported.
   */
  test("an overridden base method is not walked, while super still reaches one", () => {
    const found = run().findings["clock-read-while-rendering"];
    expect(found.some((issue) => issue.component === "OverridesIt")).toBe(false);
    expect(found.some((issue) => issue.through.includes("stampFromBase"))).toBe(true);
  });

  test("an arrow field, a getter, a super call and a static are all reached", () => {
    const found = run().findings["clock-read-while-rendering"];
    const paths = found.map((issue) => issue.through.at(-1));
    expect(paths).toContain("viaArrowField");
    expect(paths).toContain("viaGetter");
    expect(paths).toContain("viaStatic");
    expect(paths).toContain("stampFromBase");
  });

  /**
   * `new Date(value)` parses, and parsing is deterministic. And `plainLabel` is imported and called
   * exactly as `stampedLabel` is — so its silence is what says the walk judges what a function
   * DOES rather than where it came from.
   */
  test("parsing a timestamp and a deterministic import are not reported", () => {
    expect(run().findings["clock-read-while-rendering"]).toHaveLength(7);
  });
});

test("neither fails the run", () => {
  const result = run();
  expect(result.findings["state-written-while-rendering"].length).toBeGreaterThan(0);
  expect(result.findings["clock-read-while-rendering"].length).toBeGreaterThan(0);
  expect(result.issues).toEqual([]);
});
