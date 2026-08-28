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
    expect(found.map((issue) => `${issue.kind}:${issue.tag}`)).toEqual(["heading:h2", "link:a", "link:a"]);
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

  /**
   * A wrong CASE is a fault only inside SVG, and that was measured rather than argued.
   *
   * This rule shipped saying the opposite — that `aria-labelledBy` reaches the DOM as a different
   * attribute. Rendered through `renderToString`, an HTML element's attributes go through
   * `setAttribute`, which the specification lowercases, so it arrives spelled correctly and works;
   * an SVG element's go through `setAttributeNS(null, name)`, which does not. Reporting the HTML
   * one was reporting correct markup.
   *
   * The fixture holds both spellings of the same name, one in each namespace, so this cannot pass
   * by finding the wrong one.
   */
  test("a wrong case is reported in SVG and nowhere else", () => {
    const cased = run().findings["unknown-aria-attribute"].filter((issue) => issue.attribute === "aria-labelledBy");
    expect(cased).toHaveLength(1);
    expect(cased[0].line).toBeGreaterThan(20);
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
/**
 * The shapes these rules had an opinion about and did not recognise, each planted and measured.
 *
 * None of them is exotic: a bare JSX boolean, an icon-only link, an index key on a component row.
 * Each was silent before, and each has its opposite beside it in the fixture — the shape that must
 * stay silent is what says the rule got sharper rather than louder.
 */
describe("the shapes an element rule has to recognise", () => {
  /**
   * `aria-hidden`, `aria-hidden={true}` and `aria-hidden="true"` are one fact spelled three ways,
   * and the framework renders all three the same. Reading only the string missed the two shorter
   * ones — `<button aria-hidden>` hides a focusable button and was reported by nothing.
   */
  test("a bare `aria-hidden` and a `{true}` are the same claim as the string", () => {
    const found = run().findings["aria-hidden-on-focusable"];
    expect(found).toHaveLength(2);
    expect(found.every((issue) => issue.tag === "button")).toBe(true);
  });

  /** `aria-hidden="false"` is not a claim, and a rule that read it as one would report the fix. */
  test("a false is not a claim, whatever else is on the element", () => {
    const found = run().findings["aria-hidden-on-focusable"];
    expect(found.some((issue) => issue.because === "tabIndex")).toBe(false);
  });

  /**
   * A link whose only child is `aria-hidden="true"` is full in the DOM and blank in the tree a
   * screen reader reads — the icon-only link, which is the commonest way to write this fault.
   */
  test("a link whose only content is hidden is empty where it counts", () => {
    const found = run().findings["empty-heading-or-link"];
    expect(found.filter((issue) => issue.kind === "link")).toHaveLength(2);
  });

  /**
   * The two silences that keep it provable: one readable word beside the icon, and a COMPONENT
   * child whose markup is somewhere else.
   */
  test("an icon beside text, and a component child, both stay silent", () => {
    // Three links in the plant and one report: the icon-only one. Counting is what says so —
    // a line number would say it too and would move with the fixture.
    const links = run().findings["empty-heading-or-link"].filter((issue) => issue.kind === "link");
    expect(links).toHaveLength(2);
  });

  /**
   * A COMPONENT row is asked for a real key too. `row-without-a-key` already asks one, for the
   * reason that decides both: a component is what HOLDS the state that lands on the wrong row.
   */
  test("an index key on a component row is reported", () => {
    const found = run().findings["index-as-key"];
    expect(found.map((issue) => issue.tag)).toContain("Icon");
  });
});

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
      "mark/mark: aria-label",
    ]);
  });

  /**
   * `<time>` was on this table and should never have been: it is named from AUTHOR in both
   * machine-readable transcriptions of the spec, and giving a machine date a human name is the
   * documented use of the element. A wrong entry in a table read to REPORT is a report on correct
   * markup — found by comparing the table against `aria-query` and `dom-accessibility-api` rather
   * than by reading it again.
   */
  test("a time with a name is not reported, and a mark still is", () => {
    const tags = found().map((issue) => issue.tag);
    expect(tags).not.toContain("time");
    expect(tags).toContain("mark");
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
   * Attribute names are matched case-INSENSITIVELY, and that was measured rather than assumed.
   *
   * The first version compared them as written, on the neighbouring rule's claim that
   * `aria-labelledBy` reaches the DOM as a different attribute. Rendered through
   * `renderToString`, that is false for an HTML element — `setAttribute` lowercases, so the
   * attribute arrives as `aria-labelledby` and is a name like any other. It IS true inside SVG,
   * where `setAttributeNS(null, name)` writes the name verbatim; every tag this rule consults is
   * an HTML tag, so that case cannot reach it.
   *
   * `aria.tsx` therefore carries a `role` on its wrong-case span, so that line stays about one
   * fault.
   */
  test("this rule reads only names, and leaves the vocabulary to its own rule", () => {
    expect(found().some((issue) => issue.file.endsWith("aria.tsx"))).toBe(false);
  });

  test("it says whether the role was written or came from the tag", () => {
    expect(found().filter((issue) => issue.from === "role")).toHaveLength(2);
    expect(found().filter((issue) => issue.from === "tag")).toHaveLength(6);
  });
});

