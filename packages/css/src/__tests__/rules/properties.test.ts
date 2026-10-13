import { ABBREVIATIONS, KEYWORDS, PROPERTIES } from "../../compiler/keywords.generated";
import { checkBlock } from "../../compiler/rules";
import { describe, expect, test } from "vitest";
import { findBlocks } from "../../compiler/scan";
import { readBlock } from "../../compiler/read";
import { check, checkNamed, checkNamedFree, messages, rules } from "./helpers";

describe("a property name CSS does not have", () => {
  /**
   * **It was dashed names only until review pass 6**, and the reason was sound in the checker and
   * wrong in the build. The types report a dashed name as `TS2353` with no suggestion, because a
   * QUOTED object key gets none — measured — while a bare one gets `TS2561` and TypeScript's own
   * *did you mean*. So the rule filled the first hole and left the second.
   *
   * The build runs no TypeScript. Measured in pass 6: `dsiplay: flex` and even `zzz: flex` compiled
   * into the stylesheet with nothing said anywhere. The rule speaks for both now, with or without a
   * suggestion, and `inOrder` drops the compiler's word on the line — so it is still one fault, one
   * report.
   */
  test("a dashed near miss is named, with what was meant", () => {
    const [only, ...rest] = check("  flex-dirction: row;");

    expect(rest).toEqual([]);
    expect(only.rule).toBe("unknown-property");
    expect(only.message).toContain("flex-dirction");
    expect(only.message).toContain("flex-direction");
  });

  test("a bare name is named too, so the BUILD sees it", () => {
    const [only, ...rest] = check("  dsiplay: flex;");

    expect(rest).toEqual([]);
    expect(only.rule).toBe("unknown-property");
    expect(only.message).toContain("display");
  });

  test("a name with no near miss at all is named without one", () => {
    const [only] = check("  zzz-qqq-www: 1px;");

    expect(only.rule).toBe("unknown-property");
    expect(only.message).toContain("zzz-qqq-www");
    expect(only.message).not.toContain("Did you mean");
  });

  test.each([
    ["a custom property the author declares", "  --brand: #10b981;"],
    ["a vendor-prefixed property", "  -webkit-line-clamp: 2;"],
    ["a real dashed property", "  flex-direction: row;"],
    ["a real dashed property in a nested rule", "  &:hover { border-left: 1px solid red; }"],
  ])("%s is silent", (_what, css) => {
    expect(rules(css)).toEqual([]);
  });
});

describe("the same declaration written twice", () => {
  /**
   * **Only when the VALUE is the same too**, and that narrowing is the whole rule.
   *
   * Two declarations of one property with different values is a deliberate idiom — a fallback for an
   * engine that will drop the second: `width: 100px; width: fit-content;`. Reporting it would be
   * reporting a technique, which is how a checker earns being switched off. The same value twice
   * says nothing either way, and is a copy that got left behind.
   */
  test("is named when the value is the same", () => {
    const [only, ...rest] = check("  color: red;\n  color: red;");

    expect(rest).toEqual([]);
    expect(only.rule).toBe("repeated-declaration");
    expect(only.message).toContain("color");
  });

  test.each([
    ["a fallback, which is a technique", "  width: 100px;\n  width: fit-content;"],
    ["the same property in a nested rule", "  color: red;\n  &:hover { color: red; }"],
    ["two properties that merely look alike", "  border-left: red;\n  border-right: red;"],
  ])("%s is silent", (_what, css) => {
    expect(rules(css)).toEqual([]);
  });

  test("the same property with a hole in one of them is not a repeat — it is a hole, which is its own finding", () => {
    expect(rules("  color: red;\n  color: $(accent);")).toEqual(["hole-not-allowed"]);
  });
});

describe("the two generated lists, which are not the same list", () => {
  /**
   * `PROPERTIES` is every name CSS defines; `KEYWORDS` holds only the ones whose VALUES these rules
   * may judge. Asked in review whether one could be derived from the other, and the answer is no —
   * measured: 275 names are in the first and not the second.
   */
  test("the name list is longer than the value table, on purpose", () => {
    expect(PROPERTIES.length).toBeGreaterThan(Object.keys(KEYWORDS).length);
  });

  /**
   * The case that decides it, and it is this rule's headline. `flex-direction`'s values are the
   * types' to report, so it is absent from the value table — and it must be in the name list, or
   * `flex-dirction` could never be suggested.
   */
  test("a property the types own is absent from the values and present in the names", () => {
    expect(KEYWORDS["flex-direction"]).toBeUndefined();
    expect(PROPERTIES).toContain("flex-direction");
    expect(messages("  flex-dirction: row;")[0]).toContain("flex-direction");
  });

  test("and a value the types already report is not reported again", () => {
    // `position` is one of the 123 with a real union, so `statik` is `TS2820` with its own suggestion.
    expect(KEYWORDS.position).toBeUndefined();
    expect(rules("  position: statik;")).toEqual([]);
  });
});

