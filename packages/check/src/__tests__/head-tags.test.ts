import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "head-tags", "tsconfig.json"));
const found = () => run().findings["head-tags-collide"];

/**
 * `Head` keys the tags it writes by their identity — a `<meta>` by `name`, `property` or
 * `http-equiv`, a `<link>` by `rel` and `href` — and collects them into a Map. Two entries with the
 * same identity are therefore ONE tag: the later silently replaces the earlier, and the page is
 * served missing something the source clearly asks for.
 *
 * Nothing else says so. The type permits it, `tsc` reports nothing — measured — and there is no
 * runtime diagnostic, because by the time the map is built the losing tag has left no trace. This
 * rule is the only thing that can see it.
 */
describe("two head tags that are one tag", () => {
  test("every collision is reported, with the identity that collided", () => {
    expect(found().map((issue) => `${issue.component}: ${issue.identity}`)).toEqual([
      // Source order, and the two that read through a name are written at the top of the fixture.
      'OptionsAName: name="description"',
      'IdentityAName: name="robots"',
      'TwoOfTheSameName: name="robots"',
      'ShorthandAndMeta: name="description"',
      'TwoOfTheSameProperty: property="og:title"',
      'TwoOfTheSameHttpEquiv: http-equiv="content-security-policy"',
      'TwoOfTheSameLink: rel="icon" href="/icon.png"',
      'ThroughAFactory: name="robots"',
    ]);
  });

  /**
   * The options, and the identity, one name away.
   *
   * Page metadata ends up in a module of its own, which is the ordinary arrangement and the one
   * this rule could not read at all: `this.use(Head, PAGE_HEAD)` reached no object literal, so a
   * description written both ways inside it was invisible. A `{ name: ROBOTS }` is the same fact
   * one hop further in.
   *
   * `this.which` stays unreadable, and that is a different case: a field can be written again, so
   * the identity really is not knowable — see `ComputedName`.
   */
  test("options and identities kept in a `const` are read", () => {
    const named = found().filter((issue) => issue.component === "OptionsAName");

    expect(named).toHaveLength(1);
    expect(named[0]?.lost).toBe("the `description` shorthand");
    expect(found().some((issue) => issue.component === "ComputedName")).toBe(false);
  });

  /**
   * The `description` shorthand is collected FIRST and a `meta` list after it, so a description
   * written both ways loses the shorthand — the one that reads like the page's own description.
   * The report has to say which of the two was written where, or a reader deletes the wrong line.
   */
  test("the shorthand is named as a shorthand, not as a meta tag", () => {
    const issue = found().find((each) => each.component === "ShorthandAndMeta");
    expect(issue?.lost).toBe("the `description` shorthand");
  });

  /**
   * It points at the entry that is LOST, and names the line of the one that replaces it. Decided
   * by reading the printed report: the line a reader has to open is the one that does nothing,
   * and the winner is working exactly as written.
   */
  test("it points at the line that never reaches the page, and names the other", () => {
    const issue = found().find((each) => each.component === "TwoOfTheSameName");
    expect(issue?.replacedAtLine).toBe((issue?.line ?? 0) + 1);
  });

  test("different identities are not a collision", () => {
    expect(found().some((issue) => issue.component === "AllDifferent")).toBe(false);
  });

  /**
   * `name="title"` and `property="title"` are two attributes that happen to spell the same word.
   * The document holds both, and a rule that matched on the VALUE would report correct markup —
   * which is how a rule earns being switched off.
   */
  test("the same word under two attributes is two tags", () => {
    expect(found().some((issue) => issue.component === "SameWordDifferentAttribute")).toBe(false);
  });

  /**
   * The exception that keeps the rule honest. Two byte-identical tags collapse to the one they
   * both describe, so nothing is lost — that is redundancy, not a fault, and reporting it would
   * put the rule in the business of tidying rather than of finding bugs.
   */
  test("a tag written twice, identically, loses nothing and is not reported", () => {
    expect(found().some((issue) => issue.component === "IdenticalTwice")).toBe(false);
  });

  test("an identity this cannot read is not judged", () => {
    expect(found().some((issue) => issue.component === "ComputedName")).toBe(false);
  });

  /** A spread may carry the very attribute that decides the identity — the silence contract. */
  test("a spread inside the tag silences it", () => {
    expect(found().some((issue) => issue.component === "SpreadInTheTag")).toBe(false);
  });

  test("a list this cannot see into is not judged", () => {
    expect(found().some((issue) => issue.component === "ListFromAVariable")).toBe(false);
  });

  /**
   * Identity is the import, not the name. An app is entitled to its own `Head`, and reporting
   * inside it would be reporting the reader's own code for the framework's rule.
   */
  /**
   * Two `Head` hooks are not this rule's subject, and the mechanism is identical — measured against
   * core: the document keeps one `<meta name="robots">` and it carries the LAST value. What differs
   * is the reading. Two entries in one array express nothing by being two; two hooks express an
   * override, which is how a base sets a page's defaults and a subclass replaces one of them.
   */
  test("a collision across two Head hooks is composition, not this", () => {
    expect(found().some((issue) => issue.component === "TwoHeads")).toBe(false);
  });

  test("an app's own Head of the same name is left alone", () => {
    expect(found().some((issue) => issue.component === "OwnHead")).toBe(false);
  });

  test("the report carries a position a reader can open", () => {
    const first = found()[0];
    expect(first.file).toContain("head-tags");
    expect(first.line).toBeGreaterThan(0);
    expect(first.column).toBeGreaterThan(0);
  });
});
