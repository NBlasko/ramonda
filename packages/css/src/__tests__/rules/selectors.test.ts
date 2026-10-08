import { type Finding, checkBlock } from "../../compiler/rules";
import { describe, expect, test } from "vitest";
import { readBlock } from "../../compiler/read";
import { check, checkNamed, checkNamedFree, messages, rules } from "./helpers";

/**
 * An at-rule that is not part of an element's rule.
 *
 * ## The fault this exists for
 *
 * A block is one element's rule. `@keyframes`, `@font-face` and `@property` are not that — each names
 * something the whole stylesheet can use — and written inside a block they compile, nest inside the
 * class rule, and **do nothing**. Measured: `@keyframes slide { … }` came out as
 * `.r-…{@keyframes slide{…}}`, which no browser resolves and nothing reports.
 *
 * ## Why a deny-list rather than an allow-list
 *
 * The at-rules that DO nest are a growing set — `@scope` and `@starting-style` are recent additions,
 * and an allow-list would have reported both as faults when they arrived. A deny-list misses a new
 * top-level at-rule in silence, which is the cheaper of the two mistakes: a checker survives a gap
 * and does not survive laying on correct CSS.
 */
describe("an at-rule that belongs in a stylesheet", () => {
  test.each([
    ["@keyframes", `@keyframes slide { from { opacity: 0; } to { opacity: 1; } }`],
    ["@font-face", `@font-face { font-family: Brand; src: url(a.woff2); }`],
    ["@property", `@property --brand { syntax: "<color>"; inherits: false; }`],
    ["@page", `@page { margin: 1cm; }`],
    ["@counter-style", `@counter-style thumbs { system: cyclic; }`],
  ])("%s is reported", (name, css) => {
    const found = check(css).filter((finding) => finding.rule === "at-rule-out-of-place");

    expect(found).toHaveLength(1);
    expect(found[0].message).toContain(name);
  });

  test.each([
    ["@media", `@media (min-width: 40rem) { gap: 16px; }`],
    ["@supports", `@supports (display: grid) { display: grid; }`],
    ["@container", `@container (min-width: 20rem) { gap: 16px; }`],
    ["@layer", `@layer overrides { color: red; }`],
    ["@scope", `@scope (.card) { color: red; }`],
    ["@starting-style", `@starting-style { opacity: 0; }`],
    ["a nested rule that is not an at-rule", `&:hover { color: red; }`],
    ["an ordinary declaration", `animation: slide 1s ease-in-out;`],
  ])("%s is fine", (_what, css) => {
    expect(check(css).filter((finding) => finding.rule === "at-rule-out-of-place")).toEqual([]);
  });

  /** Nested one level down, because a block is a tree and the fault does not care how deep it is. */
  test("and it is found inside a nested rule too", () => {
    const found = check(`&:hover {\n    @keyframes slide { from { opacity: 0; } }\n  }`);

    expect(found.filter((finding) => finding.rule === "at-rule-out-of-place")).toHaveLength(1);
  });
});

describe("inside `@@keyframes`", () => {
  test("`from`, `to` and percentages are frames", () => {
    expect(checkNamed("keyframes", "from { opacity: 0; }\nto { opacity: 1; }")).toEqual([]);
    expect(checkNamed("keyframes", "0% { opacity: 0; }\n50.5% { opacity: 0.5; }\n100% { opacity: 1; }")).toEqual([]);
  });

  test("and a comma-separated list of them is one frame", () => {
    expect(checkNamed("keyframes", "0%, 100% { opacity: 0; }\nfrom, 50% { opacity: 1; }")).toEqual([]);
  });

  test("a word that is not a frame is reported, with the near miss when there is one", () => {
    const found = checkNamed("keyframes", "form { opacity: 0; }");

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("unknown-frame");
    expect(found[0].message).toContain("`from`");
  });

  test("a percentage missing its sign is reported too", () => {
    expect(checkNamed("keyframes", "50 { opacity: 0; }")[0]?.rule).toBe("unknown-frame");
  });

  test("a declaration outside any frame is reported, because the browser drops it", () => {
    const found = checkNamed("keyframes", "opacity: 0;\nfrom { opacity: 1; }");

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("declaration-out-of-place");
  });

  test("but the declarations inside a frame are checked like any others", () => {
    const found = checkNamed("keyframes", "from { border-left: 4px sollid red; }");

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("unknown-value");
  });
});

