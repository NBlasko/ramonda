import { type Finding, checkBlock } from "../../compiler/rules";
import { checkSource } from "../../compiler/source";
import { describe, expect, test } from "vitest";
import { findBlocks } from "../../compiler/scan";
import { namedSites, syntaxesIn } from "../../compiler/references";
import { readBlock } from "../../compiler/read";

/**
 * An `initial-value` that its own `syntax` does not accept.
 *
 * **Measured in Chromium 151, and it voids the whole registration in silence:**
 *
 * | written | the browser kept it? | the name then |
 * |---|---|---|
 * | `syntax: "<color>"; initial-value: #10b981` | **yes** | refuses junk, falls back to the colour |
 * | `syntax: "<color>"; initial-value: 12px` | **no** — absent from `cssRules` | **accepts any junk** |
 * | `syntax: "<length>"; initial-value: red` | **no** | **accepts any junk** |
 * | `syntax: "*"; initial-value: whatever` | yes | accepts anything, which `*` means |
 *
 * So the registration is not half-broken, it is GONE: no interpolation in a transition, no fallback
 * for a value the property cannot parse, and the name back to holding whatever it is handed. Every
 * reason to write `@@property( … )` at all, removed by one mismatched line.
 *
 * ## Why it is matchers and not a classifier, which is the whole safety of it
 *
 * The rule speaks only when it has a matcher for **every** component of the syntax and none of them
 * accepts the value. A component it does not understand — `<transform-list>`, anything with a `+` or
 * `#` multiplier — makes it say nothing at all.
 *
 * That is deliberate and it is the opposite of the obvious design. Classifying the VALUE and
 * comparing types fails the wrong way: an incomplete classification makes a value look like the
 * wrong type and reports correct CSS. Asking "does any component accept this" fails by going quiet.
 *
 * The matchers are loose for the same reason. `<color>` accepts any bare word rather than a list of
 * named colours, so `<custom-ident>`-shaped values are never mistaken for a fault; `<length>` accepts
 * a number with any unit rather than only length units, so `<length>` with `3s` is MISSED. Both are
 * reports given up to keep the rule from ever being wrong.
 */