describe("inside `@@font-face` and `@@property`", () => {
  test("a descriptor is not reported as a property, however close to one it reads", () => {
    expect(checkNamed("font-face", 'font-family: "Brand";\nsrc: url("/b.woff2");\nascent-override: 90%;')).toEqual([]);
    expect(checkNamed("property", 'syntax: "<angle>";\ninherits: false;\ninitial-value: 45deg;')).toEqual([]);
  });

  test("a nested rule is reported, because a descriptor list is not a rule", () => {
    const found = checkNamed("font-face", 'src: url("/b.woff2");\n&:hover { color: red; }');

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("rule-out-of-place");
  });

  test("and a unit typo is still caught, since a unit is a unit wherever it is written", () => {
    expect(checkNamed("property", 'syntax: "<angle>";\ninherits: false;\ninitial-value: 45degg;')[0]?.rule).toBe(
      "unknown-unit",
    );
  });
});

/**
 * The abbreviations a readable class name is built from.
 *
 * A class is `r-<abbreviation>-<value>`, and the abbreviation is what makes `r-p-12px` shorter than
 * `r-padding-12px` while still saying the same thing. **Written here rather than taken from any
 * library**: none covers 551 properties, and where a convention exists — `p`, `m`, `bg`, `gap` —
 * the convention is the point rather than the source. A property with no entry uses its own name,
 * which is already readable.
 *
 * Three things have to hold or two different declarations can produce one name, which is the worst
 * failure this package has — two rules merged into one. Each is asserted here AND at generation, so
 * a bad entry cannot reach a build.
 */
describe("the abbreviation map", () => {
  test("the conventional ones are what a reader expects", () => {
    expect(ABBREVIATIONS.padding).toBe("p");
    expect(ABBREVIATIONS.margin).toBe("m");
    expect(ABBREVIATIONS.background).toBe("bg");
    expect(ABBREVIATIONS["align-items"]).toBe("items");
    expect(ABBREVIATIONS["border-radius"]).toBe("rounded");
  });

  /**
   * **The rule that makes a name readable BACK.** `r-<abbr>-<value>` is only unambiguous if the
   * first `-` ends the abbreviation — otherwise `p` with the value `l-40px` and `pl` with `40px`
   * are one string.
   */
  test("no abbreviation contains a hyphen", () => {
    for (const [property, short] of Object.entries(ABBREVIATIONS)) {
      expect(short, `${property} -> ${short}`).not.toContain("-");
    }
  });

  test("no two properties share one", () => {
    const byShort = new Map<string, string>();
    for (const [property, short] of Object.entries(ABBREVIATIONS)) {
      expect(byShort.get(short), `${short} is taken by ${byShort.get(short)}`).toBeUndefined();
      byShort.set(short, property);
    }
  });

  /**
   * A property with no abbreviation uses its own NAME, so an abbreviation that IS another property's
   * name would collide with it — `r-<that name>-<value>` from two different properties.
   */
  test("and no abbreviation is another property's name", () => {
    const known = new Set(PROPERTIES);
    for (const [property, short] of Object.entries(ABBREVIATIONS)) {
      if (short === property) continue;
      expect(known.has(short), `${short} (for ${property}) is a property of its own`).toBe(false);
    }
  });

  test("every abbreviated property is a property CSS has", () => {
    const known = new Set(PROPERTIES);
    for (const property of Object.keys(ABBREVIATIONS)) {
      expect(known.has(property), `${property} is not a CSS property`).toBe(true);
    }
  });

  test("an ordinary property has none, because its own name reads fine", () => {
    expect(ABBREVIATIONS["outline-offset"]).toBeUndefined();
    expect(ABBREVIATIONS.isolation).toBeUndefined();
  });

  /**
   * **Two conventional spellings had to be given up, and the third assertion found them on the first
   * run this map was generated.** `d` is a property of its own — the SVG path data — and so is
   * `flex`. Either would have made `display: flex` and `d: M0,0` one class, or `flex-direction: row`
   * and `flex: 1`. Asserted by name so they cannot quietly come back.
   */
  test("the two conventional ones that would have collided are not used", () => {
    expect(ABBREVIATIONS.display).toBe("disp");
    expect(ABBREVIATIONS["flex-direction"]).toBe("fdir");
    expect(PROPERTIES).toContain("d");
    expect(PROPERTIES).toContain("flex");
  });
});