/**
 * What a percentage frame may be, measured in Chromium rather than reasoned about.
 *
 * The first version of this rule was written from the shape a person types — `50%` — and reported
 * four spellings the browser accepts while passing one it drops:
 *
 * | written | Chromium | the rule, before |
 * |---|---|---|
 * | `.5%` | kept as `0.5%` | reported |
 * | `1e2%` | kept as `100%` | reported |
 * | `+50%` | kept as `50%` | reported |
 * | `150%` | **dropped** | passed |
 *
 * Reporting valid CSS is the failure a checker does not survive, and passing what the browser throws
 * away is the failure this rule exists for. A percentage is a CSS number, and it is in range.
 */
describe("a percentage frame", () => {
  test.each([[".5%"], ["1e2%"], ["+50%"], ["50.0%"], ["0%"], ["100%"]])("%s is a frame", (frame) => {
    expect(checkNamed("keyframes", `${frame} { opacity: 0; }`)).toEqual([]);
  });

  test.each([["150%"], ["-10%"], ["1e3%"]])("%s is not, because the browser drops it", (frame) => {
    expect(checkNamed("keyframes", `${frame} { opacity: 0; }`)[0]?.rule).toBe("unknown-frame");
  });

  test("and one out of range says so, rather than offering a spelling", () => {
    expect(checkNamed("keyframes", "150% { opacity: 0; }")[0]?.message).toContain("0% and 100%");
  });
});

/**
 * A `@media` feature that is nearly one CSS has.
 *
 * **Nothing checked a media condition at all, and the user reported it from their own typing** —
 * `@media (prefers-reduced-motion: rekErrorduce)` compiled, and so did
 * `@media (prefers-reduced-mErrorotion: reduce)`.
 *
 * ## Why the browser cannot be asked, which took three measurements to establish
 *
 * There is no oracle in the CSSOM. Measured in Chromium 151, every one of these survives in
 * `cssRules` with its `conditionText` intact — including the last, which has no colon at all:
 *
 *     @media (min-widht: 40rem)                    kept
 *     @media (prefers-reduced-mErrorotion: reduce) kept
 *     @media (nonsense)                            kept
 *     @media (min-width 40rem)                     kept
 *
 * That is not a browser being lax: an unknown feature is `<general-enclosed>` in the grammar, which
 * is **legal CSS that never matches**. So a typo here is not invalid — it is a block that silently
 * never applies, which is the worse fault and the reason to report it.
 *
 * `mdn-data` cannot supply the names either: `@media` has no `descriptors`, and its grammar bottoms
 * out at `mf-name: <ident>`. The table is written down, and a browser test verifies it — see
 * `apps/playground-core/browser`, where `(f)` and `not (f)` are both false for a name Chromium does
 * not know, which IS an oracle even though the CSSOM is not.
 *
 * ## So: a near miss, and silence otherwise
 *
 * A feature invented after this was written must not be reported, because it is valid and the table
 * is a snapshot. Same shape as `unknown-property`, same `nearest()` bound as the units.
 */
