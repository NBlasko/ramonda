import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "render-tree", "tsconfig.json"));
const ids = () => run().findings["duplicate-id"];
const headings = () => run().findings["heading-skips-a-level"];

/**
 * The fourth rule family reads one RENDER — every element in it, in document order. The other
 * three cannot: an element rule sees one element and its ancestors, which answers "is this `<tr>`
 * in a table" and nothing about two elements that never meet.
 *
 * What the family exists to compute is `alwaysPresent`. `{open ? <a id="x"/> : <b id="x"/>}` is two
 * elements in the source and one in the document, and a rule that compared them would report
 * markup that is correct — which is how a rule earns being switched off.
 */
describe("two elements claiming one id", () => {
  test("every duplicate is reported, pointing at the second", () => {
    expect(ids().map((issue) => `${issue.id} on <${issue.tag}>`)).toEqual([
      "email on <input>",
      "summary on <p>",
      "a on <input>",
    ]);
  });

  test("it names the line that will win the lookup", () => {
    const issue = ids()[0];
    expect(issue.firstAtLine).toBeLessThan(issue.line);
  });

  test("different ids are not a duplicate", () => {
    expect(ids().some((issue) => issue.id === "one" || issue.id === "two")).toBe(false);
  });

  /** Two branches of a ternary are one element in the document. */
  test("two branches of a ternary are not two elements", () => {
    expect(ids().some((issue) => issue.id === "name")).toBe(false);
  });

  /** A guard may not be there at all, so nothing can be proved about what it collides with. */
  test("an element behind a guard is not compared", () => {
    expect(ids().some((issue) => issue.id === "q")).toBe(false);
  });

  /**
   * A row inside a `map` is repeated or absent. It is a real fault to write a literal id there —
   * and it is a fault this family cannot prove, because nothing here knows the list has two rows.
   */
  test("a row inside a list is not compared", () => {
    expect(ids().some((issue) => issue.id === "row")).toBe(false);
  });

  test("a spread may carry the id, so the element is not judged", () => {
    expect(ids()).toHaveLength(3);
  });

  test("a computed id is not compared with anything", () => {
    expect(ids().some((issue) => issue.id === "email" && issue.tag === "input" && issue.line > 140)).toBe(false);
  });

  /**
   * Two components are two renders. They may never be on the page together, and even if they are,
   * saying so would need the composed tree — which this package does not build, because building
   * it means guessing at props, state and slots.
   */
  test("two separate renders are never compared", () => {
    expect(ids().some((issue) => issue.id === "panel")).toBe(false);
  });
});

describe("a heading that skips a level", () => {
  test("every skip is reported, with the level it came after", () => {
    expect(headings().map((issue) => `h${issue.after} → h${issue.level}`)).toEqual([
      "h1 → h3",
      "h2 → h5",
      "h1 → h4",
      "h1 → h3",
    ]);
  });

  /** Markup written in a plain helper is markup all the same — the third report above is one. */
  test("a render outside a class is read too", () => {
    expect(headings()).toHaveLength(4);
  });

  /**
   * Both elements on ONE line, which is where the wording had to change: written only as
   * "line N", the report sent a reader to the line they were already looking at. Invisible from
   * the finding, which is correct either way — it only showed in what the command printed.
   */
  test("two on one line are described as being on it, not by its number", () => {
    const same = headings().find((issue) => issue.afterAtLine === issue.line);
    expect(same).toBeDefined();
    expect(ids().find((issue) => issue.firstAtLine === issue.line)).toBeDefined();
  });

  test("descending one step at a time is not a skip", () => {
    expect(headings().some((issue) => issue.afterAtLine > 0 && issue.level - issue.after < 2)).toBe(false);
  });

  /**
   * `h3` then `h2` is one section ending and another beginning. A rule that called that a fault
   * would report every well-structured page there is.
   */
  test("going back up a level is not a skip", () => {
    expect(headings().some((issue) => issue.level < issue.after)).toBe(false);
  });

  /**
   * The heading between them may not be there, so the one after it may be no skip at all — and
   * reporting it would send a reader to delete the level that makes the page correct.
   */
  test("a heading behind a condition breaks the chain rather than being assumed", () => {
    expect(headings().some((issue) => issue.after === 1 && issue.level === 3 && issue.afterAtLine > 100)).toBe(false);
  });

  test("the report carries a position a reader can open", () => {
    const first = headings()[0];
    expect(first.file).toContain("render-tree");
    expect(first.line).toBeGreaterThan(0);
    expect(first.column).toBeGreaterThan(0);
  });
});
