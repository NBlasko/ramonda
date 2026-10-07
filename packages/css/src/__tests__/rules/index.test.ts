import { checkBlock, nearest } from "../../compiler/rules";
import { checkSource } from "../../compiler/source";
import { describe, expect, test } from "vitest";
import { findBlocks } from "../../compiler/scan";
import { readBlock } from "../../compiler/read";
import { check, rules } from "./helpers";

describe("more than one fault in a block", () => {
  test("comes back in the order a person reads the block", () => {
    const source = `<div className={@@(\n  display: flexx;\n  flex-dirction: row;\n  overflow: hiddn;\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });

    const found = checkBlock(read.block);
    expect(found.map((finding) => finding.rule)).toEqual(["unknown-value", "unknown-property", "unknown-value"]);
    expect(found.map((finding) => finding.at)).toEqual([
      source.indexOf("flexx"),
      source.indexOf("flex-dirction"),
      source.indexOf("hiddn"),
    ]);
  });

  /**
   * A block built by hand has no positions — nothing in the package does that, but the type says it
   * is possible and a rule that read `at` as a number would be wrong about the one that does.
   */
  test("a block with no positions is read without reporting a place it cannot name", () => {
    expect(
      checkBlock({
        items: [
          { kind: "declaration", property: "flex-dirction", value: [{ kind: "text", text: "row" }] },
          { kind: "declaration", property: "display", value: [{ kind: "text", text: "flexx" }] },
        ],
      }),
    ).toEqual([{ rule: "unknown-value", at: 0, length: 5, message: expect.stringContaining("flexx") }]);
  });
});

describe("what a finding carries", () => {
  test("the position of the fault itself, not of the block", () => {
    const source = `<div className={@@(\n  display: flex;\n  flex-dirction: row;\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });

    const [only] = checkBlock(read.block);
    expect(only.at).toBe(source.indexOf("flex-dirction"));
  });

  test("and a value fault points at the word, not at the declaration", () => {
    const source = `<div className={@@(\n  border-left: 4px sollid red;\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });

    expect(checkBlock(read.block)[0].at).toBe(source.indexOf("sollid"));
  });

  test("the length of the offending text, so an editor can draw a squiggle", () => {
    const [only] = check("  flex-dirction: row;");

    expect(only.length).toBe("flex-dirction".length);
  });

  test("a block with nothing wrong reports nothing", () => {
    expect(
      rules("  display: flex;\n  gap: 8px;\n  border-left: 4px solid #10b981;\n  &:hover { color: red; }"),
    ).toEqual([]);
  });
});

/**
 * `//` in a block, which CSS does not have and a person arriving from TypeScript will write.
 *
 * ## The fault this exists for
 *
 * It is not silent — it is worse. Measured end to end: `// why` is written into the stylesheet
 * verbatim, `.r-x{// why\n  color:red;gap:8px;}`, and a real CSS compiler then refuses the WHOLE
 * file with `SyntaxError: Unexpected token Semicolon`, naming nothing about the block, the file or
 * the line. A build that fails somewhere else entirely, for a comment.
 *
 * `/* … *\/` is the one CSS has, and it is stripped from the emitted rule, which is right.
 *
 * ## What is not one
 *
 * A `//` inside a string or a function is text: `url(https://example.com/a.png)` is the case that
 * matters, and `url(//cdn/a.png)` is the same thing without a scheme. Neither is a comment, and a
 * rule that reported them would be reporting correct CSS.
 */
describe("a line comment", () => {
  test("is reported, with what to write instead", () => {
    const [only, ...rest] = check(`// why\n  color: red;`);

    expect(rest).toEqual([]);
    expect(only.rule).toBe("line-comment");
    expect(only.message).toContain("/*");
  });

  test.each([
    ["after a declaration", `color: red; // the brand`],
    ["inside a nested rule", `&:hover {\n    // why\n    color: red;\n  }`],
  ])("%s is reported too", (_what, css) => {
    expect(check(css).map((finding) => finding.rule)).toContain("line-comment");
  });

  test.each([
    ["a block comment", `/* why */\n  color: red;`],
    ["a url with a scheme", `background: url(https://example.com/a.png);`],
    ["a url with no scheme", `background: url(//cdn.example.com/a.png);`],
    ["a quoted one", `content: "// not a comment";`],
    ["a single slash", `font: 12px/1.5 system-ui;`],
    ["a ratio", `aspect-ratio: 16 / 9;`],
    ["one inside a hole", `color: $(cond ? "red" : "blue"); /* fine */`],
  ])("%s is not one", (_what, css) => {
    expect(check(css).filter((finding) => finding.rule === "line-comment")).toEqual([]);
  });
});

/**
 * FIVE FALSE REPORTS a review measured, each on CSS that is valid.
 *
 * A missed fault here is a gap; a report on correct CSS is how a checker earns being switched off.
 * So these are assertions of SILENCE, and each one failed before it was written.
 */
describe("valid CSS these rules must not report", () => {
  /**
   * A relative of a real media feature, not a typo of one.
   *
   * `typedInto` says a known name being a SUBSEQUENCE of what was written means somebody typed extra
   * characters into it. True for `prefers-reduced-mErrorotion`; false for a whole dash-delimited
   * segment, which is how CSS names a family. `video-` is exactly the six characters the length
   * bound allowed, so the entire `video-*` family of Media Queries 5 came back as typos of the
   * unprefixed features — and `min-video-width` as a typo of `min-width`.
   *
   * The bound cannot be tuned out of this: the extra text IS six characters. What separates them is
   * that a family relative inserts whole segments and a typo does not.
   */
  test.each([
    ["video-color-gamut", "  @media (video-color-gamut: p3) { color: red; }"],
    ["video-width", "  @media (video-width: 500px) { color: red; }"],
    ["video-height", "  @media (video-height: 500px) { color: red; }"],
    ["video-resolution", "  @media (video-resolution: 2dppx) { color: red; }"],
    ["min-video-width", "  @media (min-video-width: 500px) { color: red; }"],
    ["max-video-width", "  @media (max-video-width: 500px) { color: red; }"],
    ["a suffix, which is the same argument", "  @media (prefers-reduced-motion-strength: 1) { color: red; }"],
    ["a prefix CSS has not invented yet", "  @media (foo-width: 500px) { color: red; }"],
  ])("%s is a relative of a feature, not a typo of one", (_what, css) => {
    expect(rules(css)).toEqual([]);
  });

  /** And a real typo is still reported, which is what makes the narrowing a narrowing. */
  test.each([
    ["characters typed into the middle", "  @media (prefers-reduced-mErrorotion: reduce) { color: red; }"],
    ["a near miss", "  @media (min-widht: 40rem) { color: red; }"],
    ["another", "  @media (prefers-color-schme: dark) { color: red; }"],
  ])("%s is still reported", (_what, css) => {
    expect(rules(css)).toEqual(["unknown-media-feature"]);
  });

  /**
   * A unit inside a STRING or inside `url()`, where there is no unit at all.
   *
   * `words()` steps over both and has since it was written; these two rules walked the raw text.
   * There is no config an author could write to make `content: "100%"` correct — the text is a CSS
   * string, and `url(icons/16em.svg)` is a filename.
   */
  describe("a unit that is not a unit because it is inside something", () => {
    const withUnits = (css: string) => {
      const source = `<div className={@@(\n${css}\n)}>x</div>`;
      const [site] = findBlocks(source);
      const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
      return checkBlock(read.block, { config: { units: { length: ["px", "rem"], percentage: ["%"] } } }).map(
        (one) => one.rule,
      );
    };

    test.each([
      ["a percentage in a string", `  content: "100%";`],
      ["a length in a sentence", `  content: "≈ 50em wide";`],
      ["a font name holding one", `  font-family: "Foo 12pt", sans-serif;`],
      ["a custom property holding a string", `  --label: "12em";`],
      ["a filename in an unquoted url", `  background-image: url(icons/16em.svg);`],
      ["a filename in a quoted one", `  background-image: url("photos/2in-wide.jpg");`],
      ["a single-quoted string", `  content: '3rd';`],
      ["a font format", `  --src: url(a.woff2) format("woff2");`],
    ])("%s is silent", (_what, css) => {
      expect(withUnits(css)).toEqual([]);
    });

    /** And a real one beside a string is still read, so the skip is a skip and not a bail-out. */
    test("a banned unit after a string is still reported", () => {
      expect(withUnits(`  --a: "12em" 4em;`)).toEqual(["unit-not-allowed"]);
    });

    /**
     * One report, not two: `%` is a percentage and this fixture constrains percentages to `%`, so
     * only the `em` is a fault. It is INSIDE the call, which is the whole claim — were the call's
     * interior skipped the way a string's is, this would be silent.
     */
    test("and a unit inside an ordinary call still is too", () => {
      expect(withUnits(`  width: calc(100% - 4em);`)).toEqual(["unit-not-allowed"]);
    });

    test("`unknown-unit` has the same blind spot and the same fix", () => {
      expect(rules(`  content: "3rd";`)).toEqual([]);
      expect(rules(`  background-image: url(a-16pxx.svg);`)).toEqual([]);
      expect(rules(`  padding: 10pxx;`)).toEqual(["unknown-unit"]);
    });
  });

  /**
   * `<custom-ident>` refusing a dashed ident. Per css-values-4 a `<dashed-ident>` IS a
   * `<custom-ident>`, with the extra restriction that it starts with two dashes — so `--x` is one.
   * The generator's own comment reasons correctly about exactly this; the checker's matcher did not.
   */
  test("a dashed ident where a custom ident was registered", () => {
    const source =
      `const t = @@property( syntax: "<custom-ident>"; inherits: false; initial-value: --x; );\n` +
      `const s = @@( color: red; );\n`;
    const sites = findBlocks(source);
    const read = readBlock(source, sites[0].open, "C.tsx", { tolerant: true });

    expect(checkBlock(read.block, { at: sites[0].at }).map((one) => one.rule)).toEqual([]);
  });
});

/**
 * **A SWAPPED PAIR OF LETTERS, which is the commonest typo and got no suggestion.**
 *
 * Found by `@medai` — a transposition of `@media`. Levenshtein counts a swap as TWO edits, and the
 * bound is scaled by length, so for a six-character name it is 1 and the swap is out of reach.
 *
 * Measured over every single-swap typo of every name in the four vocabularies, and every single
 * DELETION too, so the change is measured for what it might break:
 *
 *                     Levenshtein                    optimal string alignment
 *     properties  swap  right 12978  wrong 88  silent 199   right 13263  wrong 2  silent 0
 *     properties  drop  right 14223  wrong 63  silent   0   right 14223  wrong 63 silent 0
 *     features    swap  right   577  wrong 10  silent  31   right   618  wrong 0  silent 0
 *     at-rules    swap  right   157  wrong  0  silent  25   right   182  wrong 0  silent 0
 *     selectors   swap  right  1210  wrong  2  silent 141   right  1353  wrong 0  silent 0
 *
 * Better in every direction — 396 silent typos become 0, 100 wrong suggestions become 2, deletions
 * are untouched — and FASTER, 0.024 ms against 0.037 ms per word over 828 names, because a swap
 * costing 1 reaches the abandon bound sooner.
 *
 * It is one rule with six consumers: `unknown-property`, `unknown-value`, `unknown-media-feature`,
 * `unknown-prefix`, `unknown-at-rule`, and the config's rule-id check.
 */
describe("a swapped pair of letters", () => {
  test.each([
    ["@medai", "@media"],
    ["oclor", "color"],
    ["gpa", "gap"],
  ])("%s is a typo of %s", (typo, meant) => {
    const among = typo.startsWith("@") ? ["@media", "@supports", "@container", "@layer"] : ["color", "gap", "padding"];

    expect(nearest(typo, among)).toBe(meant);
  });

  /** And a name that is nothing like any of them still gets nothing, which is the honest answer. */
  test("but a word that is nothing like one gets no suggestion", () => {
    expect(nearest("zzzzzzzz", ["color", "gap", "padding"])).toBeUndefined();
  });

  /** A deletion still works, which is what the measurement above was checking for. */
  test("a dropped letter is still a typo", () => {
    expect(nearest("colr", ["color", "gap", "padding"])).toBe("color");
    expect(nearest("flex-dirction", ["flex-direction", "flex-wrap"])).toBe("flex-direction");
  });
});

/**
 * **EVERY `//`, and it used to be one per block.**
 *
 * The rule stopped after the first, deliberately and with a note: *"One per block: the rest of the
 * line is already claimed, and a file full of them is one habit."* That reasoning was sound when it
 * was written, and a measurement has since undercut it.
 *
 * TypeScript refuses EVERY one of them — the virtual file writes the comment and the next property
 * as one key — and `check.ts` drops a `TS2353` only where a rule of ours already spoke. So with the
 * suppression widened, a file with three comments showed:
 *
 *     2:3  line-comment  CSS has no `//` comment — … Write a block comment instead.
 *     4:3  TS2353        … '"// two\n  color"' does not exist in type 'CssBlockShape'.
 *     6:3  TS2353        … '"// three\n  margin"' does not exist in type 'CssBlockShape'.
 *
 * One good message and two that quote a comment and the next property mashed into a key. Reporting
 * every one gives every comment the message that says what to do, and leaves nothing for the
 * compiler to say badly.
 *
 * The habit argument survives in the other direction too: a person who wrote three wants to know
 * there are three, because it is one edit repeated rather than three decisions.
 */
describe("every line comment", () => {
  const comments = (source: string) => checkSource(source, "/a.tsx").filter((one) => one.rule === "line-comment");

  test.each([
    ["one", 1, "const a = @@(\n  // one\n  gap: 8px;\n);\n"],
    ["two", 2, "const a = @@(\n  // one\n  gap: 8px;\n  // two\n  color: red;\n);\n"],
    ["three", 3, "const a = @@(\n  // one\n  gap: 8px;\n  // two\n  color: red;\n  // three\n  margin: 0;\n);\n"],
  ])("%s is reported as %i", (_what, expected, source) => {
    expect(comments(source)).toHaveLength(expected);
  });

  test("one outside a nested rule and one inside are both reported", () => {
    const source = "const a = @@(\n  // outside\n  gap: 8px;\n  &:hover {\n    // inside\n    color: red;\n  }\n);\n";

    const found = comments(source);

    expect(found).toHaveLength(2);
    // Each squiggle is on its own `//`, which is what an editor draws.
    for (const one of found) expect(source.slice(one.at, one.at + one.length)).toBe("//");
  });

  /**
   * **The rest of the LINE is one fault, not several.** A second `//` after the first is inside the
   * first one's text, and `////` is not four comments.
   *
   * Under test because the claim was written into the code and a control could not see it fail — the
   * standing lesson that an assertion nobody can break is not an assertion.
   */
  test.each([
    ["a doubled slash run", "const a = @@(\n  //// one\n  gap: 8px;\n);\n"],
    ["a second one later on the line", "const a = @@(\n  // one // two\n  gap: 8px;\n);\n"],
    ["a url after a comment starts", "const a = @@(\n  // see https://example.com\n  gap: 8px;\n);\n"],
  ])("%s is one finding", (_what, source) => {
    expect(comments(source)).toHaveLength(1);
  });

  /**
   * **A `//` WITH NOTHING AFTER IT, where the editor and the build said different things.**
   *
   * A line comment is normally absorbed into the next declaration's key, so the block still parses
   * and `line-comment` speaks. When it is the LAST thing there is no next declaration, the parser
   * refuses first, and the refusal is the generic one:
   *
   *     editor (tolerant)   CSS has no `//` comment — … Write a block comment instead.
   *     build and check     `// last` is not a declaration — a block holds `property: value;` …
   *
   * Both true, and only one says what to do. The file is not half-written — somebody finished it
   * that way — so this is the same file getting two different answers from the same package.
   */
  test.each([
    ["on the last line", "const a = @@(\n  gap: 8px;\n  // last\n);\n"],
    ["alone in the block", "const a = @@(\n  // only\n);\n"],
    ["last inside a nested rule", "const a = @@(\n  &:hover {\n    gap: 8px;\n    // last\n  }\n);\n"],
  ])("%s says what to do, not that it is not a declaration", (_what, source) => {
    let said = "";
    try {
      checkSource(source, "/a.tsx");
      said = "did not refuse";
    } catch (error) {
      said = (error as Error).message;
    }

    expect(said).toContain("CSS has no `//` comment");
  });

  /** And each is at its own position, in the order a person reads them. */
  test("each is at its own line", () => {
    const source = "const a = @@(\n  // one\n  gap: 8px;\n  // two\n  color: red;\n);\n";

    const lines = comments(source).map((one) => source.slice(0, one.at).split("\n").length);

    expect(lines).toEqual([2, 4]);
  });

  /**
   * What is still ONE finding: a `//` inside a hole is JavaScript, where a line comment is ordinary
   * and is not this rule's business — and one inside a `/* … *` + `/` is the author's prose.
   */
  test.each([
    ["inside a hole", "const w = 1;\nconst a = @@(\n  gap: $(w /* px */);\n);\n"],
    ["inside a block comment", "const a = @@(\n  /* not // a comment */\n  gap: 8px;\n);\n"],
    ["inside a string", 'const a = @@(\n  content: "// not a comment";\n);\n'],
    ["a url with two slashes", "const a = @@(\n  background: url(https://example.com/a.png);\n);\n"],
  ])("%s is not a line comment", (_what, source) => {
    expect(comments(source)).toEqual([]);
  });
});

describe("what the review found in the rules", () => {
  const found = (css: string) => {
    const source = `<div className={@@(\n${css}\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    return checkBlock(read.block, {}).map((one) => one.rule);
  };

  test("an important wider shorthand, then an ordinary narrower one, is not the fault — `i` decides", () => {
    expect(found("border: var(--x) !important; border-top: var(--y);")).not.toContain(
      "narrower-after-a-whole-shorthand",
    );
    expect(found("border: var(--x) !important; border-top: var(--y) !important;")).toContain(
      "narrower-after-a-whole-shorthand",
    );
  });

  test("a contested word is reported in any case", () => {
    expect(found("animation: AUTO;")).toContain("value-differs-across-engines");
  });
});