describe("a `@media` feature that is nearly a real one", () => {
  const of = (condition: string): Finding[] =>
    checkBlock(readBlock(`@@(\n  ${condition} {\n    color: red;\n  }\n)`, 2, "C.tsx").block);
  const rules = (condition: string) => of(condition).map((one) => one.rule);

  test("a misspelled feature name", () => {
    expect(rules("@media (prefers-reduced-mErrorotion: reduce)")).toEqual(["unknown-media-feature"]);
  });

  test("the message names what was meant", () => {
    expect(of("@media (min-widht: 40rem)")[0].message).toContain("min-width");
  });

  test("the squiggle covers the feature name", () => {
    const condition = "@media (min-widht: 40rem)";
    const source = `@@(\n  ${condition} {\n    color: red;\n  }\n)`;
    const [finding] = checkBlock(readBlock(source, 2, "C.tsx").block);

    expect(source.slice(finding.at, finding.at + finding.length)).toBe("min-widht");
  });

  test("a boolean feature written without a value", () => {
    expect(rules("@media (hoverr)")).toEqual(["unknown-media-feature"]);
  });

  test("one inside a longer condition", () => {
    expect(rules("@media screen and (min-widht: 40rem)")).toEqual(["unknown-media-feature"]);
  });

  describe("what it must not report", () => {
    test.each([
      ["a real feature with a value", "@media (min-width: 40rem)"],
      ["a real boolean feature", "@media (hover)"],
      ["a range syntax", "@media (width >= 40rem)"],
      ["a media type with no feature", "@media screen"],
      ["a type and a feature", "@media screen and (prefers-reduced-motion: reduce)"],
      ["`not`", "@media not all and (monochrome)"],
      ["a prefixed feature, which is a browser's own", "@media (-webkit-min-device-pixel-ratio: 2)"],
      ["a name unlike anything known, which may simply be new", "@media (quantum-entanglement: high)"],
      [
        "a longer relative of a real feature, which is how a new one arrives",
        "@media (prefers-reduced-motion-strength: 2)",
      ],
      ["and a real feature that is nearly another one", "@media (prefers-reduced-data: reduce)"],
      ["`@supports`, which is a different grammar", "@supports (display: grid)"],
      ["`@container`, whose features are its own", "@container (min-width: 20rem)"],
      ["a plain selector", "&:hover"],
    ])("%s", (_what, condition) => {
      expect(rules(condition)).toEqual([]);
    });
  });
});

/**
 * `@layer` INSIDE a block, which looks like a cascade control and is not one.
 *
 * The stylesheet is already one layer. Everything this compiler emits is wrapped in
 * `@layer ramonda { … }`, so it sits beneath an author's own unlayered CSS whatever order the files
 * load in — that is the whole reason the wrapper exists.
 *
 * A `@layer a` written inside a block therefore makes a SUBLAYER, `ramonda.a`. Measured:
 *
 *     @layer ramonda {
 *     @layer a { .r-…-c-red  { color:red; } }
 *     @layer b { .r-…-c-blue { color:blue; } }
 *     }
 *
 * And whether `ramonda.a` beats `ramonda.b` is decided by which of them the sheet writes FIRST,
 * because that is how CSS orders layers it was not given an explicit order for. The sheet writes
 * per file, in each file's own source order — so the answer is a property of the build, not of
 * anything the author wrote. They get a lever whose other end is not in their hands.
 *
 * Refused rather than sorted or renamed. There is no spelling of it that means what it looks like.
 */
/**
 * The ROOT as a descendant of the element. Everything in a block is nested in the element's rule, so
 * `:root { … }` there is `.r-… :root` — the root under the element, which nothing is. It compiles and
 * applies nowhere. Where the element sits UNDER the root — `:root.dark & { … }`, how a theme is
 * written — or IS the root, `&:root` on `<html>`, it does apply, and stays silent.
 */
describe("the root inside a block", () => {
  test.each([
    ["`:root` alone", "  :root { --accent: red; }"],
    ["`html` alone", "  html { color: red; }"],
    ["after the element", "  & :root { color: red; }"],
    ["further down", "  & .a > html { color: red; }"],
    ["with a class of its own", "  :root.dark { color: red; }"],
    ["in one part of a list", "  .a, :root { color: red; }"],
    ["inside a condition", "  @media print { :root { color: red; } }"],
    ["inside a state", "  &:hover { :root { color: red; } }"],
  ])("%s is refused", (_what, css) => {
    expect(rules(css)).toEqual(["root-in-a-block"]);
  });

  test.each([
    ["the element under the root", "  :root.dark & { color: red; }"],
    ["the element under `html`", "  html[data-theme=dark] & { color: red; }"],
    ["the element that is the root", "  &:root { color: red; }"],
    ["`:root` only inside a function", "  &:not(:root) { color: red; }"],
    ["a name that only starts the same", "  & htmlish { color: red; }"],
    // A comma inside a function or a quote does not end a selector — found by a review.
    ["`:root` as one choice of `:is`", "  &:is(.a, :root) { color: red; }"],
    ["`:root` inside an attribute's quoted value", '  & [data-x="a, :root"] { color: red; }'],
  ])("%s is silent", (_what, css) => {
    expect(rules(css)).not.toContain("root-in-a-block");
  });

  test("the message says where it goes instead", () => {
    const [message] = messages("  :root { --accent: red; }");

    expect(message).toContain("stylesheet");
    expect(message).toContain("ramonda.css.ts");
  });
});

