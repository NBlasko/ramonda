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

/**
 * The other half of the ARIA tables: what a role does not work without. Every role in the fixture
 * is real, so the vocabulary rule is satisfied and nothing else has anything to say — the page
 * works for everyone who can see it, and a screen reader announces a control in a state it cannot
 * report.
 */
describe("a role missing what the specification requires of it", () => {
  const found = () => run().findings["role-missing-required-aria"];

  test("every incomplete role is reported, with what it is missing", () => {
    expect(found().map((issue) => `${issue.role} needs ${issue.missing.join(" + ")}`)).toEqual([
      "checkbox needs aria-checked",
      "switch needs aria-checked",
      "menuitemradio needs aria-checked",
      "heading needs aria-level",
      "slider needs aria-valuenow",
      "scrollbar needs aria-controls + aria-valuenow",
      "combobox needs aria-expanded",
    ]);
  });

  /**
   * `has`, not the value: `aria-checked={checked}` IS written, and whether the expression holds
   * something the spec permits is the value rule's question, asked on the same element.
   */
  test("an attribute written as an expression counts as present", () => {
    expect(found().filter((issue) => issue.role === "checkbox")).toHaveLength(1);
  });

  test("a role with nothing required of it is never reported", () => {
    expect(found().some((issue) => issue.role === "button" || issue.role === "note")).toBe(false);
  });

  /**
   * `<input type="checkbox">` carries its checked-ness natively, and `<h2>` its level. Judging a
   * host language's own role would report every correct heading there is.
   */
  test("an element that supplies the state itself is left alone", () => {
    expect(found().some((issue) => issue.tag === "input" || issue.tag === "h2")).toBe(false);
  });

  test("a fallback chain is not one claim", () => {
    expect(found().some((issue) => issue.role.includes(" "))).toBe(false);
  });

  test("a role this cannot read is not judged", () => {
    expect(found().every((issue) => issue.role.length > 0)).toBe(true);
  });

  test("the report carries a position a reader can open", () => {
    const first = found()[0];
    expect(first.file).toContain("roles");
    expect(first.line).toBeGreaterThan(0);
  });
});

/**
 * The slice of the role-by-property matrix worth having. A name is not a tooltip: it is the
 * accessible NAME of a thing in the accessibility tree, and the specification says which roles may
 * have one. A `<div>` is `generic` — the role for an element with no meaning — so there is nothing
 * for a name to name, and the attribute does nothing at all.
 */
describe("a name on a role that takes none", () => {
  const found = () => run().findings["role-takes-no-name"];

  test("every name that does nothing is reported, with the role that forbids it", () => {
    expect(found().map((issue) => `${issue.tag}/${issue.role}: ${issue.attribute}`)).toEqual([
      "div/generic: aria-label",
      "span/generic: aria-labelledby",
      "div/presentation: aria-label",
      "div/none: aria-label",
      "p/paragraph: aria-label",
      "div/generic: aria-label",
      "div/generic: aria-labelledby",
    ]);
  });

  /**
   * A written role wins over the tag's own, which is the whole reason this is safe to report.
   * `<div role="region" aria-label="Filters">` is correct and extremely common.
   */
  test("a written role that takes a name silences the tag's own", () => {
    expect(found().some((issue) => issue.role === "region")).toBe(false);
  });

  /**
   * `<section>` maps to `region` WHEN IT HAS A NAME, so naming it is not merely allowed — it is the
   * documented way to write one. A table that listed `section` would report the correct form.
   */
  test("section, nav and main are named exactly this way and are never reported", () => {
    expect(found().some((issue) => ["section", "nav", "main", "button"].includes(issue.tag))).toBe(false);
  });

  test("a role this cannot read may be one that takes a name", () => {
    expect(found().every((issue) => issue.role !== "")).toBe(true);
  });

  /**
   * `aria-labelledBy` reaches the DOM as a different attribute from `aria-labelledby`, so it is not
   * a name at all — the vocabulary rule has that one, and reporting it here would say the name does
   * nothing for the wrong reason. The wrong-case span lives in `aria.tsx`.
   */
  test("an attribute whose case is wrong is not a name", () => {
    expect(found().some((issue) => issue.file.endsWith("aria.tsx"))).toBe(false);
  });

  test("it says whether the role was written or came from the tag", () => {
    expect(found().filter((issue) => issue.from === "role")).toHaveLength(2);
    expect(found().filter((issue) => issue.from === "tag")).toHaveLength(5);
  });
});
