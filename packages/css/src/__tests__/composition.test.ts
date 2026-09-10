import { describe, expect, test } from "vitest";
import { merge } from "../merge";
import { transform } from "../compiler/transform";

/**
 * Composition as the author writes it: inside the block, with **later winning**.
 *
 * That rule is the one a CSS reader already has, and it is the whole reason composition lives here
 * rather than in an array at the call site — there is no array index to map onto precedence, and the
 * thing that overrides sits under the thing it overrides.
 *
 * Two spellings, and both compile to an argument of the same merge:
 *
 * - `...{expr};` merges another block's map at that point;
 * - `if ({expr}) { … }` merges a group only when the condition holds.
 *
 * `if` rather than `@if` because **`@@anything` is structurally impossible in CSS** — an
 * at-keyword is `@` followed by an ident-token and an ident cannot begin with `@` — so it is a
 * grammar guarantee rather than a bet on what CSS will not take. And the condition is inside `( { } )`
 * because that is this language's one standing rule: TypeScript appears inside braces and nowhere else.
 */
const emit = (source: string) => transform(source, { filename: "Card.tsx" })?.code ?? "";

describe("a spread", () => {
  test("becomes an argument of the merge, in the position it was written", () => {
    const out = emit(`const card = @@(\n  ...{base};\n  opacity: 0.5;\n);\n`);

    expect(out).toMatch(/_merge\(base,\s*\{"opacity":"r-[0-9a-zA-Z][^"\s)]*",\}\)/);
  });

  test("what is written above it merges first, which is what later-wins means", () => {
    const out = emit(`const card = @@(\n  display: flex;\n  ...{base};\n);\n`);

    expect(out).toMatch(/_merge\(\{"display":"r-[0-9a-zA-Z][^"\s)]*",\},\s*base\)/);
  });

  test("the expression is the author's own, byte for byte", () => {
    const out = emit(`const card = @@(\n  ...{variants[this.variant]};\n);\n`);

    expect(out).toContain("variants[this.variant]");
  });

  test("and a block holding one is never hoisted, because it is not a constant", () => {
    const out = emit(`const card = @@(\n  ...{base};\n);\n`);

    expect(out).not.toContain("const _s0 =");
  });
});

describe("a conditional group", () => {
  test("becomes an argument guarded by its condition", () => {
    const out = emit(`const card = @@(\n  cursor: pointer;\n  if ({this.off}) {\n    cursor: not-allowed;\n  }\n);\n`);

    expect(out).toMatch(
      /_merge\(\{"cursor":"r-[0-9a-zA-Z][^"\s)]*",\},\s*this\.off && \{"cursor":"r-[0-9a-zA-Z][^"\s)]*",\}\)/,
    );
  });

  test("the two `cursor` entries are different classes, so the merge has something to choose", () => {
    const out = emit(`const card = @@(\n  cursor: pointer;\n  if ({this.off}) { cursor: not-allowed; }\n);\n`);
    const found = out.match(/r-[0-9a-zA-Z][^"\s)]*/g) ?? [];

    expect(new Set(found).size).toBe(2);
  });

  test("a nested group is a conjunction, because that is what nesting means", () => {
    const out = emit(`const card = @@(\n  if ({a}) {\n    if ({b}) { opacity: 0.5; }\n  }\n);\n`);

    expect(out).toMatch(/_merge\(a && b && \{"opacity":"r-[0-9a-zA-Z][^"\s)]*",\}\)/);
  });

  test("declarations around a group keep their place", () => {
    const out = emit(`const card = @@(\n  color: red;\n  if ({c}) { color: blue; }\n  background: white;\n);\n`);
    const args = out.slice(out.indexOf("_merge("));

    expect(args.indexOf('"color"')).toBeLessThan(args.indexOf("c &&"));
    expect(args.indexOf("c &&")).toBeLessThan(args.indexOf('"background"'));
  });

  test("a selector inside a group is still a selector on its own rule", () => {
    const out = emit(`const card = @@(\n  if ({c}) {\n    &:hover { color: red; }\n  }\n);\n`);

    // The class is readable now, and a readable one carries the selector — so the pattern has to
    // stop at the closing quote rather than at the first `)` or `:`.
    expect(out).toMatch(/c && \{"&:hover\|color":"r-[^"]+",\}/);
  });

  test("and a group inside a selector means the same thing", () => {
    const inside = emit(`const card = @@(\n  &:hover {\n    if ({c}) { color: red; }\n  }\n);\n`);
    const around = emit(`const card = @@(\n  if ({c}) {\n    &:hover { color: red; }\n  }\n);\n`);

    expect(inside.match(/r-[0-9a-zA-Z][^"\s)]*/)?.[0]).toBe(around.match(/r-[0-9a-zA-Z][^"\s)]*/)?.[0]);
  });
});

describe("the two together", () => {
  test("compose in the order they were written", () => {
    const out = emit(`const card = @@(\n  ...{base};\n  if ({this.off}) { opacity: 0.5; }\n  width: 100%;\n);\n`);
    const args = out.slice(out.indexOf("_merge("));

    expect(args.indexOf("base")).toBeLessThan(args.indexOf("this.off &&"));
    expect(args.indexOf("this.off &&")).toBeLessThan(args.indexOf('"width"'));
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
 * `&:hover { ...{{base}}; }` came out as `_merge(base)`, so a block meant for hover applied always.
 *
 * A GUARD is different and is allowed: `if` does not change any key, it only decides whether the
 * whole map lands.
 */
describe("a spread that cannot mean anything", () => {
  test.each([
    ["inside a selector", `const c = @@( &:hover { ...{base}; } );\n`],
    ["inside a descendant", `const c = @@( & .title { ...{base}; } );\n`],
    ["inside a media query", `const c = @@( @media (min-width: 40rem) { ...{base}; } );\n`],
    ["nested two deep", `const c = @@( &:hover { @media (min-width: 40rem) { ...{base}; } } );\n`],
  ])("%s is refused", (_what, source) => {
    expect(() => emit(source)).toThrow(/spread/);
  });

  test("but inside a conditional group it is fine, because a guard changes no key", () => {
    const out = emit(`const c = @@( if ({on}) { ...{base}; } );\n`);

    expect(out).toMatch(/_merge\(on && base\)/);
  });

  test("and the refusal says where it may go", () => {
    expect(() => emit(`const c = @@( &:hover { ...{base}; } );\n`)).toThrow(/top level|if/);
  });
});

/**
 * A condition is the marker and ONE hole, and nothing else.
 *
 * **Measured before this was written: `if {{on}}Error { … }` compiled.** The parser lets a hole
 * into a prelude only when the text so far is exactly `if`, records it, and carries on reading —
 * so anything after the hole joined the prelude as ordinary text and nobody asked about it. The
 * group still worked, which is why it was silent: `Error` meant nothing and did nothing.
 *
 * The mirror case was already refused, and that asymmetry is what gave it away: `if Error{{on}}`
 * fails because the text before the hole is not the marker.
 */
describe("a condition head with something extra in it", () => {
  test.each([
    ["text after the hole", "if ({on})Error { opacity: .5; }"],
    ["a word", "if ({on}) and { opacity: .5; }"],
    ["a selector after it", "if ({on}):hover { opacity: .5; }"],
  ])("%s is refused", (_what, body) => {
    expect(() => emit(`const c = @@(\n  ${body}\n);\n`)).toThrow(/if/);
  });

  /**
   * A SECOND hole is refused earlier and says something better: by then the head is no longer the
   * marker, so it is the same fault as a hole written anywhere else a hole cannot go.
   */
  test("a second hole is refused as a hole in a selector", () => {
    expect(() => emit("const c = @@(\n  if ({on}){off} { opacity: .5; }\n);\n")).toThrow(/is not a declaration/);
  });

  test("and the refusal says what a condition is", () => {
    expect(() => emit("const c = @@(\n  if ({on})Error { opacity: .5; }\n);\n")).toThrow(/takes one parenthesised/);
  });

  test.each([
    ["the ordinary shape", "if ({on}) { opacity: .5; }"],
    ["no space before the hole", "if ({on}) { opacity: .5; }"],
    ["space either side", "if ({on})  { opacity: .5; }"],
    ["an expression with braces in it", "if ({ f({a: 1}) }) { opacity: .5; }"],
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
 *     if ({this.off}) { cursor: none; if ({this.roomy}) { color: yellow; } }
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
 * `@media print { }` is legal CSS that does nothing, so `if ({x}) { }` is legal here that does
 * nothing. **It is also how somebody debugs**: commenting out a group's body is the everyday way to
 * reach this shape, and it must not turn into a different program.
 *
 * It was a real fault, and a silent one. The emission rests on `pieces.length === holes.length + 1`
 * — one piece of surrounding text per hole, plus the tail — and a group with nothing in it recorded
 * a hole while producing no segment. Every piece then slid one place left. Measured, four ways:
 *
 *     color: red; if ({c}) { }        the map was emitted TWICE, and the guard became loose text
 *     if ({a}) { } color: {v};        `a` became the VALUE of `color`, and `v` was loose text
 *     if ({variant}) { }              `_merge(variant)` — parses, and ships `class="l g"`
 *     color: red; if({a}){if({b}){}}  a TypeError out of magic-string, with no author position
 *
 * The third is the one that decided the shape of the fix: it compiles, it runs, and it invents two
 * class names out of the letters of a string. Nothing downstream can notice.
 */
/**
 * The shapes the nesting machinery has, and had no test for.
 *
 * A review counted them: `transform.test.ts` holds no `if` at all, and the deepest shape tested
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
      `const card = @@(\n  color: red;\n  if ({a}) {\n    opacity: 0.5;\n    if ({b}) {\n      gap: 8px;\n      if ({c}) { padding: 4px; }\n    }\n  }\n);\n`,
    );

    // Counted in GUARD POSITION, because a bare `\bc\b` also matches the `c` in the class name
    // `r-c-red` — the abbreviation for `color`. The claim is that each guard is emitted once.
    for (const guard of ["a", "b", "c"]) {
      expect(out.match(new RegExp(`(^|[^\\w])${guard}\\s*&&`, "g"))).toHaveLength(1);
    }
    expect(out).toMatch(/a\s*&&\s*_merge\(/);
    expect(out).toMatch(/b\s*&&\s*_merge\(/);
    expect(out).toMatch(/c\s*&&\s*\{"padding"/);
  });

  test("and two of them close on one segment", () => {
    const out = emit(`const card = @@(\n  if ({a}) {\n    if ({b}) { gap: 8px; }\n  }\n  color: red;\n);\n`);

    expect(out).toMatch(/,\s*\{"color":"r-[^"]*",\}\)/);
  });

  test("a run resumed after a nested group, still inside a guard", () => {
    const out = emit(
      `const card = @@(\n  if ({a}) {\n    color: red;\n    if ({b}) { gap: 8px; }\n    opacity: 0.5;\n  }\n);\n`,
    );

    expect(out).toMatch(/b\s*&&\s*\{"gap"[^}]*\}\s*,\s*\{"opacity"/);
    expect(out.match(/\ba\b/g)).toHaveLength(1);
    expect(out.match(/\bb\b/g)).toHaveLength(1);
  });

  test("a spread beside declarations inside a guard", () => {
    const out = emit(`const card = @@(\n  if ({a}) {\n    ...{base};\n    color: red;\n  }\n);\n`);

    expect(out).toMatch(/a\s*&&\s*_merge\(\s*base\s*,\s*\{"color"/);
  });

  test("a spread alone under a guard opens no merge", () => {
    const out = emit(`const card = @@(\n  if ({a}) { ...{base}; }\n);\n`);

    expect(out).toMatch(/_merge\(\s*a\s*&&\s*base\s*\)/);
  });

  /**
   * The contextual clear-key, through the transform rather than against a hand-written map.
   *
   * A shorthand written under a selector clears its longhands under THAT selector and no other, so
   * the key carries the context. `transform.ts` makes this exact claim in a comment and only
   * `merge.test.ts` checked it, against a map somebody typed by hand.
   */
  test("a shorthand under a selector clears its longhands under that selector only", () => {
    const out = emit(`const card = @@(\n  &:hover { padding: 8px; }\n);\n`);

    expect(out).toContain('"~&:hover|padding"');
    expect(out).toContain('"&:hover|padding-left"');
    expect(out).not.toContain('"~padding"');
  });
});

describe("a group with nothing in it", () => {
  test("is legal, like the empty at-rule it is, and applies nothing", () => {
    const out = emit(`const card = @@(\n  color: red;\n  if ({this.compact}) { }\n);\n`);

    // The guard is still evaluated — a browser evaluates `@media print` too — and contributes
    // nothing. What must never happen is the map appearing twice.
    expect(out.match(/"color"/g)).toHaveLength(1);
    expect(out).toContain("this.compact");
  });

  test("and the expressions on either side of it stay where they were written", () => {
    const out = emit(`const card = @@( if ({a}) { } color: {v}; );\n`);

    expect(out).toMatch(/\["r-[0-9a-zA-Z][^"\s\]]*",\s*v\]/);
    expect(out).toContain("a");
  });

  test("a block that is nothing but an empty group does not become its own condition", () => {
    const out = emit(`const card = @@( if ({variant}) { } );\n`);

    // `_merge(variant)` was what it emitted. For `variant = "lg"` the runtime walked the string and
    // produced `class="l g"` — two class names that never existed, with nothing to report it.
    expect(out).not.toMatch(/_merge\(\s*variant\s*\)/);
    expect(out).toContain("variant");
  });

  test("and a group whose only content is an empty group is compiled, not thrown from", () => {
    const out = emit(`const card = @@(\n  color: red;\n  if ({a}) { if ({b}) { } }\n);\n`);

    expect(out.match(/"color"/g)).toHaveLength(1);
    expect(out).toContain("a");
    expect(out).toContain("b");
  });

  test.each([
    ["a comment", "/* padding: 4px; */"],
    ["a stray semicolon", ";"],
    ["an empty nested rule", "&:hover { }"],
    ["an empty at-rule", "@media print { }"],
  ])("%s counts as nothing, and is still legal", (_what, body) => {
    const out = emit(`const card = @@(\n  color: red;\n  if ({c}) { ${body} }\n);\n`);

    expect(out.match(/"color"/g)).toHaveLength(1);
  });
});

describe("a group inside a group", () => {
  /** The emitted code with the hoisted prologue dropped — `emit` here already returns the text. */
  const emitted = (source: string) => {
    const code = emit(source);
    if (code === "") throw new Error("the transform found no block");
    return code.slice(code.indexOf("\n\n") + 2);
  };

  test("holds only when both conditions do", () => {
    const code = emitted(
      `const s = @@(\n  opacity: 0.5;\n  if ({this.off}) {\n    cursor: none;\n    if ({this.roomy}) {\n      color: yellow;\n    }\n  }\n);\n`,
    );

    // Whatever the shape, `this.off` must gate the inner group as well as the outer one.
    const inner = code.slice(code.indexOf("r-c-yellow") - 80, code.indexOf("r-c-yellow"));
    expect(inner).toContain("this.off");
    expect(inner).toContain("this.roomy");
  });

  test("three deep", () => {
    const code = emitted(
      `const s = @@(\n  if ({a}) {\n    if ({b}) {\n      if ({c}) {\n        color: red;\n      }\n    }\n  }\n);\n`,
    );
    const inner = code.slice(0, code.indexOf("r-c-red"));

    for (const guard of ["a", "b", "c"]) expect(inner).toContain(guard);
  });

  test("and a declaration in the outer group keeps only the outer guard", () => {
    const code = emitted(
      `const s = @@(\n  if ({this.off}) {\n    cursor: none;\n    if ({this.roomy}) {\n      color: yellow;\n    }\n  }\n);\n`,
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
  /** The four states of two conditions, through the real `merge`. */
  const classes = (off: boolean, roomy: boolean) => {
    // Exactly the shape the transform emits for a nested group — see the tests above.
    const inner = roomy && { color: "r-c-yellow" };
    const outer = off && merge({ cursor: "r-cur-none" }, inner);
    return merge({ opacity: "r-o-0.5" }, outer).className.split(" ");
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