describe("`@layer` inside a block", () => {
  test("is refused", () => {
    expect(rules("  @layer a { color: red; }")).toEqual(["layer-in-a-block"]);
  });

  test("and the message says why, not just that", () => {
    const [only] = messages("  @layer a { color: red; }");

    expect(only).toContain("already emitted inside");
    expect(only).toContain("order");
  });

  test.each([
    ["nested in a condition", "  @media print {\n    @layer a { color: red; }\n  }"],
    ["nested in a selector", "  &:hover {\n    @layer a { color: red; }\n  }"],
    ["nested inside another layer", "  @layer a {\n    @layer b { color: red; }\n  }"],
    ["with no name", "  @layer { color: red; }"],
  ])("%s is refused too", (_what, css) => {
    expect(rules(css)).toContain("layer-in-a-block");
  });

  test.each([
    ["@media", "  @media print { color: red; }"],
    ["@supports", "  @supports (display: grid) { color: red; }"],
    ["@container", "  @container (width > 40rem) { color: red; }"],
    ["@scope, which works on its own", "  @scope (.p) { color: red; }"],
  ])("%s is fine", (_what, css) => {
    expect(rules(css)).toEqual([]);
  });
});

/**
 * **A PSEUDO-CLASS THAT DOES NOT EXIST, and it drops the whole rule.**
 *
 * The shape this repository keeps finding: `SELECTORS` holds 129 pseudo-classes and pseudo-elements
 * with their groups and their MDN links, `normalise.ts` reads it to canonicalise a prelude,
 * `plugin.ts` reads it to hover one — and **no rule read it at all**. So `&:displaydd { … }` was
 * silent, on a package whose whole claim is that a block is checked.
 *
 * Measured in Chromium, inserting a rule with two declarations and reading `cssRules` back: a
 * pseudo-class the browser does not know keeps **zero rules**. `{"kept":0,"decls":0}`. Not one
 * dropped declaration — every declaration beside it goes, and the element is left on what it
 * inherited.
 *
 * ## Why the table is the oracle and the browser is not
 *
 * The three generated tables beside this one ask the ENGINES, because `mdn-data` was measured short
 * three times. This one must not, and the same probe says why: **Chromium refuses 33 of the 129**.
 * `:left`, `:right` and `:first` are paged-media; `::-ms-*` and `::-moz-*` belong to other engines;
 * `:buffering`, `:playing` and `:seeking` are media ones it has not shipped. Every one is real CSS
 * somewhere, and a rule that asked this browser would refuse valid CSS.
 *
 * Measured the other way too, which is the direction that matters: **0 of the 129 are reported.**
 */
