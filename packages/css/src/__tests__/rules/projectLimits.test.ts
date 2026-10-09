import { type Config } from "../../config/config";
import { checkBlock } from "../../compiler/rules";
import { describe, expect, test } from "vitest";
import { findBlocks } from "../../compiler/scan";
import { kind } from "../../config/declared";
import { readBlock } from "../../compiler/read";
import { rulesWith } from "./helpers";

/**
 * A colour written out where the project takes colours only from its own variables.
 *
 * Asked for by the user: *"za boje moze reci da hoce samo kroz tokene i variable da radi, nece
 * hardcoded values."* A closed list of every permitted colour is not that — a palette is fifty
 * values that change, and pinning them in a property's type puts it in two places.
 *
 * **This is the half a type cannot do.** Sixty-three properties accept a colour; forty say so in
 * their grammar and the generated types refuse a literal there. The other twenty-three are composite
 * — their value is `string | number`, because a union narrow enough to refuse `red` would refuse
 * `4px solid red` as well. So this reads those, and only those: one mechanism per property.
 */
describe("a colour written out, where the project said variables only", () => {
  const ONLY: Config = { properties: { "<color>": { hardcoded: false } } };

  test.each([
    ["a named colour inside a shorthand", "  border-left: 4px solid red;"],
    ["a hex", "  box-shadow: 0 1px 2px #00000022;"],
    ["a colour function", "  background: linear-gradient(rgb(0 0 0), white);"],
  ])("%s is reported", (_what, css) => {
    expect(rulesWith(css, ONLY)).toEqual(["hardcoded-not-allowed"]);
  });

  test("a variable is what it is asking for, and says nothing", () => {
    // Declared, because `unknown-token` would otherwise speak about the path and this test would
    // be measuring that rule instead of this one.
    const declared: Config = { ...ONLY, tokens: { $color: kind("color", { accent: { main: "#10b981" } }) } };

    expect(rulesWith("  border-left: 4px solid $color.accent.main;", declared)).toEqual([]);
  });

  test("`currentcolor` and `var()` go in, because neither is a colour somebody wrote out", () => {
    expect(rulesWith("  border-left: 4px solid currentcolor;", ONLY)).toEqual([]);
    expect(rulesWith("  border-left: 4px solid var(--brand);", ONLY)).toEqual([]);
  });

  /**
   * A property whose grammar SAYS it takes a colour is read HERE TOO, and used not to be.
   *
   * This asserted the opposite, and its reason was *the types refuse it, and saying it twice for one
   * mistake is the fault this repository keeps finding*. The first half was true of the checker and
   * false of the BUILD: vite and esbuild run these rules and never type-check a block, so `color:
   * red` compiled. The count was never two — it was one in the checker and ZERO where it shipped.
   *
   * Both speak now and `inOrder` drops the compiler's word, which is what the second half of that
   * reason was really asking for.
   */
  test("a property whose grammar says it takes a colour is read here too", () => {
    expect(rulesWith("  color: red;", ONLY)).toEqual(["hardcoded-not-allowed"]);
    expect(rulesWith("  background-color: #fff;", ONLY)).toEqual(["hardcoded-not-allowed"]);
  });

  test("a property that takes no colour has nothing to find", () => {
    expect(rulesWith("  padding: 8px;", ONLY)).toEqual([]);
    expect(rulesWith('  grid-template-areas: "a b";', ONLY)).toEqual([]);
  });

  test("and with no `hardcoded: false` anywhere, none of this happens", () => {
    expect(rulesWith("  border-left: 4px solid red;", {})).toEqual([]);
  });
});

/**
 * `units` constrains a FAMILY, because a project that says "px and rem" is talking about lengths.
 *
 * The flat list said *every unit in CSS and nothing else*, and measured, that reported four things
 * nobody writing `units: ["px", "rem"]` means:
 *
 *     transition: all 200ms ease        ms is a time
 *     width: 50%                        % is a percentage
 *     rotate: 45deg                     deg is an angle
 *     grid-template-columns: 1fr        fr is a flex
 *
 * So a project could not state the one rule it actually wanted without enumerating the units of five
 * families it had no opinion about. A family it does not name is a family it does not constrain,
 * which is what makes the setting sayable.
 *
 * The families come from `UNIT_TYPE`, generated with an assertion that every unit lands in exactly
 * one — so a unit CSS adds fails the build until somebody says what it is.
 */