/**
 * A PROPERTY NAME WITH WHITESPACE IN IT, which is never a CSS name.
 *
 * A review found what it does to the class name — see `nameFor`, which falls to the hash for it now
 * — and the hash only makes the STYLESHEET parse. The declaration inside the rule is still
 * `--a b: red`, which no browser accepts, so the rule matches an element that carries the class and
 * then applies nothing. Silently, which is this package's whole reason to exist.
 *
 * Nothing reported it. `unknown-property` returns early for a name starting with `-`, and for one
 * with no `-` at all, so `font size` and `--a b` both walked past it.
 *
 * The two causes worth naming, because they are what an author actually did: a missing `-` between
 * two words, and a name wrapped across lines — which is also what a missing `;` looks like from here.
 */
describe("a property name holding whitespace", () => {
  test("a two-word name is reported", () => {
    expect(rules(`  font size: 12px;`)).toEqual(["property-not-a-name"]);
  });

  test("and the message suggests the name with a dash, when that is a real property", () => {
    expect(messages(`  font size: 12px;`)[0]).toContain("`font-size`");
  });

  test.each([
    ["a tab", "  font\tsize: 12px;"],
    ["a newline, which is what a wrapped name looks like", "  --brand\n  -color: red;"],
    ["a custom property with a space", "  --a b: red;"],
    ["several spaces", "  font  size: 12px;"],
  ])("%s is reported too", (_what, css) => {
    expect(rules(css)).toContain("property-not-a-name");
  });

  test("the message says a name holds no whitespace, whatever the author meant", () => {
    expect(messages("  --a b: red;")[0]).toMatch(/whitespace/);
  });

  test.each([
    ["a plain property", "  color: red;"],
    ["a custom property", "  --brand: red;"],
    ["a vendor prefix", "  -webkit-mask: none;"],
    ["a value with spaces in it, which is ordinary", "  border-left: 1px solid red;"],
    ["a spread, which is not a property at all", "  ...$(base);"],
  ])("%s says nothing", (_what, css) => {
    expect(rules(css)).not.toContain("property-not-a-name");
  });

  /** One report for one fault: the name is not also run through the near-miss search. */
  test("and it is the only thing reported for that declaration", () => {
    expect(rules(`  font size: 12px;`)).toEqual(["property-not-a-name"]);
  });
});

/**
 * A CONDITION or a SELECTOR spelled a way that is the same CSS and a different key.
 *
 * `:hover` and `:HOVER` are one rule to a browser, measured with lightningcss — and two keys here,
 * because a declaration's key is its own text. A review measured the cost: a base and a modifier one
 * space apart kept BOTH classes, so the modifier did not override and the winner was decided by
 * whichever file the bundler reached first.
 *
 * The project's answer is one spelling in the SOURCE. This says so, and `ramonda-css format` writes
 * it — the message names the canonical form, so it is actionable either way.
 *
 * **It reports exactly what the canonicaliser changes**, no more: a shape `canonicalSelector` and
 * `canonicalCondition` leave alone is a shape this says nothing about, because an error with no fix
 * is worse than a spelling. One function asked two ways, so the rule and the formatter cannot drift.
 */
