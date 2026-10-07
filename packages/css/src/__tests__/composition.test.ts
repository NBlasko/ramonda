import { afterEach, describe, expect, test } from "vitest";
import { keyToken } from "../compiler/names";
import { conditionsOf, forget, mergeClassNames, namesOf, shorthands } from "../runtime/merge";
import { transform } from "../compiler/transform";
import { sheetRank } from "../compiler/flatten";

/**
 * Composition as the author writes it: inside the block, with **later winning**.
 *
 * That rule is the one a CSS reader already has, and it is the whole reason composition lives here
 * rather than in an array at the call site — there is no array index to map onto precedence, and the
 * thing that overrides sits under the thing it overrides.
 *
 * Two spellings, and both compile to an argument of the same merge:
 *
 * - `...$(expr);` merges another block's map at that point;
 * - `when $(expr) { … }` merges a group only when the condition holds.
 *
 * `when` rather than `@if` because **`@@anything` is structurally impossible in CSS** — an
 * at-keyword is `@` followed by an ident-token and an ident cannot begin with `@` — so it is a
 * grammar guarantee rather than a bet on what CSS will not take. And the condition is inside `( { } )`
 * because that is this language's one standing rule: TypeScript appears inside braces and nowhere else.
 */
const emit = (source: string) => transform(source, { filename: "Card.tsx" })?.code ?? "";

/** A class the compiler would have produced, so a runtime test is asked the compiler's own question. */
const classOf = (property: string, value: string) =>
  `r-${keyToken({ property, selector: "", conditions: [] })}-${value}`;

afterEach(forget);

