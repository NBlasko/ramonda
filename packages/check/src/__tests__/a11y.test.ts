import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "a11y", "tsconfig.json"));

/** Every rule this fixture is written to trip, so "none of them fails the run" cannot go stale. */
const RULE_IDS = [
  "unnamed-image",
  "unknown-aria-attribute",
  "unknown-role",
  "aria-with-no-subject",
  "empty-heading-or-link",
  "unnamed-frame",
  "positive-tabindex",
] as const;

/**
 * The rules that read one JSX ELEMENT — the third family, and the one accessibility needs.
 *
 * They are asserted against one fixture that writes every shape they have an opinion about beside
 * every shape they must not, because that pairing is the whole test: a rule that reports the
 * missing `alt` and also reports `alt=""` has not found a fault, it has found images.
 */
describe("accessibility rules over JSX elements", () => {
  test("an image with nothing to announce it is reported, and a described one is not", () => {
    const found = run().findings["unnamed-image"];
    // `img`, the image `input`, the empty `object`, and `area`. Everything else in the fixture
    // answers the question one way or another.
    expect(found.map((issue) => issue.tag)).toEqual(["img", "input", "object", "area"]);
  });

  /**
   * The silence contract, which for this family is one flag rather than forty checks.
   *
   * `<img {...rest} />` may carry the `alt` — nothing static can say whether it does — so a
   * spreading element is handed to no rule at all. Asserted here rather than trusted, because it
   * is the difference between a checker people run and one they switch off.
   */
  test("an element that spreads props is left alone", () => {
    // The fixture writes SEVEN `img` tags and exactly one of them is reported. A leaked spread
    // would make it two, which is what counting says and a line number would not.
    const found = run().findings["unnamed-image"];
    expect(found.filter((issue) => issue.tag === "img")).toHaveLength(1);
  });

  test("an empty heading and an empty link are reported, and a named one is not", () => {
    const found = run().findings["empty-heading-or-link"];
    expect(found.map((issue) => `${issue.kind}:${issue.tag}`)).toEqual(["heading:h2", "link:a"]);
  });

  /**
   * `<h4>{title}</h4>` might well have text, and nothing here can prove it does not. Reporting it
   * would be reporting the commonest correct line in any app.
   */
  test("content this cannot read is not called empty", () => {
    const found = run().findings["empty-heading-or-link"];
    expect(found.some((issue) => issue.tag === "h4")).toBe(false);
  });

  test("a frame with no name is reported", () => {
    expect(run().findings["unnamed-frame"]).toHaveLength(1);
  });

  test("only a POSITIVE tabIndex is reported", () => {
    const found = run().findings["positive-tabindex"];
    expect(found.map((issue) => issue.value)).toEqual([1]);
  });

  /**
   * None of them fails a build yet — the repository's rule for a new rule, and the README's
   * argument: one version that says so, the next that refuses.
   */
  test("none of them fails the run", () => {
    const result = run();
    for (const id of RULE_IDS) expect(result.findings[id].length, id).toBeGreaterThan(0);
    expect(result.issues).toEqual([]);
  });
});

/**
 * The ARIA vocabulary rules, which are the ones with a table behind them.
 *
 * The table can only be wrong in one direction that matters: short by a name, it reports correct
 * markup. That is why these tests assert what is NOT reported at least as carefully as what is.
 */
describe("the ARIA vocabulary", () => {
  test("an attribute the specification does not have is reported", () => {
    const found = run().findings["unknown-aria-attribute"];
    expect(found.map((issue) => issue.attribute)).toEqual(["aria-labelledBy", "aria-requred", "aria-sparkle"]);
  });

  /**
   * The case fault is the one worth naming, because it is invisible: `aria-labelledBy` looks right
   * and is a different attribute. Saying which one was meant is what turns a report into a fix.
   */
  test("it says which attribute was meant, when that is certain", () => {
    const found = run().findings["unknown-aria-attribute"];
    expect(found.map((issue) => issue.meant)).toEqual(["aria-labelledby", "aria-required", undefined]);
  });

  test("an unknown role and an abstract one are told apart", () => {
    const found = run().findings["unknown-role"];
    expect(found.map((issue) => `${issue.role}:${issue.kind}`)).toEqual(["tabpane:unknown", "widget:abstract"]);
  });

  /**
   * A fallback chain of real roles, and a role written as an expression. Reporting either would be
   * reporting correct code — the first because the spec allows a list, the second because nothing
   * here can read it.
   */
  test("a real role, a chain of them, and one it cannot read are all left alone", () => {
    expect(run().findings["unknown-role"]).toHaveLength(2);
  });

  test("role and aria-* on an element with no accessibility node are reported, one per attribute", () => {
    const found = run().findings["aria-with-no-subject"];
    expect(found.map((issue) => `${issue.tag}:${issue.attribute}`)).toEqual(["title:role", "title:aria-hidden"]);
  });
});

/**
 * The value half of the ARIA vocabulary. The names in these are all correct — the sibling rule has
 * nothing to say about them — and the browser keeps every one, because an attribute is a string. It
 * is the MEANING that does not happen: `aria-hidden="yes"` leaves the element in the accessibility
 * tree, and it looks exactly like an element that was hidden.
 */
describe("an aria value the specification does not permit", () => {
  const found = () => run().findings["aria-value"];

  test("every kind of wrong value is reported, with what it takes", () => {
    expect(found().map((issue) => `${issue.attribute}="${issue.value}" wants ${issue.wants}`)).toEqual([
      'aria-hidden="yes" wants `true`, `false` or `undefined`',
      'aria-atomic="1" wants `true` or `false`',
      'aria-selected="mixed" wants `true`, `false` or `undefined`',
      'aria-live="loud" wants one of `assertive`, `off`, `polite`',
      'aria-current="yes" wants one of `date`, `false`, `location`, `page`, `step`, `time`, `true`',
      'aria-level="two" wants a whole number',
      'aria-valuenow="40%" wants a number',
    ]);
  });

  /**
   * `false` is a value, not an absence — `aria-hidden="false"` says the element is exposed, which
   * is not what leaving the attribute off says. A rule that reported it would be reporting the
   * documented way to write the thing.
   */
  test("false, undefined and mixed are values where the spec allows them", () => {
    const permitted = ['aria-hidden="false"', 'aria-expanded="undefined"', 'aria-checked="mixed"'];
    expect(found().some((issue) => permitted.includes(`${issue.attribute}="${issue.value}"`))).toBe(false);
  });

  test("a negative integer and a decimal are still a number", () => {
    expect(found().some((issue) => ["-1", "0.5", "1e3"].includes(issue.value))).toBe(false);
  });

  /** An expression is not a value this can read, and guessing at one is what the package refuses. */
  test("an expression is not judged", () => {
    expect(found().every((issue) => issue.value.length > 0)).toBe(true);
  });

  /**
   * A label takes any string and an id reference is any non-empty name, so there is no table for
   * either — an attribute with no entry is one no rule has an opinion about.
   */
  test("an attribute whose every value is well formed has no entry and is never reported", () => {
    expect(found().some((issue) => issue.attribute === "aria-label" || issue.attribute === "aria-labelledby")).toBe(
      false,
    );
  });

  test("a component's prop is not markup yet", () => {
    expect(found().every((issue) => issue.line < 40)).toBe(true);
  });
});