describe("an initial-value its own syntax does not accept", () => {
  const of = (source: string): Finding[] => {
    const sites = findBlocks(source);
    const site = sites[sites.length - 1];
    return checkBlock(readBlock(source, site.open, "C.tsx").block, { at: site.at, start: site.start });
  };
  const rules = (source: string) => of(source).map((one) => one.rule);
  const property = (body: string) => `const t = @@property(\n  ${body}\n);`;

  /**
   * `syntax` and `inherits` are required by CSS, and a registration missing either is dropped whole,
   * in silence — the same reason as a missing `initial-value`. The TYPE requires both, so the editor
   * says so; this is for the build, which does not run the type check. Reported on `@@property`,
   * because what is missing has no place of its own.
   */
  test.each([
    ["no syntax", `inherits: false; initial-value: 0%;`, "`syntax`"],
    ["no inherits", `syntax: "<percentage>"; initial-value: 0%;`, "`inherits`"],
    ["neither", `initial-value: 0%;`, "`syntax` and `inherits`"],
    ["nothing at all", ``, "`syntax` and `inherits`"],
  ])("a registration with %s is refused, once, on the word", (_what, body, names) => {
    const source = property(body);
    const found = of(source);

    expect(found.map((one) => one.rule)).toEqual(["property-descriptor-missing"]);
    expect(found[0].at).toBe(source.indexOf("@@property"));
    expect(found[0].length).toBe("@@property".length);
    expect(found[0].message).toContain(`has no ${names}`);
  });

  test("all three written is not, and a descriptor written with a hole counts as written", () => {
    expect(rules(property(`syntax: "<percentage>"; inherits: false; initial-value: 0%;`))).toEqual([]);
    expect(rules(property(`syntax: "*"; inherits: true;`))).toEqual([]);
    expect(rules(property(`syntax: "*"; inherits: $(x);`))).not.toContain("property-descriptor-missing");
  });

  /**
   * No `initial-value` at all. CSS requires one for every syntax but `"*"`, and without it the
   * browser drops the whole registration — measured in Chromium, Firefox and WebKit. The type cannot
   * say so, since `"*"` is a string like any other, so the rule does.
   */
  test("no initial-value, where the syntax needs one", () => {
    expect(rules(property(`syntax: "<percentage>"; inherits: false;`))).toEqual(["initial-value-and-syntax"]);
    expect(rules(property(`syntax: "<custom-ident>+"; inherits: false;`))).toEqual(["initial-value-and-syntax"]);
  });

  test("and none is needed for the universal syntax", () => {
    expect(rules(property(`syntax: "*"; inherits: false;`))).toEqual([]);
  });

  test("a length where a colour was declared", () => {
    expect(rules(property(`syntax: "<color>"; inherits: false; initial-value: 12px;`))).toEqual([
      "initial-value-and-syntax",
    ]);
  });

  test("a word where a length was declared", () => {
    expect(rules(property(`syntax: "<length>"; inherits: false; initial-value: red;`))).toEqual([
      "initial-value-and-syntax",
    ]);
  });

  test("a fraction where an integer was declared", () => {
    expect(rules(property(`syntax: "<integer>"; inherits: false; initial-value: 1.5;`))).toEqual([
      "initial-value-and-syntax",
    ]);
  });

  /**
   * **The other four component types, which nothing had ever run.**
   *
   * Coverage found it: of the twelve matchers in {@link ACCEPTS}, `<length-percentage>`, `<number>`,
   * `<url>` and `<image>` had no test on either side — not one that reports and not one that stays
   * quiet — in a rule whose entire job is deciding between those two. Measured, all four were
   * already right; being right is not the same as being held, and the eight rows below hold them.
   *
   * `<length-percentage>` is the one with two ways to be satisfied, so both are written: a length is
   * not a percentage to `UNIT_TYPE`, and the rule only stays quiet because it asks for each in turn.
   */
  test.each([
    ["a word where a length-percentage was declared", `"<length-percentage>"`, "red"],
    ["a length where a number was declared", `"<number>"`, "12px"],
    ["a bare word where a url was declared", `"<url>"`, "red"],
    ["a length where an image was declared", `"<image>"`, "12px"],
  ])("%s", (_what, syntax, value) => {
    expect(rules(property(`syntax: ${syntax}; inherits: false; initial-value: ${value};`))).toEqual([
      "initial-value-and-syntax",
    ]);
  });

  test("the message names both halves, because either one could be the mistake", () => {
    const [finding] = of(property(`syntax: "<color>"; inherits: false; initial-value: 12px;`));

    expect(finding.message).toContain("<color>");
    expect(finding.message).toContain("12px");
  });

  test("the squiggle covers the value, which is the half more likely to be wrong", () => {
    const source = property(`syntax: "<color>"; inherits: false; initial-value: 12px;`);
    const [finding] = of(source);

    expect(source.slice(finding.at, finding.at + finding.length)).toBe("12px");
  });

  describe("what it must not report", () => {
    test.each([
      ["a colour for a colour", `syntax: "<color>"; inherits: false; initial-value: #10b981;`],
      ["a named colour, which is a bare word", `syntax: "<color>"; inherits: false; initial-value: red;`],
      ["a colour function", `syntax: "<color>"; inherits: false; initial-value: rgb(1 2 3);`],
      ["a length for a length", `syntax: "<length>"; inherits: false; initial-value: 12px;`],
      ["zero, which is a length without a unit", `syntax: "<length>"; inherits: false; initial-value: 0;`],
      ["a literal in the syntax", `syntax: "<length> | auto"; inherits: false; initial-value: auto;`],
      ["`*`, which accepts anything", `syntax: "*"; inherits: false; initial-value: whatever;`],
      ["a word for a custom-ident", `syntax: "<custom-ident>"; inherits: false; initial-value: red;`],
      ["a length for a length-percentage", `syntax: "<length-percentage>"; inherits: false; initial-value: 12px;`],
      ["a percentage for the same one", `syntax: "<length-percentage>"; inherits: false; initial-value: 50%;`],
      ["a number for a number", `syntax: "<number>"; inherits: false; initial-value: 1.5;`],
      ["a url for a url", `syntax: "<url>"; inherits: false; initial-value: url(a.png);`],
      ["a gradient for an image", `syntax: "<image>"; inherits: false; initial-value: linear-gradient(red, blue);`],
      ["calc, which can be any type", `syntax: "<length>"; inherits: false; initial-value: calc(1px + 2em);`],
      ["a component with no matcher", `syntax: "<transform-list>"; inherits: false; initial-value: rotate(0deg);`],
      ["a multiplier, which this does not read", `syntax: "<length>+"; inherits: false; initial-value: 1px 2px;`],
      ["no initial-value at all, a different fault", `syntax: "*"; inherits: false;`],
    ])("%s", (_what, body) => {
      expect(rules(property(body))).toEqual([]);
    });

    /**
     * A hole in a named block IS reported now, by `hole-in-a-named-block` — the build has always
     * refused it and the checker had no rule for it. What this test is about is the OTHER rule
     * staying quiet: a syntax it cannot read is not a syntax it may judge.
     */
    test("a syntax written as a hole, which cannot be read", () => {
      const found = rules(property(`syntax: $(shape); inherits: false; initial-value: 12px;`));

      expect(found).not.toContain("initial-value-and-syntax");
      expect(found).toEqual(["hole-in-a-named-block"]);
      // A named site's body is descriptors, not declarations, so no runtime value is read out of it.
    });

    test("an ordinary block, where neither descriptor means this", () => {
      expect(rules(`const s = @@( color: red; );`)).toEqual([]);
    });
  });
});

