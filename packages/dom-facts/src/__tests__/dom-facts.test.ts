import { describe, expect, test } from "vitest";
import { BOOLEAN_ATTRIBUTES, keptInAProperty, propertyOnlyNames, svgElements } from "../index";

/**
 * The facts `@ramonda/core` and `@ramonda/check` have to agree on, tested where they live.
 *
 * The package's own note says why it exists: "When the two disagree, the checker is confidently
 * wrong about real markup — which is worse than having no checker." Both consumers exercise the
 * tables through their own rules, and neither asks anything about the package itself.
 *
 * ## What is worth testing here, and what is not
 *
 * Not membership. `expect(BOOLEAN_ATTRIBUTES.has("disabled")).toBe(true)` is a copy of the line
 * above it, and a second list is the fault this package removes — `svgElements` is already pinned
 * to the types in both directions by core's `SvgNamespace.test.tsx`, which is the right place for
 * it, because that is where the disagreement would be.
 *
 * What is worth testing is the SHAPE, and specifically the CASE. Three tables, three conventions,
 * each load-bearing and each failing in silence when broken:
 *
 * - `ABSENT` is keyed by `nodeName`, which HTML gives in UPPER case. A lower-case key never matches,
 *   so the property is never written — and the doc measures exactly that outcome: a served
 *   `<textarea value="hello">` parsing back with `.value` of `""`.
 * - `BOOLEAN_ATTRIBUTES` holds attribute names, which `setAttribute` lower-cases. An upper-case
 *   entry is a lookup that misses.
 * - `svgElements` holds tag names as written, and SVG spells several of them in camelCase —
 *   `foreignObject`, `clipPath`, `linearGradient`. Unlike HTML, an SVG element name is
 *   case-SENSITIVE, so the list must not be folded either way. I assumed the opposite and wrote a
 *   test for it; the test failed with twenty-eight names, which is the correction.
 *
 * None of the three has anything else to catch it: a mis-cased entry is not a type error, and the
 * lookup that misses does nothing rather than throwing.
 */
describe("the case each table is keyed in", () => {
  test("every boolean attribute is lower case, because setAttribute lower-cases the name", () => {
    const wrong = [...BOOLEAN_ATTRIBUTES].filter((name) => name !== name.toLowerCase());
    expect(wrong).toEqual([]);
    // The floor: an empty set would satisfy the line above without asserting anything.
    expect(BOOLEAN_ATTRIBUTES.size).toBeGreaterThan(20);
  });

  /**
   * The SVG list is case-EXACT, which is the opposite of the other two and the reason this test is
   * written as it is.
   *
   * `createElementNS` is case-sensitive: run the list through `toLowerCase()` and `<foreignObject>`
   * becomes an unknown HTML element that looks right in the DOM and never renders as SVG — the
   * silent failure the source describes for eight tags that were once missing entirely.
   *
   * So the camelCase names are asserted to be there in their own spelling, and their folded forms
   * asserted NOT to be. Not the whole list: that is pinned to the types, in both directions, by
   * core's `SvgNamespace.test.tsx`, which is where a disagreement between them would show.
   */
  test("the SVG tags keep the case SVG gives them", () => {
    const camel = [...svgElements].filter((tag) => tag !== tag.toLowerCase());

    expect(camel.length).toBeGreaterThan(10);
    expect(camel).toContain("foreignObject");
    for (const tag of camel) {
      expect(svgElements.has(tag.toLowerCase()), tag).toBe(false);
    }
    expect(svgElements.size).toBeGreaterThan(20);
  });

  /**
   * The property table is the opposite convention, and the one that cost a measurement: it is keyed
   * by `nodeName`, so `INPUT` and not `input`. Asserted through the lookup rather than over the
   * table, because the lookup is what a consumer has.
   */
  test("the property table answers a nodeName and not a tag as written", () => {
    expect(propertyOnlyNames("INPUT")).toBeDefined();
    expect(propertyOnlyNames("input")).toBeUndefined();
  });
});

describe("propertyOnlyNames", () => {
  /**
   * A tag with nothing in a property alone answers `undefined` rather than an empty set, so a
   * caller can tell "no such element here" from "this element, and nothing".
   */
  test("a tag that keeps nothing in a property answers undefined", () => {
    expect(propertyOnlyNames("DIV")).toBeUndefined();
    expect(propertyOnlyNames("")).toBeUndefined();
  });

  /**
   * The names are the PROPERTY's spelling and are matched exactly — the doc measures why: lowering
   * the name before the lookup made `playbackrate={2}` match the table and then write nothing,
   * because `"playbackrate" in video` is false. A silent no-op, in the spelling the types encourage.
   */
  test("a name is matched as the DOM spells it, not folded", () => {
    const video = propertyOnlyNames("VIDEO");
    expect(video).toBeDefined();

    const folded = [...(video ?? [])].filter((name) => name !== name.toLowerCase());
    // At least one of them is camelCase — that is the whole reason the lookup is exact.
    expect(folded.length).toBeGreaterThan(0);
    for (const name of folded) {
      expect(video?.has(name.toLowerCase())).toBe(false);
    }
  });

  /**
   * `<select>` and `<textarea>` are deliberately absent, and the reason is in the source: both tags
   * are refused by the types, and `Select` and `TextArea` consume the value before the element is
   * built, so an entry for either could never run. "A table of facts nothing consults is a table
   * that drifts."
   */
  test("the two tags that would never reach the table are not in it", () => {
    expect(propertyOnlyNames("SELECT")).toBeUndefined();
    expect(propertyOnlyNames("TEXTAREA")).toBeUndefined();
  });
});

describe("keptInAProperty", () => {
  /** One way into the table: the two accessors must never answer differently. */
  test("it agrees with propertyOnlyNames for every entry of every tag", () => {
    let checked = 0;
    for (const tag of ["INPUT", "VIDEO", "AUDIO", "PROGRESS", "DIV"]) {
      const names = propertyOnlyNames(tag);
      for (const name of names ?? []) {
        expect(keptInAProperty(tag, name), `${tag}.${name}`).toBe(true);
        checked += 1;
      }
      expect(keptInAProperty(tag, "notAPropertyOfAnything")).toBe(false);
    }
    expect(checked).toBeGreaterThan(2);
  });

  test("a tag it knows nothing about is false rather than a throw", () => {
    expect(keptInAProperty("DIV", "indeterminate")).toBe(false);
    expect(keptInAProperty("", "")).toBe(false);
  });
});

/**
 * The two families the source says are deliberately NOT boolean attributes, each with its reason
 * written down: `aria-hidden="false"` is valid and means "not hidden", and a `data-*` value is data,
 * where an empty string is not the same as `"true"` to whatever reads it back.
 *
 * Asserted as an absence because that is what the decision is. An `aria-*` added here would make
 * `aria-hidden={false}` remove the attribute, which says the opposite of what the author wrote.
 */
describe("what is deliberately not a boolean attribute", () => {
  test("no aria-* and no data-* is in the set", () => {
    const leaked = [...BOOLEAN_ATTRIBUTES].filter((name) => name.startsWith("aria-") || name.startsWith("data-"));
    expect(leaked).toEqual([]);
  });
});
