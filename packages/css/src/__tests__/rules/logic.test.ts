import { type Finding, checkBlock } from "../../compiler/rules";
import { describe, expect, test } from "vitest";
import { findBlocks } from "../../compiler/scan";
import { namedSites } from "../../compiler/references";
import { readBlock } from "../../compiler/read";
import { check, rules } from "./helpers";

describe("a hole where the stylesheet needs text", () => {
  /**
   * The rule that keeps the design honest. A property name, a selector and a frame are TEXT by the
   * time a stylesheet is written, so a hole cannot be one — and a declaration needs a property.
   *
   * The build refuses these outright — there is no correct compilation — so this exists to say it
   * FIRST: in an editor, while it is being typed, rather than at the end of a build.
   */
  test.each([
    ["a property name", "  $(name): 24px;"],
    ["a whole declaration", `  $(cond ? "display:flex" : "");`],
    ["a selector", "  &:$(state) { color: red; }"],
  ])("%s is named", (_what, css) => {
    const [only, ...rest] = check(css);

    expect(rest).toEqual([]);
    expect(only.rule).toBe("hole-out-of-place");
  });

  /**
   * A misplaced hole silences nothing else in the block. A filter here once dropped every
   * `unknown-property` beside one, so `colr` went unreported in the editor until the hole was fixed —
   * and the name with the hole in it never needed the filter: it is not one word, so
   * `unknown-property` passes it by on its own.
   */
  test("a typo elsewhere in the block is still named", () => {
    expect(check("  $(name): 24px;\n  colr: red;").map((one) => one.rule)).toEqual([
      "hole-out-of-place",
      "unknown-property",
    ]);
  });

  /**
   * **The advice has to name a door that is OPEN**, and it did not.
   *
   * It read *a custom property holds a value, so write `property: $(…)` and put the choice inside
   * it* — written when a hole in a declaration compiled to a custom property on the element. A
   * runtime value in a declaration is refused everywhere now, so following that sentence moved
   * somebody from this rule to `hole-not-allowed`. Measured, all three spellings in one run:
   *
   *     @@( $(pick); )           a hole cannot be a whole declaration
   *     @@( color: $(pick); )    hole-not-allowed
   *     @@( color: var($(A)); )  clean
   */
  test("and the advice names what works, not the next refusal", () => {
    const [only] = check(`  $(cond ? "display:flex" : "");`);

    expect(only.message).toContain("@@property");
    expect(only.message).toContain("match");
    expect(only.message).not.toContain("write `property: $(…)`");
  });

  test("and a hole in a value is where a hole at least PARSES, whatever else is said about it", () => {
    // `hole-not-allowed` refuses it; this rule is about the four places it cannot even be read.
    expect(rules("  border-left: 4px solid $(accent);")).toEqual(["hole-not-allowed"]);
  });
});

/**
 * One fault, one report.
 *
 * A missing `;` makes the next declaration part of this one's VALUE, so the words in it are words
 * the property does not accept — and both rules had something true to say about the same mistake.
 * Measured on the shape a person actually writes: `gap: 8px` with no `;` above `padding: 4px 0;`
 * came back as *`gap` does not accept `padding`* AND *`padding` is being read as part of `gap`'s
 * value*. The second is the one that says what to do.
 */
/**
 * A word touching a hole is part of the hole's value.
 *
 * Found by widening the rule to the seventy numeric properties, and it was already there: measured on
 * every property with a keyword row, `gap: $(n)px` reported *`gap` does not accept `px`*. A false
 * report on correct CSS, and no test covered it — `padding: $(n)px` was the case that did, and
 * `padding` was one of the properties the rule was skipping.
 *
 * Whitespace is what separates one value from the next, so a piece with none between it and the hole
 * is the same value written in two parts.
 */
describe("a hole and the text glued to it", () => {
  /** The two rules that fire on a hole without reading a word of it — see the assertion below. */
  const SAYS_NOTHING_ABOUT_WORDS = new Set(["hole-not-allowed"]);

  test.each([
    ["a unit after a hole", `gap: $(n)px;`],
    ["one on a property that takes no keywords", `padding: $(n)px;`],
    ["two holes, one unit", `margin: $(a) $(b)px;`],
    ["a unit in the middle of a shorthand", `border-left: $(w)px solid red;`],
    ["a word before a hole", `grid-template-columns: minmax(0,$(n)fr);`],
  ])("%s says nothing about the WORD", (_what, css) => {
    // The glued piece is not a value of its own, so no rule that reads words may judge it. The hole
    // IS reported, by `hole-not-allowed`, which refuses every runtime value and does not read the word.
    expect(check(css).filter((finding) => !SAYS_NOTHING_ABOUT_WORDS.has(finding.rule))).toEqual([]);
  });

  test.each([
    ["a typo beside a glued unit", `border-left: $(w)px sollid red;`, "sollid"],
    ["a separate word after a hole", `gap: $(n) auto;`, "auto"],
  ])("%s is still caught", (_what, css, word) => {
    expect(
      check(css)
        .map((finding) => finding.message)
        .join(" "),
    ).toContain(word);
  });
});