/**
 * A registered property set to a value its own `syntax` does not accept.
 *
 * **Measured in Chromium 151, and it is the quiet kind of failure:**
 *
 *     @property --angle { syntax: "<angle>"; inherits: false; initial-value: 0deg }
 *     .set { --angle: 12px; transform: rotate(var(--angle)) }
 *
 *     --angle computes to `0deg`
 *
 * The value is discarded and the `initial-value` stands. Nothing is dropped, nothing is reported,
 * and the element simply shows the default — which is worse than a broken rule, because it looks
 * deliberate. A `@keyframes` frame set to the wrong type behaves the same way, so an animation
 * silently does not move.
 *
 * The compiler can see both halves: the reference resolves to a `@@property` site in this file, and
 * that site's `syntax` is a descriptor in its own block. Same matchers as
 * `initial-value-and-syntax`, so the same reports are deliberately given up — see {@link ACCEPTS}.
 */
describe("a registered property set to a value its syntax refuses", () => {
  const angle = `const angle = @@property( syntax: "<angle>"; inherits: false; initial-value: 0deg; );\n`;
  const colour = `const accent = @@property( syntax: "<color>"; inherits: true; initial-value: #10b981; );\n`;

  const of = (source: string): Finding[] => {
    const references = namedSites(source);
    const sites = findBlocks(source);
    const site = sites[sites.length - 1];
    const read = readBlock(source, site.open, "C.tsx", { resolve: (name) => references.get(name) });
    return checkBlock(read.block, { at: site.at, references: references, syntaxes: syntaxesIn(source) });
  };
  const rules = (source: string) => of(source).map((one) => one.rule);

  test("a length where an angle was registered", () => {
    expect(rules(`${angle}const s = @@( $(angle): 12px; );\n`)).toEqual(["value-and-registered-syntax"]);
  });

  test("a word where a colour was registered", () => {
    expect(rules(`${colour}const s = @@( $(accent): 12px; );\n`)).toEqual(["value-and-registered-syntax"]);
  });

  test("the message names the syntax and the value", () => {
    const [finding] = of(`${angle}const s = @@( $(angle): 12px; );\n`);

    expect(finding.message).toContain("<angle>");
    expect(finding.message).toContain("12px");
  });

  test("inside a `@@keyframes` frame, which is where an animation stops moving", () => {
    const source = `${angle}const spin = @@keyframes( from { $(angle): 0deg; } to { $(angle): 12px; } );\n`;

    expect(rules(source)).toEqual(["value-and-registered-syntax"]);
  });

  describe("what it must not report", () => {
    test.each([
      ["the right type", `${angle}const s = @@( $(angle): 45deg; );\n`],
      ["a colour for a colour", `${colour}const s = @@( $(accent): #f05; );\n`],
      ["a plain custom property nothing registered", `const s = @@( --angle: 12px; );\n`],
      ["a CSS-wide keyword, which every property takes", `${angle}const s = @@( $(angle): inherit; );\n`],
      ["a `var()`, whose value is not known here", `${angle}const s = @@( $(angle): var(--x); );\n`],
      /**
       * Five a review measured as FALSE REPORTS, which is the one outcome this rule may not produce.
       */
      // `!important` on a custom property is valid CSS and is how a variable is made to win.
      ["a value with `!important`", `${angle}const s = @@( $(angle): 90deg !important; );\n`],
      ["and a colour with it", `${colour}const s = @@( $(accent): red !important; );\n`],
      // CSS allows space between `!` and the word, and the word in any case.
      ["`! IMPORTANT`, spaced and in capitals", `${angle}const s = @@( $(angle): 90deg ! IMPORTANT; );\n`],
      // CSS keywords are ASCII case-insensitive; the escape set was matched by exact case.
      ["a CSS-wide keyword in capitals", `${angle}const s = @@( $(angle): INHERIT; );\n`],
      ["one in mixed case", `${angle}const s = @@( $(angle): Inherit; );\n`],
      ["a `VAR()` in capitals, for the same reason", `${angle}const s = @@( $(angle): VAR(--x); );\n`],
      // A `<number-token>` may carry an exponent — css-syntax-3 §4.3.12. `1e2px` is 100px.
      ["a dimension in scientific notation", `${angle}const s = @@( $(angle): 1e2deg; );\n`],
      ["a negative exponent", `${angle}const s = @@( $(angle): 1.5e-2deg; );\n`],
    ])("%s", (_what, source) => {
      expect(rules(source)).toEqual([]);
    });

    /**
     * A long run of spaces inside a value, which the `!important` strip once read in quadratic time.
     *
     * Found by CodeQL on the PR: `/\s*!\s*important\s*$/` starts again at every space. Measured,
     * twice the spaces took four times as long — 40 000 took 2.5 s, on every check of the file.
     */
    test("a value with a long run of spaces is read in linear time", () => {
      const started = performance.now();

      rules(`${angle}const s = @@( $(angle): 1deg${" ".repeat(40000)}2deg; );\n`);

      expect(performance.now() - started).toBeLessThan(500);
    });

    /** A hole's value is not known here, and is refused for being one at all. */
    test("a hole, which this rule cannot read and `hole-not-allowed` refuses outright", () => {
      expect(rules(`${angle}const s = @@( $(angle): $(turn); );\n`)).toEqual(["hole-not-allowed"]);
    });

    test("a syntax with no matcher silences it, as it does for `initial-value`", () => {
      const list = `const t = @@property( syntax: "<transform-list>"; inherits: false; initial-value: none; );\n`;

      expect(rules(`${list}const s = @@( $(t): 12px; );\n`)).toEqual([]);
    });
  });
});