describe("a spelling that is the same CSS and a different class", () => {
  test.each([
    ["a legacy pseudo-element", '  &:before { content: ""; }', "&::before"],
    ["no space after a feature's colon", "  @media (min-width:40rem) { color: red; }", "min-width: 40rem"],
    ["a supports declaration", "  @supports (display:grid) { color: red; }", "display: grid"],
  ])("%s is reported, with the spelling to use", (_what, css, expected) => {
    const found = rules(css);

    expect(found).toEqual(["non-canonical-spelling"]);
    expect(messages(css)[0]).toContain(expected);
  });

  /**
   * A difference of CASE ALONE is not reported — see `onlyCase`, and the formatter still fixes it.
   *
   * These four were reported until review pass 3 measured what that cost: `color: currentColor` —
   * the spelling MDN documents — failed the build, and every rule is an error. The formatter half is
   * unchanged and is what carries the guarantee now; `toolingCli.test.ts` holds it to that through
   * the real biome, on all four shapes at once.
   */
  test.each([
    ["a pseudo-class in capitals", "  &:HOVER { color: red; }"],
    ["an at-rule name in capitals", "  @MEDIA print { color: red; }"],
    ["a feature name in capitals", "  @media (MIN-WIDTH: 40rem) { color: red; }"],
    ["a media type in capitals", "  @media PRINT { color: red; }"],
  ])("%s says nothing, because case alone is the formatter's", (_what, css) => {
    expect(rules(css)).toEqual([]);
  });

  test.each([
    ["a canonical pseudo-class", "  &:hover { color: red; }"],
    ["a canonical pseudo-element", '  &::before { content: ""; }'],
    ["a canonical condition", "  @media (min-width: 40rem) { color: red; }"],
    ["a class, which is the author's own", "  &.Open { color: red; }"],
    ["an id", "  &#Main { color: red; }"],
    ["an attribute value", '  &[data-x="Y"] { color: red; }'],
    ["a container name", "  @container Card (width > 40rem) { color: red; }"],
    ["a range condition, which has no colon", "  @media (width > 40rem) { color: red; }"],
    ["a boolean condition", "  @media (prefers-reduced-motion) { color: red; }"],
    ["a url holding a colon", "  @supports (background: url(http://x)) { color: red; }"],
  ])("%s says nothing", (_what, css) => {
    expect(rules(css)).toEqual([]);
  });

  /** The two that used to be left alone because each looked like it needed a parser. */
  test.each([
    ["spaces in an `An+B`", "  &:nth-child(2n + 1) { color: red; }", "&:nth-child(2n+1)"],
    ["a redundant pair of parens", "  @supports ((display: grid)) { color: red; }", "@supports (display: grid)"],
  ])("%s is reported too, now that it can be fixed", (_what, css, expected) => {
    expect(rules(css)).toEqual(["non-canonical-spelling"]);
    expect(messages(css)[0]).toContain(expected);
  });
});

/**
 * A VENDOR PREFIX THAT IS NOT ONE, which passed in silence.
 *
 * `-webkit-line-clamp` is not in CSS's own list and is not a typo of anything in it, so
 * `unknown-property` returns early for every name starting with `-` — and the generator says why:
 * "each one a name nobody misspells into a different property". Measured by the user typing
 * `-wdasdsdebkit-line-clamp: 3`, which compiled, shipped, and did nothing.
 *
 * A list of valid prefixed NAMES would be the wrong repair and was measured to be: MDN's data holds
 * a hundred of them and does not hold `-webkit-font-smoothing` or `-moz-osx-font-smoothing`, which
 * are two of the most-written lines in real CSS. Reporting those would be refusing valid CSS, which
 * is the one failure this package may not have.
 *
 * The PREFIX is a different question, and it is closed: `-webkit-`, `-moz-`, `-ms-`, `-o-`. Four,
 * fixed for fifteen years, and the working group stopped minting them. So the prefix is checked and
 * the name after it is not.
 */