describe("a pseudo-class that does not exist", () => {
  const found = (prelude: string) =>
    checkNamedFree(`${prelude} { color: red; }`).filter((one) => one.rule === "unknown-selector");

  test.each([
    ["the TODO's own case", "&:displaydd", ":display"],
    ["a pseudo-element", "&::beforr", "::before"],
    ["a functional one, by its name", "&:nth-chidl(2)", ":nth-child"],
    ["one letter out", "&:hovr", ":hover"],
  ])("%s is reported: %s", (_what, prelude, meant) => {
    const [only, ...rest] = found(prelude);

    expect(rest).toEqual([]);
    expect(only.message).toContain(meant);
    expect(only.message).toContain("the whole rule");
  });

  test.each([
    ["a plain one", "&:hover"],
    ["a pseudo-element", "&::before"],
    ["a functional one, argument and all", "&:nth-child(2n+1)"],
    ["a functional one with a selector inside", "&:not(.a)"],
    ["a descendant class, which is not a pseudo at all", "& .title"],
    ["an attribute selector", '&[data-theme="dark"]'],
    ["a vendor pseudo-element, whose name is a browser's own", "&::-webkit-anything"],
  ])("%s is left alone", (_what, prelude) => {
    expect(found(prelude)).toEqual([]);
  });

  /**
   * The ARGUMENT of a functional one is deliberately not read: `:nth-child(2n+1)`, `:not(.a)` and
   * `:has(> img)` each have a grammar of their own, and a wrong argument is a different fault from a
   * misspelled name. Only the name is checked.
   */
  test("a wrong argument is not this rule's business", () => {
    expect(found("&:nth-child(banana)")).toEqual([]);
  });

  /** An at-rule prelude is `unknown-at-rule`'s, and the two must not both fire. */
  test("an at-rule prelude is left to its own rule", () => {
    expect(found("@medai (min-width: 40rem)")).toEqual([]);
  });

  /**
   * **The scan is a linear walk, and it was a regex until CodeQL measured it.**
   *
   * The first version matched `::?[a-z-]+(?:\([^)]*\))?` with `matchAll`. CodeQL flagged it as a
   * polynomial regular expression on uncontrolled data and named the input: a string of `:-(`.
   * Measured, and it is real — the optional group opens a paren, `[^)]*` runs to the end of the
   * string looking for a `)` that is not there, and backtracks, once per starting position:
   *
   *      500 repeats   1.3 ms
   *     1000 repeats   4.5 ms
   *     2000 repeats  17.7 ms
   *     4000 repeats  68.1 ms      — double the input, quadruple the time
   *
   * Not an attack: the input is the author's own stylesheet. But a prelude with many parens is not
   * exotic — `:not(:is(:has(…)))` is ordinary CSS — and a cliff in a checker an editor runs on every
   * keystroke is worth removing. The walk that replaced it visits each character a bounded number of
   * times: 8000 repeats measure 1.2 ms, sixteen times the input of the 68 ms row.
   *
   * **No duration is asserted here**, per `vitest.timeout.mjs`: a test that asserts a time measures
   * whatever else the machine was doing. What the rows below hold is the BEHAVIOUR the rewrite had
   * to keep, which is the part that would break silently.
   */
  test.each([
    ["a URL in an attribute value, whose `://` is not a pseudo", '&[href^="https://x.dev"]'],
    ["a lone colon", "&:"],
    ["two lone colons", "&::"],
    ["a selector list, both halves real", "a:hover, b:focus"],
    ["a name inside a functional one", "&:has(:hover)"],
    ["a TYPO inside a functional one, which is the argument's business", "&:is(:hovr)"],
  ])("%s says nothing", (_what, prelude) => {
    expect(found(prelude)).toEqual([]);
  });

  test("two pseudos on one selector are read separately", () => {
    const [only, ...rest] = found("&:hover::beforr");

    expect(rest).toEqual([]);
    expect(only.message).toContain("::beforr");
  });

  /** The shape CodeQL named. What is asserted is that it terminates and says nothing, not how fast. */
  test("a prelude of many unclosed parens terminates", () => {
    expect(found(`&${":-(".repeat(4000)}`)).toEqual([]);
  });

  /**
   * **The four CSS2 pseudo-elements written with ONE colon, which this rule got wrong first time.**
   *
   * `SELECTORS` holds them only as `::before` and their kind, so the first version of this reported
   * `&:before` as a name CSS does not have — refusing valid CSS, which is the one failure this
   * package may not have. Every browser still accepts them, and the gate caught it on
   * `non-canonical-spelling`'s own test.
   *
   * They are not silent, they belong to the OTHER rule, which says to write `&::before` — the more
   * useful sentence. One fault, one report.
   */
  test.each([":before", ":after", ":first-line", ":first-letter"])(
    "`&%s` is valid CSS and is left to `non-canonical-spelling`",
    (pseudo) => {
      const all = checkNamedFree(`&${pseudo} { color: red; }`);

      expect(found(`&${pseudo}`)).toEqual([]);
      expect(all.map((one) => one.rule)).toEqual(["non-canonical-spelling"]);
    },
  );
});

/**
 * AN AT-RULE NAME THAT DOES NOT EXIST, and it drops the whole rule.
 *
 * Found the way the pseudo-class was: `AT_RULE_LINKS` holds every at-rule name CSS has, and
 * `normalise.ts` and `plugin.ts` both read it — while no RULE did. So the FEATURE inside a `@media`
 * was checked and the word `@media` itself was not:
 *
 *     @media (min-widht: 40rem) { … }   reported
 *     @medai (min-width: 40rem) { … }   silent
 *
 * Measured in Chromium, inserting the rule and reading `cssRules` back: a name the browser does not
 * know keeps ZERO rules — every declaration inside it is dropped, and the element stays black. Same
 * cost as the pseudo-class and for the same reason: it is the rule that is thrown away, not one
 * declaration.
 */