/**
 * What a spread can and cannot take away.
 *
 * The family goes quiet on a spreading element because a spread may CARRY the attribute a rule
 * misses — `<img {...rest} />` may well have its `alt`, and nothing here can say whether it does.
 * That argument is about an attribute that is ABSENT. It does not transfer to one plainly written
 * down: a spread can overwrite a value and it cannot un-write a name.
 *
 * Measured before this was fixed: three rules were silent on the shape they exist for, on a page
 * where the identical line without the spread was reported one line below.
 */
describe("an accessibility fault beside a spread", () => {
  const spread = () => analyzeProject(join(here, "fixtures", "spread-a11y", "tsconfig.json")).findings;
  const lines = (id: string) => (spread()[id] ?? []).map((issue) => issue.line).sort((a, b) => a - b);

  test("a misspelled NAME is reported on either side of a spread", () => {
    // 21 spread first, 22 spread last, 35 the control. A name is a name whichever side it is on.
    expect(lines("unknown-aria-attribute")).toEqual([21, 22, 35]);
  });

  test("an accessibility attribute on a tag with no node is too, because the TAG is the subject", () => {
    // 31, 32, 37 — and no spread makes a `<meta>` into something a screen reader exposes.
    expect(lines("aria-with-no-subject")).toEqual([31, 32, 37]);
  });

  test("a role is reported only from the side a spread cannot reach over", () => {
    /**
     * 25 has the spread FIRST, so `role="buton"` is the last word and wins; 36 is the control.
     * Line 27 writes the spread LAST and is silent — `rest` may carry a role of its own, and this
     * is a rule about a value.
     */
    expect(lines("unknown-role")).toEqual([25, 36]);
  });

  test("and the silence the guard exists for is untouched", () => {
    // `<img {...rest} />` — the `alt` may be in `rest`, and nothing here can say it is not.
    expect(lines("unnamed-image")).toEqual([]);
  });
});

/**
 * The rest of the family, asked the same question.
 *
 * `spread-a11y` settled the principle on three rules. Asked of every other element rule, seven more
 * were silent beside a spread that could not have changed their answer — measured on
 * `fixtures/spread-sweep`, where each fault was written with the spread first, with the spread
 * last, and with no spread at all.
 *
 * The line between them is not name-versus-value. A later spread carrying `undefined` really does
 * remove an attribute — `<span aria-hidden="true" {...{"aria-hidden": undefined}} />` renders
 * `<span></span>`, measured through `renderToString` — so what decides it is what the rule is
 * ABOUT: what the author WROTE, or what the element WILL BE.
 */
describe("the rest of the element family beside a spread", () => {
  const sweep = () => analyzeProject(join(here, "fixtures", "spread-sweep", "tsconfig.json")).findings;
  const lines = (id: string) => (sweep()[id] ?? []).map((issue) => issue.line).sort((a, b) => a - b);

  test("a rule about what was WRITTEN reports on either side of a spread", () => {
    // `class` where `className` was meant: 21 spread first, 22 spread last, 23 the control. The
    // prop the author meant is missing whether or not the attribute survives to the DOM.
    expect(lines("class-instead-of-classname")).toEqual([21, 22, 23]);
  });

  test("and so does a rule whose subject is the TAG, because no spread changes a tag", () => {
    // An `<li>` with no list around it — 31 with a spread, 32 without.
    expect(lines("tag-needs-its-parent")).toEqual([31, 32]);
  });

  /**
   * The other five, one at a time, so a regression names the rule rather than moving a number.
   *
   * Each is a claim about the element that RENDERS, and each is written three times in the
   * fixture: spread first (reported, the attribute has the last word), spread last (silent, the
   * spread may replace or remove it), and no spread (reported).
   */
  test("a rule about what the element WILL BE reports only from the side a spread cannot reach", () => {
    expect(lines("positive-tabindex")).toEqual([26, 28]);
    expect(lines("aria-value")).toEqual([35, 37]);
    expect(lines("access-key")).toEqual([40, 42]);
    expect(lines("aria-hidden-on-focusable")).toEqual([45, 47]);
    // Two attributes decide this one, and each is asked about its own position.
    expect(lines("role-takes-no-name")).toEqual([50, 52]);
  });

  test("and the silence the family guard exists for is untouched", () => {
    expect(lines("unnamed-image")).toEqual([]);
  });
});