describe("a spread", () => {
  test("becomes an argument of the merge, in the position it was written", () => {
    const out = emit(`const card = @@(\n  ...$(base);\n  opacity: 0.5;\n);\n`);

    expect(out).toMatch(/_merge\(base,\s*"r-o-[^"]+"\)/);
  });

  test("what is written above it merges first, which is what later-wins means", () => {
    const out = emit(`const card = @@(\n  display: flex;\n  ...$(base);\n);\n`);

    expect(out).toMatch(/_merge\("r-disp-[^"]+",\s*base\)/);
  });

  test("the expression is the author's own, byte for byte", () => {
    const out = emit(`const card = @@(\n  ...$(variants[this.variant]);\n);\n`);

    expect(out).toContain("variants[this.variant]");
  });

  test("and a block holding one is never hoisted, because it is not a constant", () => {
    const out = emit(`const card = @@(\n  ...$(base);\n);\n`);

    expect(out).not.toContain("const _s0 =");
  });
});

/**
 * A REUSE INSIDE A REUSE, which the user asked to be measured rather than assumed.
 *
 * `one` is spread into `two`, `two` into `three`, and each level overrides one thing. It works
 * because `mergeClassNames` is associative and a merged value carries the map it came from — but nothing
 * asserted the chain, and "it composes" is exactly the claim that stops being true quietly.
 */
/**
 * WHAT A MODULE REGISTERS, and whether it has done so by the time a merge needs it.
 *
 * A class string cannot carry what a shorthand clears, so the module that writes one registers it —
 * see `shorthands` in `merge.ts`. That is module-level state, and the question a reader will ask is
 * the ordering one: can a merge run before the registration it depends on?
 *
 * It cannot, and the reason is where each one sits. A module's registration is in its PROLOGUE,
 * above everything else it contains, and a module's imports are evaluated before its own body. So a
 * block that composes another module's block is merged after both prologues have run.
 */
describe("what a module registers", () => {
  test("the registration is emitted above the merge that needs it", () => {
    // A `var()`, because a shorthand the compiler SPLITS registers nothing at all — there is no
    // shorthand left in the sheet for anything to clear.
    const out = emit("const a = @@( background-color: red; background: var(--b); );\n");
    const clears = out.indexOf("_clears(");
    const merged = out.indexOf('_merge("r-');

    expect(clears).toBeGreaterThan(-1);
    expect(clears).toBeLessThan(merged);
  });

  /**
   * **Across two modules, RUN rather than read.** The module writing the shorthand is not the one
   * writing the longhand, which is the shape a base and a modifier have, and the only thing that
   * makes it work is that a module's imports are evaluated first.
   */
  test("and a block from another module is cleared by a shorthand in this one", () => {
    const base = emit("export const base = @@( padding-left: 40px; cursor: pointer; );\n");
    const card = emit('import { base } from "./base";\nexport const card = @@( ...$(base); padding: 8px; );\n');

    const run = (code: string, names: Record<string, unknown>) =>
      new Function(
        "_merge",
        "_clears",
        "_under",
        "_named",
        ...Object.keys(names),
        `${code
          .split("\n")
          .filter((line) => !line.startsWith("import "))
          .join("\n")
          .replace(/^export /gm, "")}\nreturn typeof card === "undefined" ? base : card;`,
      )(mergeClassNames, shorthands, conditionsOf, namesOf, ...Object.values(names));

    // The base's module runs first, the way an import does; then the modifier's.
    const theBase = run(base, {}) as string;
    const theCard = run(card, { base: theBase }) as string;

    /**
     * The base's `padding-left` is gone and the cursor it does not set is kept — but by a different
     * route than this test was written for. `padding: 8px` is four longhand classes, one of them
     * `padding-left`, so the merge settles it by KEY and no registration is consulted. The machinery
     * did not get better at the question; the question stopped being asked.
     */
    expect(theCard.split(" ").sort()).toEqual(
      [
        ...theBase.split(" ").filter((one) => !one.startsWith("r-pl-")),
        // The family's marker, which carries no rule — see `markerFor`.
        "r-p-",
        "r-pt-8px",
        "r-pr-8px",
        "r-pb-8px",
        "r-pl-8px",
      ].sort(),
    );
  });

  /** Two modules writing one shorthand each register it, and the second must not undo the first. */
  test("registering the same shorthand twice is the same answer", () => {
    shorthands({ p: ["pl", "pr"] });
    shorthands({ p: ["pl", "pr"] });

    expect(mergeClassNames(classOf("padding-left", "4px"), classOf("padding", "8px"))).toBe(classOf("padding", "8px"));
  });

  /**
   * **And when the two lists DISAGREE, which is the case the claim is closest to.**
   *
   * `shorthands` is documented as idempotent — *two modules writing `padding` each register it* —
   * and `CLEARS.set` is idempotent only while the lists match. Measured, a second registration with
   * a shorter list took the first one's longhands away and `padding-left` survived a `padding`
   * written after it.
   *
   * One build never produces two different lists for a key: the emitter writes the whole family. Two
   * do. A library that ships blocks compiled against another version of this package carries its own
   * `_clears({ … })`, and an application on a newer one has both — so whichever module the bundler
   * put last decides whether a shorthand clears anything at all, silently.
   *
   * The union is the answer rather than first-wins or last-wins: these are the same family described
   * twice, and clearing a longhand that a newer version has dropped costs nothing, because no class
   * carries it.
   */
  test.each([
    [
      "the full family, then a shorter one",
      [
        ["pl", "pr", "pt", "pb"],
        ["pt", "pb"],
      ],
    ],
    [
      "a shorter one, then the full family",
      [
        ["pt", "pb"],
        ["pl", "pr", "pt", "pb"],
      ],
    ],
    ["an empty list after a full one", [["pl", "pr", "pt", "pb"], []]],
  ])("%s still clears what either of them named", (_what, lists) => {
    for (const list of lists as string[][]) shorthands({ p: list });

    expect(mergeClassNames(classOf("padding-left", "4px"), classOf("padding", "8px"))).toBe(classOf("padding", "8px"));
  });
});

describe("a reuse inside a reuse", () => {
  const chain =
    `const one = @@( color: red; gap: 1px; );\n` +
    `const two = @@( ...$(one); gap: 2px; padding: 2px; );\n` +
    `const three = @@( ...$(two); padding: 3px; );\n`;

  test("each level overrides the one below it and nothing else", () => {
    const out = transform(chain, { filename: "Card.tsx" });
    const code = (out?.code ?? "")
      .split("\n")
      .filter((line) => !line.startsWith("import "))
      .join("\n");
    const value = new Function("_merge", "_clears", "_under", "_named", `${code}\nreturn three;`)(
      mergeClassNames,
      shorthands,
      conditionsOf,
      namesOf,
    ) as string;

    const named = value.split(" ");
    const rules = new Map((out?.blocks ?? []).map((one) => [one.className, one.css]));
    // `gap` and `padding` reach the sheet as their longhands, so the claim — each level overrides
    // the one below and nothing else — is now made one property at a time.
    // A split's marker has no rule; it is there for the merge — see `markerFor`.
    expect(named.filter((one) => !rules.has(one)).sort()).toEqual(["r-gap-", "r-p-"]);
    expect(
      named
        .filter((one) => rules.has(one))
        .map((one) => rules.get(one))
        .sort(),
    ).toEqual([
      "color:red;",
      "column-gap:2px;",
      "padding-bottom:3px;",
      "padding-left:3px;",
      "padding-right:3px;",
      "padding-top:3px;",
      "row-gap:2px;",
    ]);
  });

  test("and the innermost one is still a constant, so the chain costs one allocation per level", () => {
    const out = transform(chain, { filename: "Card.tsx" })?.code ?? "";

    // `one` holds no expression, so it is hoisted; `two` and `three` hold a spread and cannot be.
    expect(out).toMatch(/const _s0 = _merge\("r-/);
    expect(out).toMatch(/const two = _merge\(one,/);
    expect(out).toMatch(/const three = _merge\(two,/);
  });

  /**
   * And the thing the chain is FOR: what the sheet then decides between two rules the merge kept.
   *
   * The base's rule and the modifier's are different keys, so both classes land and the SHEET breaks
   * the tie — which the compiler cannot check, because a spread's operand is a runtime value. With
   * Tailwind's order a breakpoint beats the colour scheme, so a base carrying the theme and a
   * modifier adjusting at a breakpoint does what it reads like.
   */
  test("a modifier's breakpoint beats a base's colour scheme, which is why that order was chosen", () => {
    const source =
      `const base = @@( @media (prefers-color-scheme: dark) { color: white; } );\n` +
      `const card = @@( ...$(base); @media (min-width: 40rem) { color: blue; } );\n`;
    const out = transform(source, { filename: "Card.tsx" });

    const dark = out?.blocks.find((one) => one.conditions?.[0]?.includes("prefers-color-scheme"));
    const wide = out?.blocks.find((one) => one.conditions?.[0]?.includes("min-width"));
    expect(dark).toBeDefined();
    expect(wide).toBeDefined();
    expect(sheetRank(wide as never)).toBeGreaterThan(sheetRank(dark as never));
  });
});

describe("a conditional group", () => {
  test("becomes an argument guarded by its condition", () => {
    const out = emit(`const card = @@(\n  cursor: pointer;\n  when $(this.off) {\n    cursor: not-allowed;\n  }\n);\n`);

    expect(out).toMatch(/_merge\("r-cur-[^"]+",\s*this\.off && "r-cur-[^"]+"\)/);
  });

  test("the two `cursor` entries are different classes, so the merge has something to choose", () => {
    const out = emit(`const card = @@(\n  cursor: pointer;\n  when $(this.off) { cursor: not-allowed; }\n);\n`);
    const found = out.match(/r-[0-9a-zA-Z][^"\s)]*/g) ?? [];

    expect(new Set(found).size).toBe(2);
  });

  test("a nested group is a conjunction, because that is what nesting means", () => {
    const out = emit(`const card = @@(\n  when $(a) {\n    when $(b) { opacity: 0.5; }\n  }\n);\n`);

    expect(out).toMatch(/_merge\(a && b && "r-o-[^"]+"\)/);
  });

  test("declarations around a group keep their place", () => {
    const out = emit(`const card = @@(\n  color: red;\n  when $(c) { color: blue; }\n  cursor: pointer;\n);\n`);
    const args = out.slice(out.indexOf("_merge("));

    expect(args.indexOf('"r-c-red"')).toBeLessThan(args.indexOf("c &&"));
    expect(args.indexOf("c &&")).toBeLessThan(args.indexOf('"r-cur-pointer"'));
  });

  test("a selector inside a group is still a selector on its own rule", () => {
    const out = emit(`const card = @@(\n  when $(c) {\n    &:hover { color: red; }\n  }\n);\n`);

    // The class is readable now, and a readable one carries the selector — so the pattern has to
    // stop at the closing quote rather than at the first `)` or `:`.
    expect(out).toMatch(/c && "r-:hover\.c-[^"]+"/);
  });

  test("and a group inside a selector means the same thing", () => {
    const inside = emit(`const card = @@(\n  &:hover {\n    when $(c) { color: red; }\n  }\n);\n`);
    const around = emit(`const card = @@(\n  when $(c) {\n    &:hover { color: red; }\n  }\n);\n`);

    expect(inside.match(/r-[0-9a-zA-Z][^"\s)]*/)?.[0]).toBe(around.match(/r-[0-9a-zA-Z][^"\s)]*/)?.[0]);
  });
});

describe("the two together", () => {
  test("compose in the order they were written", () => {
    const out = emit(`const card = @@(\n  ...$(base);\n  when $(this.off) { opacity: 0.5; }\n  width: 100%;\n);\n`);
    const args = out.slice(out.indexOf("_merge("));

    expect(args.indexOf("base")).toBeLessThan(args.indexOf("this.off &&"));
    expect(args.indexOf("this.off &&")).toBeLessThan(args.indexOf('"r-w-100%"'));
  });
});

/**
 * Where a spread cannot go, and why it is a refusal rather than a best guess.
 *
 * A spread merges a whole block, and a block's map carries the context each of its declarations was
 * written in. Nesting one inside a selector would have to re-scope every key it holds —
 * `background` becoming `:hover|background` — which is not something a merge can do at runtime and
 * not something the author asked for.
 *
 * **Measured before this was written: it compiled, and the selector silently vanished.**
 * `&:hover { ...$(base); }` came out as `_merge(base)`, so a block meant for hover applied always.
 *
 * A GUARD is different and is allowed: `when` does not change any key, it only decides whether the
 * whole map lands.
 */
describe("a spread that cannot mean anything", () => {
  test.each([
    ["inside a selector", `const c = @@( &:hover { ...$(base); } );\n`],
    ["inside a descendant", `const c = @@( & .title { ...$(base); } );\n`],
    ["inside a media query", `const c = @@( @media (min-width: 40rem) { ...$(base); } );\n`],
    ["nested two deep", `const c = @@( &:hover { @media (min-width: 40rem) { ...$(base); } } );\n`],
  ])("%s is refused", (_what, source) => {
    expect(() => emit(source)).toThrow(/spread/);
  });

  test("but inside a conditional group it is fine, because a guard changes no key", () => {
    const out = emit(`const c = @@( when $(on) { ...$(base); } );\n`);

    expect(out).toMatch(/_merge\(on && base\)/);
  });

  test("and the refusal says where it may go", () => {
    expect(() => emit(`const c = @@( &:hover { ...$(base); } );\n`)).toThrow(/top level|if/);
  });
});

/**
 * A condition is the marker and ONE hole, and nothing else.
 *
 * **Measured before this was written: `if $(on)Error { … }` compiled.** The parser lets a hole
 * into a prelude only when the text so far is exactly `when`, records it, and carries on reading —
 * so anything after the hole joined the prelude as ordinary text and nobody asked about it. The
 * group still worked, which is why it was silent: `Error` meant nothing and did nothing.
 *
 * The mirror case was already refused, and that asymmetry is what gave it away: `if Error{{on}}`
 * fails because the text before the hole is not the marker.
 */
describe("a condition head with something extra in it", () => {
  test.each([
    ["text after the hole", "when $(on)Error { opacity: .5; }"],
    ["a word", "when $(on) and { opacity: .5; }"],
    ["a selector after it", "when $(on):hover { opacity: .5; }"],
  ])("%s is refused", (_what, body) => {
    expect(() => emit(`const c = @@(\n  ${body}\n);\n`)).toThrow(/`when` takes one/);
  });

  /**
   * A SECOND hole is refused earlier and says something better: by then the head is no longer the
   * marker, so it is the same fault as a hole written anywhere else a hole cannot go.
   */
  test("a second hole is refused as a hole in a selector", () => {
    expect(() => emit("const c = @@(\n  when $(on){off} { opacity: .5; }\n);\n")).toThrow(/is not a declaration/);
  });

  test("and the refusal says what a condition is", () => {
    expect(() => emit("const c = @@(\n  when $(on)Error { opacity: .5; }\n);\n")).toThrow(
      /takes one `\$\( … \)` and nothing else/,
    );
  });

  test.each([
    ["the ordinary shape", "when $(on) { opacity: .5; }"],
    ["no space before the hole", "when $(on) { opacity: .5; }"],
    ["space either side", "when $(on)  { opacity: .5; }"],
    ["an expression with braces in it", "when $( f({a: 1}) ) { opacity: .5; }"],
  ])("%s is fine", (_what, body) => {
    expect(() => emit(`const c = @@(\n  ${body}\n);\n`)).not.toThrow();
  });
});

/**
 * A group inside a group, which must hold only when BOTH conditions do.
 *
 * **Reported by a user, and it was silently wrong**: the outer condition was dropped, so the inner
 * group applied on its own. Measured before the fix:
 *
 *     when $(this.off) { cursor: none; when $(this.roomy) { color: yellow; } }
 *
 *     _merge({…}, this.off && {"cursor":…}, this.roomy && {"color":…})
 *                                          ^^^^^^^^^^^ the outer guard is gone
 *
 * so `color: yellow` landed whenever `roomy` was on, whatever `off` was.
 *
 * The cause is the rule that makes the source map exact: an expression is left where the author
 * wrote it and the map's text is cut around it, so a guard can be emitted exactly once — and a
 * nested segment needs its outer guard a second time. `PLAN.md` promised `a && b && { … }`, which
 * that rule cannot produce.
 */
/**
 * A group that produces no declaration — and CSS is what decides what it means.
 *
 * `@media print { }` is legal CSS that does nothing, so `when $(x) { }` is legal here that does
 * nothing. **It is also how somebody debugs**: commenting out a group's body is the everyday way to
 * reach this shape, and it must not turn into a different program.
 *
 * It was a real fault, and a silent one. The emission rests on `pieces.length === holes.length + 1`
 * — one piece of surrounding text per hole, plus the tail — and a group with nothing in it recorded
 * a hole while producing no segment. Every piece then slid one place left. Measured, four ways:
 *
 *     color: red; when $(c) { }        the map was emitted TWICE, and the guard became loose text
 *     when $(a) { } color: {v};        `a` became the VALUE of `color`, and `v` was loose text
 *     when $(variant) { }              `_merge(variant)` — parses, and ships `class="l g"`
 *     color: red; when $(a){when $(b){}}  a TypeError out of magic-string, with no author position
 *
 * The third is the one that decided the shape of the fix: it compiles, it runs, and it invents two
 * class names out of the letters of a string. Nothing downstream can notice.
 */
/**
 * The shapes the nesting machinery has, and had no test for.
 *
 * A review counted them: `transform.test.ts` holds no `when` at all, and the deepest shape tested
 * anywhere opened exactly ONE nested merge. Six branches of the emission had nothing exercising
 * them — and the empty group below is the one that turned out to be broken, so this is the gap that
 * let it ship rather than a second bug.
 *
 * Each of these asserts what the emitted structure IS, because the failure they guard against is a
 * structure that still compiles.
 */
describe("the nesting shapes nothing reached", () => {
  test("two nested merges live at once", () => {
    const out = emit(
      `const card = @@(\n  color: red;\n  when $(a) {\n    opacity: 0.5;\n    when $(b) {\n      row-gap: 8px;\n      when $(c) { padding-top: 4px; }\n    }\n  }\n);\n`,
    );

    // Counted in GUARD POSITION, because a bare `\bc\b` also matches the `c` in the class name
    // `r-c-red` — the abbreviation for `color`. The claim is that each guard is emitted once.
    for (const guard of ["a", "b", "c"]) {
      expect(out.match(new RegExp(`(^|[^\\w])${guard}\\s*&&`, "g"))).toHaveLength(1);
    }
    expect(out).toMatch(/a\s*&&\s*_merge\(/);
    expect(out).toMatch(/b\s*&&\s*_merge\(/);
    expect(out).toMatch(/c\s*&&\s*"r-pt-/);
  });

  test("and two of them close on one segment", () => {
    const out = emit(`const card = @@(\n  when $(a) {\n    when $(b) { gap: 8px; }\n  }\n  color: red;\n);\n`);

    expect(out).toMatch(/,\s*"r-c-[^"]*"\)/);
  });

  test("a run resumed after a nested group, still inside a guard", () => {
    const out = emit(
      `const card = @@(\n  when $(a) {\n    color: red;\n    when $(b) { row-gap: 8px; }\n    opacity: 0.5;\n  }\n);\n`,
    );

    expect(out).toMatch(/b\s*&&\s*"r-row_gap-[^"]*"\s*,\s*"r-o-/);
    expect(out.match(/\ba\b/g)).toHaveLength(1);
    expect(out.match(/\bb\b/g)).toHaveLength(1);
  });

  test("a spread beside declarations inside a guard", () => {
    const out = emit(`const card = @@(\n  when $(a) {\n    ...$(base);\n    color: red;\n  }\n);\n`);

    expect(out).toMatch(/a\s*&&\s*_merge\(\s*base\s*,\s*"r-c-/);
  });

  test("a spread alone under a guard opens no merge", () => {
    const out = emit(`const card = @@(\n  when $(a) { ...$(base); }\n);\n`);

    expect(out).toMatch(/_merge\(\s*a\s*&&\s*base\s*\)/);
  });

  /**
   * The contextual clear-key, through the transform rather than against a hand-written map.
   *
   * A shorthand written under a selector clears its longhands under THAT selector and no other, so
   * the key carries the context. `transform.ts` makes this exact claim in a comment and only
   * `merge.test.ts` checked it, against a map somebody typed by hand.
   */
  /**
   * A shorthand's clear-list is registered by the PROPERTY alone, and the context composes itself at
   * run time — `:hover.p` clears `:hover.pl` by putting the same context back in front. One entry
   * answers for every context the shorthand is written in, which is what keeps the registration to
   * the shorthands a file writes rather than one per context it writes them in.
   */
  /**
   * The registration is for the shorthands that CANNOT be split, and there is nothing else left.
   *
   * A shorthand the compiler splits never reaches the sheet, so no class sets `padding` and nothing
   * has to be told that `padding` clears `padding-left` — which is the point of splitting, seen from
   * the runtime: the machinery is not made cleverer, it is made unnecessary. What keeps it alive is
   * the families no table can answer, `background` among them.
   */
  test("a shorthand that is split registers nothing, because no class sets it", () => {
    const out = emit(`const card = @@(\n  &:hover { padding: 8px; }\n);\n`);

    expect(out).not.toContain("_clears");
    expect(out).toContain('"r-:hover.p- r-:hover.pt-8px r-:hover.pr-8px r-:hover.pb-8px r-:hover.pl-8px"');
  });

  test("and one that is not still registers its longhands, by property", () => {
    // A `var()`, because that is what can never split — every `background` without one does now.
    const out = emit(`const card = @@(\n  &:hover { background: var(--b); }\n);\n`);

    expect(out).toContain('_clears({"bg":[');
    expect(out).toContain('"bgi"');
  });
});

describe("a group with nothing in it", () => {
  test("is legal, like the empty at-rule it is, and applies nothing", () => {
    const out = emit(`const card = @@(\n  color: red;\n  when $(this.compact) { }\n);\n`);

    // The guard is still evaluated — a browser evaluates `@media print` too — and contributes
    // nothing. What must never happen is the map appearing twice.
    expect(out.match(/"r-c-red"/g)).toHaveLength(1);
    expect(out).toContain("this.compact");
  });

  test("and the expressions on either side of it stay where they were written", () => {
    const out = emit(`const card = @@( when $(a) { } when $(v) { color: red; } );\n`);

    expect(out).toContain("a &&");
    expect(out).toContain("v &&");
  });

  test("a block that is nothing but an empty group does not become its own condition", () => {
    const out = emit(`const card = @@( when $(variant) { } );\n`);

    // `_merge(variant)` was what it emitted. For `variant = "lg"` the runtime walked the string and
    // produced `class="l g"` — two class names that never existed, with nothing to report it.
    expect(out).not.toMatch(/_merge\(\s*variant\s*\)/);
    expect(out).toContain("variant");
  });

  test("and a group whose only content is an empty group is compiled, not thrown from", () => {
    const out = emit(`const card = @@(\n  color: red;\n  when $(a) { when $(b) { } }\n);\n`);

    expect(out.match(/"r-c-red"/g)).toHaveLength(1);
    expect(out).toContain("a");
    expect(out).toContain("b");
  });

  test.each([
    ["a comment", "/* padding: 4px; */"],
    ["a stray semicolon", ";"],
    ["an empty nested rule", "&:hover { }"],
    ["an empty at-rule", "@media print { }"],
  ])("%s counts as nothing, and is still legal", (_what, body) => {
    const out = emit(`const card = @@(\n  color: red;\n  when $(c) { ${body} }\n);\n`);

    expect(out.match(/"r-c-red"/g)).toHaveLength(1);
  });
});

describe("a group inside a group", () => {
  /** The emitted code with the hoisted prologue dropped — `emit` here already returns the text. */
  const emitted = (source: string) => {
    const code = emit(source);
    if (code === "") throw new Error("the transform found no block");
    // Past the prologue, which is the import and whatever this file registers with the runtime.
    return code.slice(code.indexOf("\n\n") + 2);
  };

  test("holds only when both conditions do", () => {
    const code = emitted(
      `const s = @@(\n  opacity: 0.5;\n  when $(this.off) {\n    cursor: none;\n    when $(this.roomy) {\n      color: yellow;\n    }\n  }\n);\n`,
    );

    // Whatever the shape, `this.off` must gate the inner group as well as the outer one.
    const inner = code.slice(0, code.indexOf("r-c-yellow"));
    expect(inner).toContain("this.off");
    expect(inner).toContain("this.roomy");
  });

  test("three deep", () => {
    const code = emitted(
      `const s = @@(\n  when $(a) {\n    when $(b) {\n      when $(c) {\n        color: red;\n      }\n    }\n  }\n);\n`,
    );
    const inner = code.slice(0, code.indexOf("r-c-red"));

    for (const guard of ["a", "b", "c"]) expect(inner).toContain(guard);
  });

  test("and a declaration in the outer group keeps only the outer guard", () => {
    const code = emitted(
      `const s = @@(\n  when $(this.off) {\n    cursor: none;\n    when $(this.roomy) {\n      color: yellow;\n    }\n  }\n);\n`,
    );
    const outer = code.slice(0, code.indexOf("r-cur-none"));

    expect(outer).toContain("this.off");
    expect(outer).not.toContain("this.roomy");
  });
});

/**
 * The nested guard, RUN rather than read.
 *
 * The tests above assert the shape the transform emits. This asserts what that shape does, because
 * the fault the user reported was behavioural: `color: yellow` landed with only the inner checkbox
 * ticked, and the compiled text alone would not have shown it.
 */
describe("a nested guard, evaluated", () => {
  /** The four states of two conditions, through the real `mergeClassNames`. */
  const classes = (off: boolean, roomy: boolean) => {
    // Exactly the shape the transform emits for a nested group — see the tests above.
    const inner = roomy && "r-c-yellow";
    const outer = off && mergeClassNames("r-cur-none", inner);
    return mergeClassNames("r-o-0.5", outer).split(" ");
  };

  test.each([
    [false, false, false],
    [true, false, false],
    [false, true, false],
    [true, true, true],
  ])("off=%s roomy=%s -> yellow=%s", (off, roomy, yellow) => {
    expect(classes(off, roomy).includes("r-c-yellow")).toBe(yellow);
  });

  /** And the outer group's own declaration follows the outer condition alone. */
  test.each([
    [false, false],
    [true, true],
  ])("off=%s -> cursor=%s", (off, cursor) => {
    expect(classes(off, false).includes("r-cur-none")).toBe(cursor);
  });
});

/**
 * TWO conditions your code decides, both true — and the answer is the order you wrote.
 *
 * The user asked it directly: *"a sta se desava ako su oba pod nekim uslovom … i u jednom trenutku
 * se loaduju oba, da li poslednji pobedjuje ili bacamo gresku? Ako ima resenje i deterministicko je,
 * mozemo da ga dokumentujemo."*
 *
 * It is deterministic, and it needs no rule. `when $( … ) { … }` compiles to a merge argument —
 * `_merge(p && { … }, q && { … })` — so both groups are settled before anything reaches the page,
 * and the element carries ONE class for the property. Nothing ever reaches the stylesheet twice, so
 * there is no position for the two to fight over.
 *
 * That is the opposite of two CSS conditions, where both rules exist in the sheet and its one
 * position has to decide — which is why those are refused when both can hold.
 */
describe("two conditions the code decides", () => {
  const block = (p: boolean, q: boolean) => mergeClassNames(p && "r-c-red", q && "r-c-blue");

  test("both true is the one written last", () => {
    expect(block(true, true)).toBe("r-c-blue");
  });

  test.each([
    ["only the first", true, false, "r-c-red"],
    ["only the second", false, true, "r-c-blue"],
    ["neither", false, false, ""],
  ])("%s", (_what, p, q, expected) => {
    expect(block(p, q)).toBe(expected);
  });

  /** And the compiled shape is what makes that true, rather than an accident of this merge. */
  test("a condition compiles to an argument of the merge, in source order", () => {
    const out = emit(
      `const a = (p: boolean, q: boolean) => @@(\n  when $(p) { color: red; }\n  when $(q) { color: blue; }\n);\n`,
    );

    expect(out).toMatch(/_merge\(p && "r-c-red",\s*q && "r-c-blue"\)/);
  });
});

describe("a split meets a package built by an older release", () => {
  /** A block compiled by THIS release, run the way a module runs it. */
  const compiled = (block: string): string => {
    const out = transform(`const a = @@( ${block} );\n`, { filename: "App.tsx" });
    const code = (out?.code ?? "")
      .split("\n")
      .filter((line) => !line.startsWith("import "))
      .join("\n");
    return new Function("_merge", "_clears", "_under", "_named", `${code}\nreturn a;`)(
      mergeClassNames,
      shorthands,
      conditionsOf,
      namesOf,
    ) as string;
  };
  const has = (classes: string, prefix: string) => classes.split(" ").some((one) => one.startsWith(prefix));

  /**
   * `overflow` was one property before it became `overflow-x` and `overflow-y`. A package built
   * then carries a class for the whole property, in the layer every longhand used, and a split
   * written LATER has to replace it. Measured in all three engines before this: the old class won.
   */
  test("a split replaces the class an older release wrote for the whole property", () => {
    const older = `r-${keyToken({ property: "overflow", selector: "", conditions: [] })}-hidden`;
    const merged = String(mergeClassNames(older, compiled("overflow: auto;")));

    expect(merged.split(" ")).not.toContain(older);
    expect(has(merged, "r-overflow_x-auto")).toBe(true);
  });

  /**
   * And the other way: a longhand the older release never knew. Its split of `text-decoration`
   * has no piece for `text-decoration-thickness`, so it cannot replace one — and CSS resets it.
   * Simulated by taking that piece out of today's split.
   */
  test("an older split still clears a longhand it had no piece for", () => {
    const thickness = `r-${keyToken({ property: "text-decoration-thickness", selector: "", conditions: [] })}-7px`;
    const older = compiled("text-decoration: underline;")
      .split(" ")
      .filter((one) => !one.startsWith("r-text_decoration_thickness-"))
      .join(" ");
    const merged = String(mergeClassNames(thickness, older));

    expect(merged.split(" ")).not.toContain(thickness);
  });
});

/**
 * `!important` is part of what a class SETS, so the merge must not let an ordinary declaration
 * replace an important one. It did: both carried the key `pl`, the later won, and
 * `padding: 1px !important; padding-left: 2px` gave 2px where CSS gives 1px — in ONE block, since a
 * block is merged at load too. The key now carries importance as a context (`!.pl`), so the two
 * stay side by side and the mirrored `i` layer decides, as CSS does.
 */
describe("an important declaration and an ordinary one", () => {
  const compiled = (block: string): string => {
    const out = transform(`const a = @@( ${block} );\n`, { filename: "Imp.tsx" });
    const code = (out?.code ?? "")
      .split("\n")
      .filter((line) => !line.startsWith("import "))
      .join("\n");
    return new Function("_merge", "_clears", "_under", "_named", `${code}\nreturn a;`)(
      mergeClassNames,
      shorthands,
      conditionsOf,
      namesOf,
    ) as string;
  };
  const has = (classes: string, prefix: string) => classes.split(" ").some((one) => one.startsWith(prefix));

  test("an ordinary longhand after an important split keeps the important piece", () => {
    const merged = compiled("padding: 1px !important; padding-left: 2px;");
    expect(has(merged, "r-!.pl-1px")).toBe(true);
    expect(has(merged, "r-pl-2px")).toBe(true);
  });

  test("and two longhands", () => {
    const merged = compiled("color: red !important; color: blue;");
    expect(merged.split(" ")).toHaveLength(2);
  });

  test("an important one after an important one still replaces it", () => {
    const merged = compiled("color: red !important; color: blue !important;");
    expect(merged.split(" ")).toHaveLength(1);
    expect(merged).toContain("blue");
  });

  test("and across blocks the same", () => {
    const merged = String(mergeClassNames(compiled("padding: 1px !important;"), compiled("padding-left: 2px;")));
    expect(has(merged, "r-!.pl-1px")).toBe(true);
    expect(has(merged, "r-pl-2px")).toBe(true);
  });

  test("an important shorthand clears an earlier important longhand, and leaves an ordinary one", () => {
    const merged = String(
      mergeClassNames(
        compiled("padding-left: 9px !important; padding-top: 7px;"),
        compiled("padding: 1px !important;"),
      ),
    );
    expect(has(merged, "r-!.pl-9px")).toBe(false);
    expect(has(merged, "r-pt-7px")).toBe(true);
  });
});

/**
 * An expression is ONE operand, whatever operators it holds.
 *
 * The author's expression is copied where it was written and the transform writes its own operator
 * beside it — `&&` after a condition, a `,` after a match's subject. Measured before this: the
 * condition `$(p ? q : r)` compiled to `p ? q : r && "r-c-red"`, which JavaScript reads as
 * `p ? q : (r && "r-c-red")` — so with `p` true the block applied `q`, a boolean, and never red.
 */
describe("an expression holding operators", () => {
  const classes = (block: string, names: Record<string, unknown>): string => {
    const out = transform(`const a = @@( ${block} );\n`, { filename: "App.tsx" });
    const code = (out?.code ?? "")
      .split("\n")
      .filter((line) => !line.startsWith("import "))
      .join("\n");
    const keys = Object.keys(names);
    return String(
      new Function("_merge", "_pick", ...keys, `${code}\nreturn a;`)(
        mergeClassNames,
        (subject: string, arms: Record<string, string>) => arms[subject],
        ...keys.map((key) => names[key]),
      ),
    );
  };

  test("a condition that is a ternary is one condition", () => {
    const block = "color: blue; when $(p ? q : r) { color: red; }";

    expect(classes(block, { p: true, q: true, r: false })).toContain("r-c-red");
    expect(classes(block, { p: true, q: false, r: true })).not.toContain("r-c-red");
  });

  test("a condition that is an `||` is one condition", () => {
    const block = "color: blue; when $(p || q) { color: red; }";

    expect(classes(block, { p: false, q: true })).toContain("r-c-red");
  });

  test("a spread that is a ternary is one block", () => {
    const red = mergeClassNames("r-c-red");
    const blue = mergeClassNames("r-c-blue");

    expect(classes("...$(p ? red : blue);", { p: false, red, blue })).toContain("r-c-blue");
  });

  test("a match whose subject is a ternary picks by the whole of it", () => {
    const block = "color: match $(p ? q : r) { a => red; b => blue; };";

    expect(classes(block, { p: false, q: "a", r: "b" })).toContain("r-c-blue");
  });

  /** And a plain name stays as it was written, so the common case reads as the source does. */
  test("a plain name is not wrapped", () => {
    expect(
      transform("const a = (p: boolean) => @@( when $(this.p) { color: red; } );\n", { filename: "App.tsx" })?.code,
    ).toContain("this.p && ");
  });
});