describe("an at-rule name", () => {
  test.each(["@media (min-width: 40rem)", "@supports (display: grid)", "@container (min-width: 10px)", "@layer x"])(
    "%s is one CSS has and is left alone",
    (prelude) => {
      // `@layer` has a rule of its own — `layer-in-a-block` — so it is only the NAME being asked here.
      const found = checkNamedFree(`${prelude} { color: red; }`).filter((one) => one.rule === "unknown-at-rule");

      expect(found).toEqual([]);
    },
  );

  test.each([
    ["a typo", "@medai (min-width: 40rem)", "@media"],
    ["one letter out", "@supprts (display: grid)", "@supports"],
    ["a missing letter", "@containr (min-width: 10px)", "@container"],
  ])("%s is reported: %s", (_what, prelude, meant) => {
    const found = checkNamedFree(`${prelude} { color: red; }`);

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("unknown-at-rule");
    expect(found[0].message).toContain(meant);
  });

  /**
   * A name with no near miss is still reported, because unlike a property this is not a case the
   * types cover — nothing else in this package says a word about it, and the whole rule is dropped.
   */
  test("a name that is nothing at all is reported without a suggestion", () => {
    const found = checkNamedFree("@notarule { color: red; }");

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("unknown-at-rule");
    expect(found[0].message).not.toContain("Did you mean");
  });

  /**
   * A VENDOR at-rule is a browser's own — `@-moz-document` was real — so the prefix is checked and
   * the name after it is not, exactly as for a property.
   */
  test("a vendor-prefixed at-rule is left alone", () => {
    expect(checkNamedFree("@-moz-document url-prefix() { color: red; }")).toEqual([]);
  });
});

/**
 * A media condition a browser keeps and never matches, and a `@supports` that cannot switch.
 *
 * Measured in Chromium, Firefox and WebKit: a value the engine does not know makes the condition
 * `unknown`, so it is neither true nor false — `(f)` and `not (f)` both fail. And `@supports` asks
 * whether a PROPERTY is supported: `(min-width: 40rem)` is a property and always is, while
 * `(orientation: landscape)` is not one and never is. Either way the group never switches, and both
 * read like a breakpoint somebody meant to write.
 */
describe("a condition that cannot switch", () => {
  test.each([
    ["a value the feature does not have", "  @media (prefers-color-scheme: drak) { color: red; }"],
    ["another", "  @media (hover: hovr) { color: red; }"],
    ["a width with no unit", "  @media (min-width: 40) { color: red; }"],
  ])("%s is reported", (_what, css) => {
    expect(rules(css)).toContain("unknown-media-value");
  });

  test("and the near miss is offered", () => {
    expect(messages("  @media (prefers-color-scheme: drak) { color: red; }").join(" ")).toContain("`dark`");
  });

  test.each([
    ["a breakpoint in @supports, always true", "  @supports (min-width: 40rem) { color: red; }"],
    ["a media feature in @supports, never true", "  @supports (orientation: landscape) { color: red; }"],
    ["another", "  @supports (hover: hover) { color: red; }"],
  ])("%s is reported", (_what, css) => {
    expect(rules(css)).toContain("supports-a-media-feature");
  });

  test.each([
    ["a real media condition", "  @media (prefers-color-scheme: dark) { color: red; }"],
    ["a breakpoint", "  @media (min-width: 40rem) { color: red; }"],
    ["zero", "  @media (min-width: 0) { color: red; }"],
    ["a ratio", "  @media (min-aspect-ratio: 16/9) { color: red; }"],
    ["a resolution", "  @media (min-resolution: 2dppx) { color: red; }"],
    ["a real @supports", "  @supports (display: grid) { color: red; }"],
    ["a sizing keyword in @supports, which is a real question", "  @supports (min-width: fit-content) { color: red; }"],
  ])("%s is silent", (_what, css) => {
    const found = rules(css);
    expect(found).not.toContain("unknown-media-value");
    expect(found).not.toContain("supports-a-media-feature");
  });
});