/**
 * The BUTTON, which was in the gap between two rules.
 *
 * `control-with-no-label` skips `<button>` on purpose and says so: a button is named by what is
 * inside it, so asking it for a `<label>` would be asking for the wrong thing.
 * `empty-heading-or-link` covered the two tags that carry text and not the third. Measured on a
 * plant: `<button onclick={close} />` was reported by nothing, while the `<a href="/x" />` beside it
 * was reported.
 *
 * That is the icon button — the ✕ that closes a dialog, the pencil that edits a row — and it is
 * written more often than an empty link and an empty heading together. A screen reader announces it
 * as "button" and nothing else, with no way to find out what it does short of pressing it.
 */
describe("a button with nothing to announce", () => {
  const said = () =>
    (
      analyzeProject(join(here, "fixtures", "empty-button", "tsconfig.json")).findings["empty-heading-or-link"] ?? []
    ).map((issue) => `${issue.line}:${issue.kind}`);

  test("nothing inside, and the icon button whose only child is hidden", () => {
    // 17 is empty; 20 has content in the DOM and none where it counts, which is how this is
    // actually written.
    expect(said()).toEqual(["17:button", "20:button"]);
  });

  /**
   * Six silences, and the last is a boundary rather than a limitation.
   *
   * 25 and 50 name it outright. 30 has text and 35 has one readable word beside the icon, which is
   * enough. 40 holds an expression and 45 a COMPONENT, and guessing at either is how a rule reports
   * a page that is correct.
   *
   * 54 and 55 are `<input type="submit">` and `type="button"` — named by their `value` and by a
   * browser default, so an unlabelled submit reads as "Submit" rather than as nothing. That is
   * `control-with-no-label`'s territory and its documented boundary, and only the `<button>`
   * ELEMENT is named by its content.
   */
  test("every button that has a name, or might, stays silent", () => {
    const lines = said().map((entry) => Number(entry.split(":")[0]));
    for (const quiet of [25, 30, 35, 40, 45, 50, 54, 55]) {
      expect(lines, `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });
});

/**
 * `role="img"` is an image whatever the tag under it is, and was in a gap.
 *
 * An `<svg role="img">` or a `<div role="img">` is announced as an image and has no `alt` to fall
 * back on — the attribute does not exist on those tags — so `aria-label` is the ONLY way to name
 * one. Measured on a sweep: both were reported by nothing, while the `<object>` and `<area>` beside
 * them were reported by this same rule.
 *
 * It is how an inline icon is written whenever the icon MEANS something rather than decorating,
 * which is exactly when it needs a name.
 */
describe("an image declared by its role", () => {
  const said = () =>
    (analyzeProject(join(here, "fixtures", "declared-image", "tsconfig.json")).findings["unnamed-image"] ?? []).map(
      (issue) => `${issue.line}:${issue.tag}`,
    );

  test("a declared image with no name, on any tag", () => {
    // 31 is the tag-based half, unchanged: `<img>` with no `alt`.
    expect(said()).toEqual(["10:svg", "13:div", "31:img"]);
  });

  test("every way of naming one answers, and a decorative icon is not one", () => {
    /**
     * 16, 17 and 18 use the three naming attributes. 21 is a name this cannot READ, which is
     * somebody naming it. 24 says `aria-hidden`, so it is not in the tree at all. 27 is an `<svg>`
     * with no role, which is not declared to be anything — the rule asks what the source SAYS the
     * element is, and answers nothing where it says nothing. 30 has an `alt`.
     */
    const lines = said().map((entry) => Number(entry.split(":")[0]));
    for (const quiet of [16, 17, 18, 21, 24, 27, 30]) {
      expect(lines, `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });
});