describe("a vendor prefix", () => {
  test.each(["-webkit-line-clamp", "-moz-osx-font-smoothing", "-ms-overflow-style", "-apple-pay-button-style"])(
    "%s is a browser's own name and is left alone",
    (name) => {
      expect(checkNamedFree(`${name}: 3;`)).toEqual([]);
    },
  );

  /**
   * `-o-` is gone, and that is a measurement rather than an omission: no engine has a single `-o-`
   * name left — Presto has been gone since 2013 — so an `-o-` property belongs to nobody. It used to
   * be one of four hard-coded prefixes, which also left out `-apple-`, so a real WebKit property was
   * reported as an unknown prefix. Both halves come off one list now.
   */
  test("an `-o-` name belongs to no engine any more", () => {
    const found = checkNamedFree("-o-object-fit: cover;");

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("unknown-prefix");
  });

  test("a custom property is the author's own and is left alone", () => {
    expect(checkNamedFree("--brand: red;")).toEqual([]);
  });

  test.each([
    ["a typo in the prefix", "-wdasdsdebkit-line-clamp"],
    ["one letter out", "-webkti-line-clamp"],
    ["a prefix nobody has", "-blink-line-clamp"],
    ["a single dash and a word", "-lineclamp"],
  ])("%s is reported", (_what, name) => {
    const found = checkNamedFree(`${name}: 3;`);

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("unknown-prefix");
    expect(found[0].message).toContain(name);
  });

  /**
   * **AND THE NAME AFTER THE PREFIX**, which passed while only the prefix was checked. Found by
   * somebody typing `-webkit-border-before-coloaasdsdr: "asdasdsadsd"` and watching it compile.
   *
   * A list of valid names was refused once, on the grounds that `mdn-data` holds 99 of them and has
   * neither `-webkit-font-smoothing` nor `-moz-osx-font-smoothing`. That measurement was right and
   * the conclusion was not: the ENGINES have their own lists, and asked directly they give 262
   * names between them — `-webkit-font-smoothing` among them, from all three. See
   * `scripts/css/build-prefixed-properties.mjs`.
   */
  test.each([
    ["the name after a real prefix", "-webkit-border-before-coloaasdsdr"],
    ["one letter out", "-webkit-line-clampp"],
    ["a name no engine has", "-webkit-not-a-property"],
    ["a Firefox name spelt as WebKit's", "-webkit-osx-font-smoothing"],
  ])("%s is reported: %s", (_what, name) => {
    const found = checkNamedFree(`${name}: 3;`);

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("unknown-property");
  });

  /**
   * Every name at least one engine has is left alone — including the two `mdn-data` does not list,
   * which is the whole reason the engines are asked.
   */
  test.each([
    "-webkit-line-clamp",
    "-webkit-box-orient",
    "-webkit-font-smoothing",
    "-moz-osx-font-smoothing",
    "-webkit-backdrop-filter",
    "-webkit-tap-highlight-color",
    "-webkit-text-stroke",
    "-ms-overflow-style",
  ])("%s is a real property and is left alone", (name) => {
    // The NAME is the subject. `3` is a fine value for some of these and a dropped one for others —
    // `-webkit-text-stroke` takes a length — which another rule says.
    expect(checkNamedFree(`${name}: 3;`).filter((one) => one.rule === "unknown-property")).toEqual([]);
  });

  /** A near miss is offered where there is one, the same as for a bare name. */
  test("a near miss in the name is offered as the fix", () => {
    const [found] = checkNamedFree("-webkit-line-clampp: 3;");

    expect(found.message).toContain("-webkit-line-clamp");
  });

  /** The message names the prefixes that have properties, which is what an author can choose from. */
  test("and the message names the prefixes that exist", () => {
    const [found] = checkNamedFree("-webkti-line-clamp: 3;");

    for (const prefix of ["-webkit-", "-moz-", "-ms-", "-apple-"]) expect(found.message).toContain(prefix);
    expect(found.message).not.toContain("-o-,");
  });

  /** A near miss in the prefix is offered, because that is what a typo in one looks like. */
  test("a near miss in the prefix is offered as the fix", () => {
    const [found] = checkNamedFree("-webkti-line-clamp: 3;");

    expect(found.message).toContain("-webkit-line-clamp");
  });
});

/**
 * A PROPERTY NAME in the wrong case, which is the same CSS and was called a typo.
 *
 * `unknownValue`'s own note settled this for VALUES and its words are the argument here too: *a
 * keyword in the wrong CASE is the same CSS, and saying it does not exist is a lie the author cannot
 * act on.* The verdict it reached — still refused, under `non-canonical-spelling`, because a
 * repository wants one spelling and the formatter writes it — was never applied to the name half.
 *
 * Measured in Chromium, Firefox and WebKit: `COLOR: red` sets `color` to red in all three, and
 * `CSS.supports("COLOR", "red")` is true in all three. Property names are case-insensitive in CSS.
 *
 * So `COLOR` was reported as `unknown-property` — *`COLOR` is not a CSS property* — with no
 * suggestion, because `nearest` measures a distance and the distance from `COLOR` to `color` is
 * five substitutions.
 */
describe("a property name in the wrong case", () => {
  const under = (css: string) => {
    const source = `<div className={@@(\n  ${css}\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    return checkBlock(read.block, {});
  };

  test.each([["COLOR: red;"], ["PADDING-LEFT: 8px;"], ["Display: flex;"]])(
    "`%s` is one spelling of correct CSS, not an unknown property",
    (css) => {
      const found = under(css);

      expect(found.map((one) => one.rule)).toEqual(["non-canonical-spelling"]);
      expect(found[0].message).not.toContain("is not a CSS property");
    },
  );

  test("and the message says which spelling to write", () => {
    const [found] = under("COLOR: red;");

    expect(found.message).toContain("color");
  });

  /** A real typo is still a real typo, whatever its case — the half this must not cost. */
  test.each([
    ["dsiplay: flex;", "display"],
    ["DSIPLAY: flex;", "display"],
    ["colr: red;", "color"],
  ])("`%s` is still reported as unknown, with the near miss", (css, meant) => {
    const found = under(css);

    expect(found.map((one) => one.rule)).toEqual(["unknown-property"]);
    expect(found[0].message).toContain(meant);
  });
});

describe("an unspaced combinator", () => {
  test("is reported, and the formatter is what fixes it", () => {
    const source = `<div className={@@(\n&>span { color: red; }\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    expect(checkBlock(read.block, {}).map((one) => one.rule)).toContain("non-canonical-spelling");
  });
});