/**
 * **WHERE A SQUIGGLE ABOUT A HOLE LANDS, and two rules pointed at the wrong character.**
 *
 * `Finding` says it in its own doc: `at` is the author's offset OF THE FAULT and `length` is "the
 * offending text itself — the property name, the word in the value — never the whole declaration".
 * A wrong span sends a person to the wrong place, which is the one thing this package says it must
 * never do.
 *
 * And the data was already there. `HolePart` carries `at` and `length`, and its own note says why:
 * *"for a squiggle over the hole itself … it is what lets a rule about a hole's POSITION point at
 * the hole rather than at the declaration holding it."* `hole-as-a-custom-property-name` reads it.
 * `hole-in-a-named-block` did not — one question, two answers, which is this
 * repository's recurring fault.
 *
 * Measured, `@@font-face( src: url($(n)); )`:
 *
 *     at 43, length 1, covering "u"      the `u` of `url(`, one character, mid-word
 *
 * Both also stopped after the FIRST hole, so a block with two of them reported one — and the author
 * fixes it, re-runs, and meets the next.
 */
describe("a squiggle about a hole", () => {
  /** What the finding actually covers in the author's own text. */
  const covered = (source: string, one: { at: number; length: number }) => source.slice(one.at, one.at + one.length);

  describe("in a named block", () => {
    test.each([
      ["a hole inside a function", "const n = 1;\nconst a = @@font-face(\n  src: url($(n));\n);\n", "$(n)"],
      ["a hole as the whole value", "const n = 1;\nconst a = @@font-face(\n  src: $(n);\n);\n", "$(n)"],
      ["a longer name", "const weight = 1;\nconst a = @@font-face(\n  src: url($(weight));\n);\n", "$(weight)"],
      [
        "in @@property",
        'const n = 1;\nconst a = @@property(\n  syntax: "<color>";\n  inherits: false;\n  initial-value: $(n);\n);\n',
        "$(n)",
      ],
      ["in @@keyframes", "const n = 1;\nconst a = @@keyframes(\n  from { opacity: $(n); }\n);\n", "$(n)"],
    ])("%s is squiggled over the hole", (_what, source, hole) => {
      const [found] = checkSource(source, "/a.tsx").filter((one) => one.rule === "hole-in-a-named-block");

      expect(found).toBeDefined();
      expect(covered(source, found)).toBe(hole);
    });

    test("every hole is reported, not only the first", () => {
      const source =
        "const n = 1;\nconst m = 2;\nconst a = @@font-face(\n  src: url($(n));\n  font-weight: $(m);\n);\n";

      const found = checkSource(source, "/a.tsx").filter((one) => one.rule === "hole-in-a-named-block");

      expect(found).toHaveLength(2);
      expect(found.map((one) => covered(source, one))).toEqual(["$(n)", "$(m)"]);
    });

    test("and two holes in ONE declaration are two squiggles, because each must go", () => {
      const source = "const a1 = 1;\nconst b1 = 2;\nconst a = @@font-face(\n  src: url($(a1)) format($(b1));\n);\n";

      const found = checkSource(source, "/a.tsx").filter((one) => one.rule === "hole-in-a-named-block");

      expect(found.map((one) => covered(source, one))).toEqual(["$(a1)", "$(b1)"]);
    });
  });

  describe("glued to text", () => {
    test.each([
      ["a unit before it", "const w = 1;\nconst a = @@(\n  gap: 8px$(w);\n);\n", "$(w)"],
      ["a unit written after", "const w = 1;\nconst a = @@(\n  gap: $(w)px;\n);\n", "$(w)"],
      ["a longer name", "const spacing = 1;\nconst a = @@(\n  gap: $(spacing)px;\n);\n", "$(spacing)"],
    ])("%s is squiggled over the hole", (_what, source, hole) => {
      const found = checkSource(source, "/a.tsx", { tolerant: true }).filter((one) => one.rule === "hole-not-allowed");

      expect(found).toHaveLength(1);
      expect(covered(source, found[0])).toBe(hole);
    });

    test("every glued hole is reported", () => {
      const source = "const w = 1;\nconst h = 2;\nconst a = @@(\n  margin: $(w)px $(h)px;\n);\n";

      const found = checkSource(source, "/a.tsx", { tolerant: true }).filter((one) => one.rule === "hole-not-allowed");

      expect(found.map((one) => covered(source, one))).toEqual(["$(w)", "$(h)"]);
    });
  });

  /**
   * And the invariant under all of it, asked of every rule at once: a finding is inside the file and
   * covers something. A zero-width squiggle is a mark nobody can see.
   */
  test("every finding is inside the file and covers at least one character", () => {
    const sources = [
      "const a = @@(\n  flex-dirction: row;\n  color: bleu;\n  gap: 8pxx;\n);\n",
      "const w = 1;\nconst a = @@(\n  gap: 8px$(w);\n  color: var($(w));\n);\n",
      "const a = @@(\n  @medai (min-widht: 40rem) { color: red; }\n  -wdebkit-line-clamp: 3;\n);\n",
      "const n = 1;\nconst a = @@font-face(\n  src: url($(n));\n);\n",
      "const a = @@(\n  // a note\n  &:HOVER { color: RED; }\n);\n",
    ];

    for (const source of sources) {
      for (const one of checkSource(source, "/a.tsx")) {
        expect(one.at, `${one.rule} starts before the file`).toBeGreaterThanOrEqual(0);
        expect(one.at + one.length, `${one.rule} runs past the end`).toBeLessThanOrEqual(source.length);
        expect(one.length, `${one.rule} has a zero-width squiggle`).toBeGreaterThan(0);
      }
    }
  });
});