describe("units, by family", () => {
  const under = (units: Config["units"], css: string) => {
    const source = `<div className={@@(\n${css}\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    return checkBlock(read.block, { config: { units } }).map((one) => one.rule);
  };

  const lengths = { length: ["px", "rem"] } as const;

  test.each([
    ["a time", "  transition: all 200ms ease;"],
    ["a percentage", "  width: 50%;"],
    ["an angle", "  rotate: 45deg;"],
    ["a flex", "  grid-template-columns: repeat(3, 1fr);"],
    ["a resolution", "  --a: 2dppx;"],
    ["a frequency", "  --a: 40hz;"],
  ])("%s is untouched when only lengths were constrained", (_what, css) => {
    expect(under(lengths, css)).toEqual([]);
  });

  test.each([
    ["one this project allows", "  padding: 8px;", []],
    ["the other one it allows", "  padding: 1rem;", []],
    ["one it does not", "  padding: 2em;", ["unit-not-allowed"]],
    ["one it does not, inside a call", "  width: calc(100% - 4em);", ["unit-not-allowed"]],
    ["a bare zero, which has no family at all", "  padding: 0;", []],
  ])("%s", (_what, css, expected) => {
    expect(under(lengths, css)).toEqual(expected);
  });

  test("a second family is constrained independently", () => {
    const both = { length: ["px"], time: ["ms"] } as const;

    expect(under(both, "  transition: all 200ms ease;")).toEqual([]);
    expect(under(both, "  transition: all 2s ease;")).toEqual(["unit-not-allowed"]);
    expect(under(both, "  rotate: 45deg;")).toEqual([]);
  });

  test("the message names the family, so the fix is the one the author meant", () => {
    const source = `<div className={@@(\n  padding: 2em;\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    const [found] = checkBlock(read.block, { config: { units: lengths } });

    expect(found.message).toContain("`em` is a length this project does not use");
    expect(found.message).toContain("px, rem");
  });

  test("an empty list for a family permits nothing of it, which is how a family is banned outright", () => {
    expect(under({ angle: [] }, "  rotate: 45deg;")).toEqual(["unit-not-allowed"]);
    expect(under({ angle: [] }, "  padding: 8px;")).toEqual([]);
  });
});

/**
 * A literal where the project said that KIND comes from its variables — the half the build sees.
 *
 * The types refused `padding-left: 8px` and the RULE said nothing, which read as a division of
 * labour and was a hole. Measured, asking the rules alone — which is all vite and esbuild ever run,
 * since neither type-checks a block:
 *
 *     padding-left: 8px       []                        the build compiled it
 *     width: 200px            []                        and this
 *     color: red              []                        and this
 *     border: 1px solid red   [hardcoded-not-allowed]     only the composite was caught
 *
 * So a project could set `hardcoded: false`, watch `ramonda-css check` refuse a file, and watch the
 * dev server serve it. One rule, three consumers, and two of them silent — the repository's
 * recurring fault, found once more by asking what a setting means.
 *
 * The rule speaks for every property now and `inOrder` drops the compiler's duplicate, which is the
 * same answer `unknown-token` got. It also fixes the message: `Narrowed<never, Token<…>>` names
 * neither the project nor the config file, and this names both.
 *
 * **A CALL is an escape hatch and is not read into.** `calc($space.md * 2)` has a `2` in it that is
 * not a hardcoded length, and nothing in this rule can tell it from one that is. `var()`, a bare
 * `0`, the CSS-wide keywords and a property's own keywords are all left alone for the same reason:
 * none of them is a value somebody wrote out instead of reaching for a token.
 */
describe("a literal where the project said that kind comes from variables", () => {
  /** Declared, because `unknown-token` would otherwise speak about the `$` paths below. */
  const VARIABLES = {
    space: kind("length", { gutter: "16px" }),
    motion: kind("time", { quick: "120ms" }),
  };

  const under = (selector: string, decl: string) =>
    checkBlock(readBlock(`@@(\n  ${decl};\n)`, 2, "C.tsx").block, {
      config: { tokens: VARIABLES, properties: { [selector]: { hardcoded: false } } },
    }).map((one) => one.rule);

  test.each([
    ["a longhand", "padding-left: 8px"],
    ["one reached only through the kind", "width: 200px"],
    ["a negative length", "margin-top: -8px"],
    ["a shorthand with several", "padding: 8px 16px"],
    ["a percentage, which this property also takes", "padding-left: 50%"],
  ])("%s is reported", (_what, decl) => {
    expect(under("<length>", decl)).toEqual(["hardcoded-not-allowed"]);
  });

  test.each([
    ["a bare zero, which needs no unit in CSS", "padding-left: 0"],
    ["a token, which is the point", "padding-left: $space.gutter"],
    ["`var()`, the escape CSS itself provides", "padding-left: var(--x)"],
    ["a CSS-wide keyword", "padding-left: inherit"],
    ["the property's own keyword", "width: auto"],
    ["a call, which may hold a variable and arithmetic", "padding-left: calc(100% - 8px)"],
  ])("%s is silent", (_what, decl) => {
    expect(under("<length>", decl)).toEqual([]);
  });

  test("a hole holds no literal this rule can read", () => {
    expect(under("<length>", "padding-left: $(gap)")).toEqual(["hole-not-allowed"]);
  });

  test("another kind, said on its own selector", () => {
    expect(under("<time>", "transition-duration: 200ms")).toEqual(["hardcoded-not-allowed"]);
    expect(under("<time>", "transition-duration: $motion.quick")).toEqual([]);
    // A length is not a time, and this selector said nothing about lengths.
    expect(under("<time>", "padding-left: 8px")).toEqual([]);
  });

  test("a property exempting itself by name is left alone", () => {
    const config: Config = {
      properties: { "<length>": { hardcoded: false }, "border-radius": { hardcoded: true } },
    };
    const of = (decl: string) =>
      checkBlock(readBlock(`@@(\n  ${decl};\n)`, 2, "C.tsx").block, { config }).map((one) => one.rule);

    expect(of("border-radius: 4px")).toEqual([]);
    expect(of("padding-left: 8px")).toEqual(["hardcoded-not-allowed"]);
  });

  test("the message names the project and the way out", () => {
    const [found] = checkBlock(readBlock(`@@(\n  padding-left: 8px;\n)`, 2, "C.tsx").block, {
      config: { properties: { "<length>": { hardcoded: false } } },
    });

    expect(found.message).toContain("`8px`");
    expect(found.message).toContain("ramonda.css.ts");
    expect(found.message).toContain("hardcoded");
  });

  /**
   * A percentage exempted on its own selector exempts PERCENTAGES. The rule was asked per property,
   * and `width` is both kinds, so `"<percentage>": { hardcoded: true }` — sorted after `<length>` —
   * let `12px` through as well. Measured on a scaffolded project. Each value is asked about its own
   * kind now; `<length>` still reaches a percentage, as above, until `<percentage>` says otherwise.
   */
  test("`<percentage>` set free frees the percentages and nothing else", () => {
    const config: Config = {
      tokens: VARIABLES,
      properties: { "<length>": { hardcoded: false }, "<percentage>": { hardcoded: true } },
    };
    const of = (decl: string) =>
      checkBlock(readBlock(`@@(\n  ${decl};\n)`, 2, "C.tsx").block, { config }).map((one) => one.rule);

    expect(of("width: 100%")).toEqual([]);
    expect(of("width: 12px")).toEqual(["hardcoded-not-allowed"]);
    expect(of("padding: 50% 8px")).toEqual(["hardcoded-not-allowed"]);
    expect(of("padding: $space.gutter 50%")).toEqual([]);
  });

  test("and the message says which kind the value is, not every kind the property takes", () => {
    const [found] = checkBlock(readBlock(`@@(\n  width: 12px;\n)`, 2, "C.tsx").block, {
      config: { properties: { "<length>": { hardcoded: false } } },
    });

    expect(found.message).toContain("`12px` is a length written out");
  });

  /**
   * The token that already holds the value, named — the fix in one step, for an author and for a
   * tool writing the code. Asked for by the user, for a config strict enough that an assistant
   * writing a page cannot drift off the scale.
   */
  test("a value a token already holds names that token", () => {
    const config: Config = {
      tokens: {
        $space: kind("length", { s: "8px", m: "12px", gutter: "12px" }),
        $color: kind("color", { accent: "light-dark(#7a4fbf, #b18ae6)", line: "#ece3f5" }),
      },
      properties: { "<length>": { hardcoded: false }, "<color>": { hardcoded: false } },
    };
    const message = (decl: string) =>
      checkBlock(readBlock(`@@(\n  ${decl};\n)`, 2, "C.tsx").block, { config }).find(
        (one) => one.rule === "hardcoded-not-allowed",
      )?.message ?? "";

    expect(message("margin-top: 12px")).toContain("`$space.m` or `$space.gutter`");
    expect(message("color: #ECE3F5")).toContain("`$color.line`");
    // Either half of a pair: the value a reader sees in one scheme is still that token's.
    expect(message("color: #7a4fbf")).toContain("`$color.accent`");
    // Inside a composite, through the colour walk.
    expect(message("border-left: 4px solid #ece3f5")).toContain("`$color.line`");
    // And no token holding it is the old advice.
    expect(message("margin-top: 13px")).toContain("Declare it in");
  });

  test("and with no `hardcoded: false` anywhere, every one of these is silent", () => {
    const of = (decl: string) => checkBlock(readBlock(`@@(\n  ${decl};\n)`, 2, "C.tsx").block, {}).map((o) => o.rule);

    for (const decl of ["padding-left: 8px", "width: 200px", "transition-duration: 200ms"]) {
      expect(of(decl)).toEqual([]);
    }
  });
});

/**
 * The two ways a literal still reached the page after `hardcoded: false` was said.
 *
 * **A colour LONGHAND did not reach the build.** The dimension half was extended and the colour
 * half was not: `literalNotAllowed` skipped a property whose grammar says `<color>` as *the types'
 * to refuse*, which was true of the checker and false of vite and esbuild. Forty properties, and
 * `color: red` the first of them.
 *
 * **And a custom property set in the block was an open door.** `--own: red; color: var(--own)` is
 * two declarations this compiler reads, and neither was looked at — so the rule a project turned on
 * could be walked around in one line, by accident as easily as on purpose.
 *
 * A custom property has NO KIND, which is what makes this narrow: a bare `3` is not a length and
 * `"red"` inside quotes is not a colour. Only a value that can be nothing else is reported — a hex,
 * a colour function, a named colour, or a number carrying a unit.
 */
describe("a literal that reached the page anyway", () => {
  const ONLY: Config = {
    tokens: { $brand: kind("color", { main: "#10b981" }), $space: kind("length", { sm: "8px" }) },
    properties: { "<color>": { hardcoded: false }, "<length>": { hardcoded: false } },
  };
  const of = (decl: string) =>
    checkBlock(readBlock(`@@(\n  ${decl};\n)`, 2, "C.tsx").block, { config: ONLY }).map((one) => one.rule);

  test.each([
    ["a colour longhand, which the build never saw", "color: red"],
    ["a hex in one", "background-color: #ff0000"],
    ["a colour function", "border-top-color: rgb(255 0 0)"],
  ])("%s is reported", (_what, decl) => {
    expect(of(decl)).toEqual(["hardcoded-not-allowed"]);
  });

  test.each([
    ["a colour put into a custom property", "--own: red"],
    ["a hex put into one", "--own: #ff0000"],
    ["a length put into one", "--gap: 8px"],
  ])("%s is reported", (_what, decl) => {
    expect(of(decl)).toEqual(["hardcoded-not-allowed"]);
  });

  test("the whole bypass, which is what this is for", () => {
    expect(of("--own: red; color: var(--own)")).toEqual(["hardcoded-not-allowed"]);
  });

  test.each([
    ["a token, which is the point", "--own: $brand.main"],
    ["a colour word inside a STRING, which is text", '--label: "red"'],
    ["a bare number, which has no kind at all", "--n: 3"],
    ["a keyword", "--mode: dark"],
    ["`var()`, the escape CSS itself provides", "--own: var(--theme)"],
    ["a zero", "--gap: 0"],
  ])("%s is silent", (_what, decl) => {
    expect(of(decl)).toEqual([]);
  });

  /** And none of it happens to a project that said nothing. */
  test("with no `hardcoded: false`, every one of these is silent", () => {
    const plain = (decl: string) =>
      checkBlock(readBlock(`@@(\n  ${decl};\n)`, 2, "C.tsx").block, {}).map((one) => one.rule);

    for (const decl of ["color: red", "--own: red", "--gap: 8px"]) expect(plain(decl)).toEqual([]);
  });
});

/**
 * Three settings the TYPES enforced and the BUILD did not.
 *
 * Review pass 4 swept every setting against every consumer, which is the shape four of this
 * session's faults had. Vite and esbuild run these rules over a block and never type-check it, so a
 * setting that only reaches the types is a setting the dev server ignores:
 *
 *     properties["*"].units         padding-left: 2rem    checker refuses, build serves
 *     properties["z-index"].values  z-index: 5            checker refuses, build serves
 *     properties["*"].shorthand     padding: 8px          checker refuses, build serves
 *
 * The other three — the project-wide `units`, `arity` and `hardcoded: false` — already spoke in both.
 * So half the config was enforced everywhere and half in one place, with nothing saying which.
 *
 * The precedent is the one `hardcoded: false` set: *a project could watch `ramonda-css check` refuse a
 * file and watch the dev server serve it.* `inOrder` drops the compiler's word where these speak, so
 * an author still meets one report rather than two.
 */
describe("a setting the types enforced and the build did not", () => {
  const under = (config: Config, css: string) =>
    checkBlock(readBlock(`@@(\n  ${css};\n)`, 2, "C.tsx").block, { config }).map((one) => one.rule);

  describe("a unit said on a property", () => {
    const config: Config = { properties: { "*": { units: ["px"] } } };

    test.each([
      ["a unit the project does not use", "padding-left: 2rem"],
      ["one inside a call", "width: calc(100% - 2rem)"],
    ])("%s is reported", (_what, css) => {
      expect(under(config, css)).toEqual(["unit-not-allowed"]);
    });

    /**
     * A family the list says nothing about is not constrained — found by MUTATION.
     *
     * Review pass 7 broke `const family = UNIT_TYPE[unit]` on purpose and the whole suite stayed
     * green: one case named a time, and a time is not a length, so it would have been silent either
     * way. What was never asked is whether a unit of ANOTHER family is silent because of its family
     * or by accident — so all four are here, one per family a project might meet.
     */
    test.each([
      ["a unit it does use", "padding-left: 8px"],
      ["a bare zero, which has no unit", "padding-left: 0"],
      ["a time, where the list holds lengths", "transition-duration: 200ms"],
      ["an angle", "rotate: 45deg"],
      ["a percentage, which is its own family", "width: 50%"],
      ["a flex", "grid-template-columns: repeat(3, 1fr)"],
    ])("%s is silent", (_what, css) => {
      expect(under(config, css)).toEqual([]);
    });

    test("one property's units do not reach another", () => {
      const only: Config = { properties: { "letter-spacing": { units: ["em"] } } };

      expect(under(only, "letter-spacing: 2px")).toEqual(["unit-not-allowed"]);
      expect(under(only, "padding-left: 2px")).toEqual([]);
    });
  });

  describe("a closed list of values", () => {
    const config: Config = { properties: { "z-index": { values: [0, 1, 10] } } };

    test.each([
      ["a value outside it", "z-index: 5"],
      ["a keyword outside it", "z-index: auto"],
    ])("%s is reported", (_what, css) => {
      expect(under(config, css)).toEqual(["value-not-allowed"]);
    });

    test.each([
      ["one from the list", "z-index: 10"],
      ["`var()`, the escape CSS provides", "z-index: var(--layer)"],
      ["a CSS-wide keyword", "z-index: inherit"],
      ["another property entirely", "order: 5"],
    ])("%s is silent", (_what, css) => {
      expect(under(config, css)).toEqual([]);
    });

    /**
     * A QUOTED value is `string-not-allowed`'s, and this one stayed out of it.
     *
     * **Reported by the user**, who read the two together and saw a contradiction: the type offers
     * `"1"` and the rule refuses it. Measured, `z-index: "1"` gave two findings, and the second was
     * worse than redundant — *takes only 0, 1, 10 … and this is `"1"`* names a value that IS in the
     * list. The fault is the quoting, not the number.
     *
     * The string spellings in the type are not a widening of what the project permitted. A block is
     * CSS, so `z-index: 1` reaches the type as the string `"1"` — `a closed list` above was written
     * for exactly that, because a list of numbers used to refuse its own permitted values. A hole
     * may hand over either, and both mean the same declaration.
     */
    test("a quoted value is reported once, by the rule about quotes", () => {
      expect(under(config, 'z-index: "1"')).toEqual(["string-not-allowed"]);
    });

    test("and a quoted value that is not in the list is still just the quoting", () => {
      expect(under(config, 'z-index: "5"')).toEqual(["string-not-allowed"]);
    });

    test("the message names the list", () => {
      expect(under(config, "z-index: 5")).toEqual(["value-not-allowed"]);
      const [found] = checkBlock(readBlock(`@@(\n  z-index: 5;\n)`, 2, "C.tsx").block, { config });

      expect(found.message).toContain("0, 1, 10");
    });
  });

  /**
   * A runtime value in a declaration, which no project takes.
   *
   * It used to be a setting — `"*": { holes: false }` — and the setting is gone, because what
   * replaced the hole replaced it everywhere: `match` for variation that can be enumerated, and
   * `@@property` for a value that really comes from data. A project cannot opt back into a cost
   * that nothing needs to pay.
   */
  describe("a runtime value in a declaration", () => {
    const none: Config = {};

    test.each([
      ["a whole value", "color: $(this.brand)"],
      ["part of one", "border-left: 4px solid $(this.brand)"],
      ["a custom property's value", "--brand: $(this.brand)"],
    ])("%s is reported", (_what, css) => {
      expect(under(none, css)).toEqual(["hole-not-allowed"]);
    });

    /** With no config at all, which is what a project that never wrote one has. */
    test("and it is reported with no `ramonda.css.ts` in the project", () => {
      expect(checkBlock(readBlock("@@(\n  color: $(this.brand);\n)", 2, "C.tsx").block).map((one) => one.rule)).toEqual(
        ["hole-not-allowed"],
      );
    });

    test.each([
      ["a written value", "color: red"],
      ["a `var()` of its own", "color: var(--brand)"],
    ])("%s is silent", (_what, css) => {
      expect(under(none, css)).toEqual([]);
    });

    /**
     * Asserted as *not this rule* rather than as nothing at all: a fixture that declares no
     * variables trips `unknown-token`, which is a different rule being right about a different
     * thing. What matters here is that a bare `$group.…` is a `VariablePart` and never a hole.
     */
    test("a token written bare is not a hole", () => {
      expect(under(none, "color: $color.brand")).not.toContain("hole-not-allowed");
    });

    /**
     * The braces decide, not what is inside them. Measured: `color: $color.brand` parses as a
     * `variable` and `color: $($color.brand)` as a `hole` — the same variable, and only the second
     * set a custom property on the element. So the second is reported and the fix is to drop the
     * braces.
     */
    test("the same variable IN braces is a hole, and is reported", () => {
      expect(under(none, "color: $($.color.brand)")).toEqual(["hole-not-allowed"]);
    });

    test("a condition is not a hole, so a variant is still sayable", () => {
      expect(under(none, "color: red;\n  when $(this.on) { color: blue; }")).toEqual([]);
    });

    /** And the other replacement: every arm is a literal, so a match writes nothing on the element. */
    test("a match is not a hole either", () => {
      expect(under(none, "color: match $(this.tone) {\n    hot => red;\n    _ => blue;\n  }")).toEqual([]);
    });

    test("and it reaches inside a nested rule", () => {
      expect(under(none, "&:hover { color: $(this.brand); }")).toEqual(["hole-not-allowed"]);
    });

    /**
     * **A hole can stand in a VALUE and nowhere else**, which is what makes this rule the whole
     * answer rather than one of five.
     *
     * `runtimeValuesIn` walks declaration values only, so if a hole could stand in a selector, an
     * at-rule's query or a property name, a block carrying one would pass. Measured: the reader
     * refuses all four outright, so there is no fifth place to walk.
     */
    test.each([
      ["a selector", "&:$(this.state) { color: red; }"],
      ["an at-rule's query", "@media {this.q} { color: red; }"],
      ["a property name", "{this.prop}: red;"],
      ["a custom property's name", "--{this.name}: red;"],
    ])("a hole in %s is refused before any rule sees it", (_what, css) => {
      const source = `const x = @@( ${css} );`;

      expect(() => readBlock(source, source.indexOf("@@(") + 2, "x.tsx")).toThrow();
    });

    /**
     * **Correct CSS that LOOKS like a runtime value**, swept rather than reasoned about: a brace is
     * ordinary in a string, in a comment, in a `url()` and in the three things a block still holds.
     * A false report on any of them is a build that refuses valid CSS.
     */
    test.each([
      ["a brace in a string value", 'content: "$(a)";'],
      ["a brace in a comment", "padding: /* $(x) */ 8px;"],
      ["a brace in a url", 'background: url("a{b}.png");'],
      ["a brace in a grid-area string", 'grid-template-areas: "{a} $(b)";'],
      ["a match, which holds braces", "color: match $(t) {\n    a => red;\n    _ => blue;\n  };"],
      ["a condition, which holds one", "when $(on) { color: red; }"],
      ["a spread, which holds one", "...$(base);"],
    ])("%s is not a runtime value", (_what, css) => {
      expect(under(none, css)).not.toContain("hole-not-allowed");
    });

    /** The message sends a person to both doors, because which one applies is theirs to know. */
    test("the message names `match` and `@@property`", () => {
      const [found] = checkBlock(readBlock("@@(\n  color: $(this.brand);\n)", 2, "C.tsx").block);

      expect(found.message).toContain("match");
      expect(found.message).toContain("@@property");
    });
  });

  describe("a shorthand switched off", () => {
    const config: Config = { properties: { "*": { shorthand: false }, padding: { shorthand: true } } };

    test.each([
      ["one the project switched off", "margin: 8px"],
      ["another", "background: red"],
    ])("%s is reported", (_what, css) => {
      expect(under(config, css)).toEqual(["shorthand-not-allowed"]);
    });

    test.each([
      ["the one it kept", "padding: 8px"],
      ["a longhand, which is the point", "margin-top: 8px"],
    ])("%s is silent", (_what, css) => {
      expect(under(config, css)).toEqual([]);
    });

    test("the message names longhands to write, and how many there are", () => {
      const [found] = checkBlock(readBlock(`@@(\n  margin: 8px;\n)`, 2, "C.tsx").block, { config });

      expect(found.message).toContain("margin-block");
      expect(found.message).toContain("7 more");
    });
  });

  /** And a project that said nothing gets none of it. */
  test("with no config, all three are silent", () => {
    for (const css of ["padding-left: 2rem", "z-index: 5", "margin: 8px"]) expect(under({}, css)).toEqual([]);
  });
});

/**
 * Two faults where the CLI and the BUNDLERS disagreed — review pass 6.
 *
 * Both consumers were asked the same question about the same file, which is the lens four of this
 * session's findings came through.
 *
 * ## A unit reported twice
 *
 * `units` at the top of the config and `units` inside `properties` are different mechanisms with one
 * name — the design review said so — and pass 4 gave the second one a rule. Setting both then
 * reported the same value twice. One value, one fault, one report.
 *
 * ## A property typo the build compiled
 *
 * The split was deliberate and half of it was right: a DASHED name — `flex-dirction` — gets
 * `unknown-property`, because TypeScript offers no *did you mean* for a quoted key; a plain name —
 * `dsiplay` — was left to `TS2561`, which says it better.
 *
 * It says it better in the CHECKER. The build runs no TypeScript, so `dsiplay: flex` and even
 * `zzz: flex` compiled into the stylesheet with nothing said anywhere. The rule speaks for both
 * now, and `inOrder` drops the compiler's word on the line — the same arrangement
 * `unknown-token` and `hardcoded: false` already have.
 */
describe("what the bundlers see and the checker saw", () => {
  const under = (css: string, config: Config = {}) =>
    checkBlock(readBlock(`@@(\n  ${css};\n)`, 2, "C.tsx").block, { config }).map((one) => one.rule);

  test("a unit is reported once, whichever settings are in play", () => {
    const both: Config = { units: { length: ["px"] }, properties: { "*": { units: ["px"] } } };

    expect(under("padding-left: 2rem", both)).toEqual(["unit-not-allowed"]);
    expect(under("padding-left: 2rem", { units: { length: ["px"] } })).toEqual(["unit-not-allowed"]);
    expect(under("padding-left: 2rem", { properties: { "*": { units: ["px"] } } })).toEqual(["unit-not-allowed"]);
  });

  test("two different units in one value are still two faults", () => {
    const both: Config = { units: { length: ["px"] }, properties: { "*": { units: ["px"] } } };

    expect(under("padding: 2rem 3em", both)).toEqual(["unit-not-allowed", "unit-not-allowed"]);
  });

  test.each([
    ["a plain name, which the checker left to TypeScript", "dsiplay: flex"],
    ["one that is near nothing", "zzz: flex"],
    ["a dashed name, which always spoke", "flex-dirction: row"],
    ["another", "padding-lefft: 8px"],
  ])("%s is reported, so the build sees it", (_what, css) => {
    expect(under(css)).toContain("unknown-property");
  });

  test("and the suggestion is still there for a plain name", () => {
    const [found] = checkBlock(readBlock(`@@(\n  dsiplay: flex;\n)`, 2, "C.tsx").block, {});

    expect(found.message).toContain("display");
  });

  test.each([
    ["a real property", "display: flex"],
    ["a vendor prefix", "-webkit-line-clamp: 3"],
    ["a custom property", "--row-height: 2rem"],
    ["one CSS added after our table", "-moz-osx-font-smoothing: grayscale"],
  ])("%s is silent", (_what, css) => {
    expect(under(css)).toEqual([]);
  });
});

/**
 * Every rule a project's CONFIG turns on, measured INSIDE a nested rule.
 *
 * Found by coverage, and it was six lines in a row: each of these rules walks a block and recurses
 * into a nested one, and not one of those recursions had ever run in a test. The rules are the six
 * review pass 4 added and reworked — the whole config-driven half — so the question the gap asked
 * was whether a project's settings reach `&:hover { … }` at all, or stop at the top level where
 * every test happened to put them.
 *
 * **They reach it, at any depth**, which is what these assert. A nested rule is where a hover
 * colour and a focus ring are written, so a `hardcoded: false` that stopped at the top level would
 * have exempted the declarations most likely to hold a hardcoded one.
 */
describe("a config rule inside a nested rule", () => {
  const config: Config = {
    /**
     * `time` as well as `length`, so a unit can be refused on a property whose KIND this config does
     * not also take from variables — otherwise `hardcoded-not-allowed` answers first and the unit
     * rules below would be asserting something else's presence. See "a declaration that breaks more
     * than one of a project's rules".
     */
    units: { length: ["px"], time: ["ms"] },
    properties: {
      "<color>": { hardcoded: false },
      "<length>": { hardcoded: false },
      "z-index": { values: [0, 1] },
      padding: { shorthand: false },
      "transition-duration": { units: ["ms"] },
    },
    tokens: { $color: kind("color", { primary: { main: "#3b82f6" } }) },
  };

  const under = (css: string) => {
    const source = `<div className={@@(\n${css}\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    return checkBlock(read.block, { config }).map((one) => one.rule);
  };

  test.each([
    ["a colour written out", "color: #ff0000;", "hardcoded-not-allowed"],
    ["a length written out", "padding-top: 8px;", "hardcoded-not-allowed"],
    ["a value outside the closed list", "z-index: 5;", "value-not-allowed"],
    ["a shorthand switched off", "padding: 8px;", "shorthand-not-allowed"],
    ["a unit this property does not take", "transition-duration: 2s;", "unit-not-allowed"],
    ["a unit the project does not take", "animation-duration: 2s;", "unit-not-allowed"],
  ])("%s is reported at the top level, one deep and two deep", (_what, css, rule) => {
    // The top level first, so a config that reached nothing would not pass the two below for free.
    expect(under(`  ${css}`)).toContain(rule);
    expect(under(`  &:hover {\n    ${css}\n  }`)).toContain(rule);
    expect(under(`  &:hover {\n    &:focus {\n      ${css}\n    }\n  }`)).toContain(rule);
  });

  /**
   * A custom property nested too, which is the walk `dimensionNotAllowed` has of its own.
   *
   * `--own: red; color: var(--own)` walks around `hardcoded: false` in one line, and a nested rule is
   * exactly where somebody would set one.
   */
  test("a custom property holding a forbidden value is read inside a nested rule", () => {
    expect(under(`  &:hover {\n    --own: #ff0000;\n  }`)).toContain("hardcoded-not-allowed");
  });

  /**
   * The two silences, which are DELIBERATE and are asserted so they stay that way.
   *
   * A bare zero needs no unit in CSS and is nobody's hardcoded value; a non-colour in a colour
   * property is not what `hardcoded: false` is for, and the types refuse it anyway.
   */
  test.each([
    ["a bare zero", "padding-top: 0;"],
    ["a value that is not of the forbidden kind", "color: 2px;"],
    ["a variable, which is the point of the setting", "color: $color.primary.main;"],
    ["a `var()` call", "color: var(--anything);"],
  ])("%s stays silent inside a nested rule too", (_what, css) => {
    expect(under(`  &:hover {\n    ${css}\n  }`)).toEqual([]);
  });
});

/**
 * ONE mistake, ONE finding — when a project narrows several things at once.
 *
 * `hardcoded-not-allowed` is the widest of the config's rules: it fires on any written-out value of a
 * kind taken from variables, so it landed beside every narrower rule that also fired. Measured under
 * a config narrowing units, shorthands, arity and a kind at the same time:
 *
 *     letter-spacing: 2rem     hardcoded-not-allowed + unit-not-allowed
 *     margin: 8px              shorthand-not-allowed + hardcoded-not-allowed
 *     padding-left: 1px 2px    too-many-values + hardcoded-not-allowed
 *
 * Each is one gesture by the author, and two reports for one gesture is what the whole `inOrder`
 * machinery exists to stop on the other side of the tool.
 *
 * **The order is the order the fixes nest in**, which is what makes it one principle rather than a
 * table of pairs. A declaration is decided outside in: WHICH property, then HOW MANY values, then
 * WHERE the value comes from, then HOW it is spelt. Each later answer is a detail of the earlier
 * one, so the outermost unanswered question is the one to ask.
 *
 *     shorthand-not-allowed   the property itself
 *     too-many-values         how many values it takes
 *     hardcoded-not-allowed     where the value comes from
 *     unit-not-allowed        how that value is spelt
 *
 * Reading `unit-not-allowed` first is the case that shows why: it sends the author to `2px`, which
 * their own config still refuses — a round trip that ends where `hardcoded-not-allowed` would have
 * started them.
 */
describe("a declaration that breaks more than one of a project's rules", () => {
  const config: Config = {
    units: { length: ["px"] },
    properties: {
      "<length>": { hardcoded: false },
      "<color>": { hardcoded: false },
      "*": { shorthand: false },
      // Exempt, so `too-many-values` can be reached without `shorthand-not-allowed` answering first.
      padding: { shorthand: true, arity: 1 },
      "z-index": { values: [0, 1] },
    },
    tokens: { $space: kind("length", { gutter: "16px" }) },
  };

  const under = (css: string) => {
    const source = `<div className={@@(\n${css}\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    return checkBlock(read.block, { config }).map((one) => one.rule);
  };

  test.each([
    ["a forbidden unit on a kind taken from variables", "  letter-spacing: 2rem;", "hardcoded-not-allowed"],
    ["a shorthand that is switched off", "  margin: 8px;", "shorthand-not-allowed"],
    ["more values than the project allows", "  padding: 1px 2px;", "too-many-values"],
  ])("%s is one finding, the outermost", (_what, css, rule) => {
    expect(under(css)).toEqual([rule]);
  });

  /**
   * A value outside a closed list, written in a unit the project also refuses.
   *
   * Its own config, because the fixture above takes every length from variables and
   * `hardcoded-not-allowed` answers first there. Both rules here are the project's own and both are
   * about one word, so the list is the question to ask: the unit is a detail of a value that is not
   * on the list. Reading the unit first sends the author to `2px`, which the list still refuses —
   * the round trip the note above describes for `hardcoded-not-allowed`.
   */
  test("a value outside a closed list, in a forbidden unit, is one finding", () => {
    const narrow: Config = {
      units: { length: ["px"] },
      properties: { width: { values: ["8px", "12px"] } },
    };
    const source = "<div className={@@(\n  width: 2rem;\n)}>x</div>";
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });

    expect(checkBlock(read.block, { config: narrow }).map((one) => one.rule)).toEqual(["value-not-allowed"]);
  });

  /** Each alone is untouched — the collapse may not cost a report that stands on its own. */
  test.each([
    ["a colour written out", "  color: #ff0000;", "hardcoded-not-allowed"],
    ["a value outside a closed list", "  z-index: 5;", "value-not-allowed"],
    ["a shorthand with a variable in it", "  margin: $space.gutter;", "shorthand-not-allowed"],
  ])("%s is still reported on its own", (_what, css, rule) => {
    expect(under(css)).toEqual([rule]);
  });

  /** And two faults in two DECLARATIONS are still two, which is the line this must not cross. */
  test("a second declaration keeps its own finding", () => {
    expect(under("  margin: 8px;\n  color: #ff0000;")).toEqual(["shorthand-not-allowed", "hardcoded-not-allowed"]);
  });

  /** A unit refused where the kind is NOT taken from variables still says which unit. */
  test("a forbidden unit alone still names the unit", () => {
    expect(under("  transition-duration: 2s;")).toEqual([]);
    expect(under("  letter-spacing: $space.gutter;")).toEqual([]);
  });
});

/**
 * A word one longhand of a shorthand has no place for, which makes the WHOLE declaration invalid.
 *
 * CSS drops a whole declaration when any part of it is invalid. `place-items: start space-between`
 * sets nothing in any browser, `justify-items` having no `space-between` — so the author wrote a
 * line that does nothing, silently, and the splitter refuses it for the same reason. Measured in
 * Chromium, Firefox and WebKit before the rule was written.
 *
 * Every shape below is PLANTED and run, never reasoned about from the code — see
 * `.claude/skills/writing-a-static-rule`.
 */
describe("a word the longhand has no place for", () => {
  const found = (css: string) => {
    const source = `<div className={@@(\n${css}\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    return checkBlock(read.block, {}).map((one) => one.rule);
  };

  /**
   * `left` and `legacy` are `justify-items` words; `anchor-center` is an `align-items` word. Written
   * in this order the align slot gets one it has no place for, so the declaration is invalid and
   * every engine ignores it — measured in Chromium, Firefox and WebKit.
   *
   * These are the values the rule EXISTS for. The first plants written here were
   * `place-items: start space-between`, which `unknown-value` already names because `space-between`
   * is not a `place-items` value either way; the rule stood down and the plants failed, which is
   * what they should do.
   */
  test.each([
    ["a word only the other longhand has", "place-items: left anchor-center;"],
    ["another of them", "place-items: legacy anchor-center;"],
    ["a sibling family", "place-self: left anchor-center;"],
  ])("%s is reported", (_what, css) => {
    expect(found(css)).toContain("word-out-of-its-longhand");
  });

  test.each([
    ["a word both longhands have", "place-items: start end;"],
    ["one value, which reaches both", "place-items: center;"],
    ["the same two the other way round, which Firefox and WebKit accept", "place-items: anchor-center left;"],
    ["a length, which is not a word", "padding: 10px 20px;"],
    ["a family with no shape here", "background: red;"],
    ["a longhand written on its own", "justify-items: space-between;"],
    ["a CSS-wide keyword", "place-items: inherit;"],
  ])("%s is silent", (_what, css) => {
    expect(found(css)).not.toContain("word-out-of-its-longhand");
  });

  /**
   * Said once. `unknown-value` asks whether the PROPERTY takes the word at all and gets there first
   * for most of them, and two reports on one character is one too many. The silence is asserted
   * WITH the other rule's report, or it would pass for having found nothing.
   */
  test("a word the property does not take either is left to `unknown-value`", () => {
    expect(found("place-items: start space-between;")).toEqual(["unknown-value"]);
  });

  /**
   * A `var()` and a HOLE are both unreadable here, and a rule that reports what the author wrote may
   * not report what it cannot read. The word beside them is one the rule WOULD report, or the plant
   * proves nothing — measured: with either guard removed, both of these report.
   */
  test.each([
    ["a `var()`", "place-items: left var(--x);"],
    ["a hole", "place-items: left $(this.how);"],
  ])("%s is silent, because what it holds is not written here", (_what, css) => {
    expect(found(css)).not.toContain("word-out-of-its-longhand");
  });

  test("nested under a selector, where the walk has to reach it", () => {
    expect(found("&:hover {\n    place-items: left anchor-center;\n  }")).toContain("word-out-of-its-longhand");
  });

  test("and inside a media query", () => {
    expect(found("@media (min-width: 40rem) {\n    place-items: left anchor-center;\n  }")).toContain(
      "word-out-of-its-longhand",
    );
  });

  /**
   * `!important` is taken off before the value is read, so the rule reads what the splitter reads.
   * It is never an identifier, so it cannot be reported AS a word — what the stripping decides is
   * how many values were written, and a fault beside it still has to be seen.
   */
  test("a value carrying `!important` is read the same as one without", () => {
    expect(found("place-items: start end !important;")).not.toContain("word-out-of-its-longhand");
    expect(found("place-items: left anchor-center !important;")).toContain("word-out-of-its-longhand");
  });

  test("the message names the word, the longhand, and what the browser does", () => {
    const source = `<div className={@@(\n  place-items: left anchor-center;\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    const one = checkBlock(read.block, {}).find((each) => each.rule === "word-out-of-its-longhand");

    expect(one?.message).toContain("left");
    expect(one?.message).toContain("align-items");
    expect(one?.message).toContain("whole declaration");
  });
});