/**
 * Text glued to a hole is ONE fault, and it is the hole.
 *
 * A runtime value in a declaration is refused, so text written against one has no value to be part
 * of — the fix is the hole's, whatever is beside it. There used to be a second rule here,
 * `glued-hole`, about what the text did to a value that became a custom property; that value is
 * refused now, and the rule fired only beside `hole-not-allowed`, advising a change that landed on
 * the same refusal.
 */
describe("text glued to a hole", () => {
  test.each([
    ["a unit after", `padding-left: $(n)px;`, 1],
    ["inside a shorthand", `border-left: $(w)px solid red;`, 1],
    ["a suffix that is not a unit", `grid-area: $(name)-start;`, 1],
    ["something in front", `color: #$(hex);`, 1],
    ["two holes with nothing between", `margin: $(a)$(b);`, 2],
  ])("%s is the hole, said once per hole", (_what, css, holes) => {
    expect(check(css).map((finding) => finding.rule)).toEqual(Array(holes).fill("hole-not-allowed"));
  });
});

/**
 * A hole standing where `var()` takes a NAME.
 *
 * **Measured in Chromium 151, and it is silent:**
 *
 * ```
 * .a { --name: --accent; --accent: #10b981; background: var(var(--name)); border: 4px solid red }
 *       background -> rgba(0, 0, 0, 0)      the declaration is gone
 *       border     -> 4px rgb(255, 0, 0)    and the one beside it is fine
 * ```
 *
 * `var()` resolves a literal name, not a value that happens to spell one. So a hole there compiles to
 * `var(var(--r-…-0))` and the declaration does nothing at all — one declaration, not the rule, which
 * is what makes it hard to see.
 *
 * **This package already knew, and emitted it anyway.** `references.ts` says so in its own words,
 * and it is the shape an IMPORTED binding produces: `namedSites` reads one file, so
 * `import { accent } from "./theme"` is not a name it can resolve and the reference stays a hole.
 * Measured: `background: var($(accent))` on an imported binding compiled to
 * `background:var(var(--r-rfpVZr3es-0))` with nothing reported.
 *
 * The FALLBACK is a different position and is left alone — `var(--x, $(colour))` is a value where a
 * value belongs, and `var(--unset, var(--hole))` was measured resolving correctly. Only the first
 * argument is a name.
 */
describe("a hole where `var()` takes a name", () => {
  const of = (source: string): Finding[] => checkBlock(readBlock(source, 2, "C.tsx").block);
  const rules = (source: string) => of(source).map((one) => one.rule);

  test("directly inside `var(`", () => {
    expect(rules(`@@(\n  background: var($(accent));\n)`)).toEqual([
      "hole-as-a-custom-property-name",
      "hole-not-allowed",
    ]);
  });

  test("with whitespace between, which changes nothing", () => {
    expect(rules(`@@(\n  background: var(  $(accent) );\n)`)).toEqual([
      "hole-as-a-custom-property-name",
      "hole-not-allowed",
    ]);
  });

  test("and nested in a fallback's own `var(`, which is still a name position", () => {
    expect(rules(`@@(\n  background: var(--brand, var($(accent)));\n)`)).toEqual([
      "hole-as-a-custom-property-name",
      "hole-not-allowed",
    ]);
  });

  test("the squiggle covers the hole the author wrote", () => {
    const source = `@@(\n  background: var($(accent));\n)`;
    const [finding] = of(source);

    expect(source.slice(finding.at, finding.at + finding.length)).toBe("$(accent)");
  });

  test("the message says what `var()` needs", () => {
    expect(of(`@@(\n  background: var($(accent));\n)`)[0].message).toContain("literal name");
  });

  describe("what it must not report", () => {
    test("a hole in the FALLBACK, which is a name position no longer", () => {
      expect(rules(`@@(\n  background: var(--brand, $(fallback));\n)`)).not.toContain("hole-as-a-custom-property-name");
    });

    test("an ordinary hole, which is refused for being a hole and not for standing in a name", () => {
      expect(rules(`@@(\n  background: $(accent);\n)`)).toEqual(["hole-not-allowed"]);
    });

    test("a literal name, which is what `var()` wants", () => {
      expect(rules(`@@(\n  --accent: red;\n  background: var(--accent);\n)`)).toEqual([]);
    });

    /**
     * The legitimate use, and the reason this rule cannot simply refuse every `$( )` after `var(`:
     * a reference to a named site in the SAME file is resolved to text before any rule sees it, so
     * there is no hole left to report. That is the case the whole named-site design exists for.
     */
    test("a reference to a named site in the same file, which resolves to a literal", () => {
      const source =
        `const accent = @@property( syntax: "<color>"; inherits: true; initial-value: #10b981; );\n` +
        `const card = @@( background: var($(accent)); );\n`;
      const references = namedSites(source);
      const sites = findBlocks(source);
      const site = sites[sites.length - 1];
      const read = readBlock(source, site.open, "C.tsx", { resolve: (name) => references.get(name) });

      expect(checkBlock(read.block, { at: site.at, references: references })).toEqual([]);
    });
  });
});
