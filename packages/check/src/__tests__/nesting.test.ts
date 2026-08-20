import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "nesting", "tsconfig.json"));

/**
 * Markup the HTML parser will not keep where it was written.
 *
 * JSX has no content model — it nests whatever you nest — so this is a class of fault the compiler
 * has no way to see. The framework watches a narrower version at runtime (`RMD010`, and a bad
 * nesting also surfaces as a hydration mismatch), but only once the markup actually renders.
 */
describe("a tag outside the parent it needs", () => {
  test("is reported, wherever the parent is wrong", () => {
    const found = run().findings["tag-needs-its-parent"];
    expect(found.map((issue) => `${issue.tag} in ${issue.found}`)).toEqual([
      "tr in div",
      "tr in div",
      "option in div",
      "rt in p",
    ]);
  });

  /**
   * Ruby annotation, whose parent set is closed in the same way a table's is — `<rtc>` was the other
   * answer and has been removed from the standard. Found by auditing the table against the content
   * models rather than by anybody writing ruby.
   *
   * `<area>` stays OUT for the opposite reason, and it is the shape worth remembering: it needs a
   * `<map>` ANCESTOR, not a `<map>` parent, so `<map><p><area /></p></map>` is legal and an entry
   * for it would report correct markup.
   */
  test("an annotation with nothing to annotate is reported, and a correct ruby is not", () => {
    const found = run().findings["tag-needs-its-parent"];
    expect(found.filter((issue) => issue.tag === "rt")).toHaveLength(1);
    expect(found.some((issue) => issue.tag === "rp")).toBe(false);
  });

  /**
   * The judgement call in this rule, asserted from both sides.
   *
   * `<tbody>{rows.map((row) => <tr />)}</tbody>` is how every table in every application is
   * written, and a rule that stopped walking at the arrow would be silent about tables — which is
   * most of what it exists for. So a callback is walked THROUGH, and the fixture writes the same
   * shape twice: once in a `<tbody>`, where it must stay quiet, and once in a `<div>`, where it
   * must speak. One of the two reports above is the second of those.
   */
  test("a row built in a callback is judged by where the callback sits", () => {
    const found = run().findings["tag-needs-its-parent"];
    // Two `.map()` rows in the fixture, one correctly placed and one not.
    expect(found.filter((issue) => issue.tag === "tr")).toHaveLength(2);
  });

  /**
   * A component in the way makes the real parent unknowable: what `<Body />` renders is decided
   * inside `Body`, and it may well be the `<tbody>` this row needs.
   */
  test("a component in the way makes it say nothing", () => {
    const found = run().findings["tag-needs-its-parent"];
    expect(found.every((issue) => issue.found !== undefined)).toBe(true);
    // The fixture puts a `<tr>` inside `<Body>`; four reports means it was not one of them.
    expect(found).toHaveLength(4);
  });

  test("it names the parents the tag may have", () => {
    const found = run().findings["tag-needs-its-parent"];
    expect(found[0]?.wants).toEqual(["table", "thead", "tbody", "tfoot"]);
  });
});

describe("an element nested inside another of the same kind", () => {
  /**
   * Both are links inside links: one written directly, one with a `<span>` between them — which is
   * how it actually gets written, and why the walk does not stop at the nearest element.
   */
  test("is reported through a wrapper as well as directly", () => {
    const found = run().findings["interactive-inside-interactive"];
    expect(found.map((issue) => issue.tag)).toEqual(["a", "a"]);
  });

  /**
   * Two buttons side by side are correct markup and the commonest thing in any toolbar. And a
   * component inside a button is unprovable, for the same reason as above.
   */
  test("siblings and a component in the way are left alone", () => {
    expect(run().findings["interactive-inside-interactive"]).toHaveLength(2);
  });
});

/** Neither fails a build yet — the repository's rule for a new rule. */
test("neither fails the run", () => {
  const result = run();
  expect(result.findings["tag-needs-its-parent"].length).toBeGreaterThan(0);
  expect(result.findings["interactive-inside-interactive"].length).toBeGreaterThan(0);
  expect(result.issues).toEqual([]);
});
