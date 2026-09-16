import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { type Declarations, generate, namesIn, verifyNames } from "../codegen";
import { kind } from "../declared";

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * What codegen writes from a project's declared variables, which is the whole reason the config
 * holds a fallback and a kind at all.
 *
 * The asymmetry: a variable that is declared and NOT emitted fails silently — `$` has a name for it,
 * the stylesheet has no declaration, and every use falls back. The fallback is what stops that being
 * a visual bug, which is exactly why it must not also be the thing that hides the omission. So every
 * case asserting something IS emitted is load-bearing.
 */

const simple = {
  color: kind("color", { primary: { main: "#3b82f6" } }),
  size: kind("length", { control: { md: "30px" } }),
};

describe("names", () => {
  test("a name is the path, joined with a dash, spelled as a custom property", () => {
    expect(namesIn(simple).map((one) => one.name)).toEqual(["--color-primary-main", "--size-control-md"]);
  });

  test("the order is the config's own, not the alphabet's", () => {
    const written = { zebra: kind("color", { a: "#fff" }), alpha: kind("color", { b: "#000" }) };

    expect(namesIn(written).map((one) => one.name)).toEqual(["--zebra-a", "--alpha-b"]);
  });

  test("two paths that spell one name are refused, and BOTH are named", () => {
    const clashing = {
      "a-b": kind("length", { c: "1px" }),
      a: kind("length", { "b-c": "2px" }),
    };

    // The walk answers and `verifyNames` decides — see its note. `generate` runs both.
    expect(() => verifyNames(namesIn(clashing))).toThrow(/--a-b-c/);
    expect(() => generate(clashing)).toThrow(/a-b\.c/);
    expect(() => generate(clashing)).toThrow(/a\.b-c/);
  });
});

describe("the stylesheet", () => {
  test("`:root` carries every variable with the fallback it was declared with", () => {
    const { css } = generate(simple);

    expect(css).toContain("--color-primary-main: #3b82f6;");
    expect(css).toContain("--size-control-md: 30px;");
  });

  test("each one registers with the kind's own syntax, and INHERITS", () => {
    const { css } = generate(simple);

    expect(css).toContain(
      `@property --size-control-md {\n  syntax: "<length>";\n  inherits: true;\n  initial-value: 30px;\n}`,
    );
  });

  test("`any` registers TOO — `*` refuses nothing, but it still guarantees a value", () => {
    const { css } = generate({ misc: kind("any", { whatever: "anything at all" }) });

    expect(css).toContain("--misc-whatever: anything at all;");
    expect(css).toContain(
      `@property --misc-whatever {\n  syntax: "*";\n  inherits: true;\n  initial-value: anything at all;\n}`,
    );
  });

  test("every declared variable is registered, because that is what makes a bare `var()` safe", () => {
    // `$` compiles to `var(--name)` with no fallback, so the registration is the only thing standing
    // between a variable nothing sets and a property that silently becomes something else. A kind
    // that skipped registration would be a hole in that, with nothing to report it.
    const { css } = generate({
      a: kind("color", { one: "#fff" }),
      b: kind("any", { two: "whatever" }),
      c: kind("number", { three: 1 }),
    });

    expect(css.match(/@property/g)).toHaveLength(3);
  });

  test("no variables is no stylesheet, rather than an empty one", () => {
    expect(generate({}).css).toBe("");
  });
});

describe("the module", () => {
  test("`$` reaches a variable by the path it was declared at", () => {
    const { module: written } = generate(simple);

    expect(written).toContain('"main": "var(--color-primary-main)" as Token<"color", Fixed<"#3b82f6">>');
    expect(written).toMatch(/export const \$ = Object\.freeze\(\{/);
  });

  test("it keeps the shape rather than flattening it", () => {
    const { module: written } = generate(simple);

    expect(written).toMatch(/"color": Object\.freeze\(\{\s*"primary": Object\.freeze\(\{/);
  });

  test("a number fallback stays a number, so `number` and `integer` are not stringified", () => {
    const { module: written } = generate({ weight: kind("number", { bold: 700 }) });

    expect(written).toContain('"var(--weight-bold)" as Token<"number", Fixed<700>>');
  });
});

describe("naming what a property accepts", () => {
  test("the module exports `Value`, so a hole's value can be annotated", () => {
    const { module: written } = generate(simple);

    expect(written).toContain("export type Value<P extends keyof CssProperties> = CssProperties[P];");
    // The three names the rows below are written in terms of. The whole import line is NOT asserted:
    // it also carries everything the module passes on, which is its own test — and a list that has
    // to be repeated in an assertion is a list that stops the next name being added to it.
    for (const one of ["CssProperties as Base", "CssValue", "Narrowed"]) {
      expect(written).toMatch(new RegExp(`import type \\{[^}]*\\b${one.replace(/ /g, "\\s")}\\b`));
    }
    expect(written).toContain("export type CssProperties = Omit<Base, keyof Narrowings> & Narrowings;");
    // Written out rather than named from the package: a generic recursive alias stops expanding at
    // depth, and two levels of nesting is ordinary CSS. See the note on `CssBlockShape`.
    expect(written).toContain("export type CssBlockShape = Partial<CssProperties> & {");
  });
});

describe("what the module refuses at run time", () => {
  /**
   * **Frozen at every level, and `as const` is not enough.**
   *
   * `as const` makes TypeScript refuse an assignment, which catches every reasonable way somebody
   * could do it — and a cast walks past that. The rule in this repository is to prove it statically
   * AND stop it anyway.
   *
   * Mutating `$` would be the worst kind of change: a variable's value is written into the
   * stylesheet at build time, so assigning to it changes what one module reads and nothing else, and
   * the page keeps the old value. `toStyle` is the way to change one.
   */
  test("`$` cannot be mutated, at the top or at any level", () => {
    const { module: written } = generate(simple);

    expect(written).toContain("export const $ = Object.freeze({");
    expect(written).toContain('"color": Object.freeze({');
    expect(written).toContain('"primary": Object.freeze({');
  });
});

/**
 * A declared name or value that breaks the STYLESHEET — none of it was checked.
 *
 * Found by review pass 2, by handing codegen declarations it does not expect. The module it emits
 * parses in every case; the CSS does not, and two of these are worse than not parsing:
 *
 *     value `a;b`   ->  `--a-b: a;b;`     the `;` ends the declaration, `b;` is left over
 *     value `a}b`   ->  `--a-b: a}b;`     the `}` CLOSES `:root`, and the rest escapes the rule
 *     a newline     ->  `--a-b: a`        the value is cut in half
 *     name `b"c`    ->  `--a-b"c: 8px;`   not a custom property name at all
 *     name `b*c`    ->  `--a-b*c: 8px;`   nor this one
 *
 * The name half has an answer already written down elsewhere: the editor's grammar matches a `$`
 * path as `(?:\.[A-Za-z0-9_-]*)+`, so a segment outside that set is a variable `$` can never reach.
 * Codegen was emitting one anyway. One rule, two consumers, and only one of them knew it.
 */
describe("a declaration that would break the stylesheet", () => {
  const of = (declarations: Declarations) => () => generate(declarations);

  test.each([
    ["a semicolon, which ends the declaration", "a;b"],
    ["a closing brace, which closes `:root`", "a}b"],
    ["an opening brace", "a{b"],
    ["a newline, which cuts the value in half", "a\nb"],
  ])("a value holding %s is refused", (_what, value) => {
    expect(of({ space: kind("custom-ident", { gutter: value }) })).toThrow(/value/i);
  });

  test.each([
    ["a quote", 'b"c'],
    ["a star", "b*c"],
    ["a space", "b c"],
    ["a brace", "b}c"],
  ])("a name holding %s is refused", (_what, name) => {
    expect(of({ space: kind("length", { [name]: "8px" }) })).toThrow(/name|segment/i);
  });

  /**
   * A DOT in a key is not a fault — it reads as nesting, and reaching it works.
   *
   * `{ "b.c": "8px" }` becomes the path `space.b.c`, so `$` emits `space: { b: { c } }` and
   * `$.space.b.c` reaches it. Written down because it looks like a hole in the set above and is
   * not: the one thing it could go wrong as — meeting a real `{ b: { c } }` — is a collision, and
   * `verifyNames` has refused those since before this.
   */
  test("a dot reads as nesting, and colliding with real nesting is still refused", () => {
    expect(of({ space: kind("length", { "b.c": "8px" }) })).not.toThrow();
    expect(of({ space: kind("length", { "b.c": "8px", b: { c: "4px" } }) })).toThrow(/one custom property/);
  });

  test("the message names the segment and says what a name may hold", () => {
    expect(of({ space: kind("length", { "b*c": "8px" }) })).toThrow(/b\*c/);
  });

  /** Everything a `$` path can reach is still accepted, which is the whole permitted set. */
  test.each([
    ["letters", "gutter"],
    ["a dash", "gutter-wide"],
    ["an underscore", "gutter_wide"],
    ["digits", "gutter2"],
    ["starting with a digit, which CSS allows after `--`", "2xl"],
    ["capitals", "Gutter"],
  ])("a name of %s goes in", (_what, name) => {
    expect(of({ space: kind("length", { [name]: "8px" }) })).not.toThrow();
  });

  test.each([
    ["a call", "calc(1rem + 2px)"],
    ["a var()", "var(--other, 8px)"],
    ["a comma", "0 0 4px rgba(0, 0, 0, 0.5)"],
    ["a quoted string", '"a b"'],
    ["a url", "url(a.png)"],
  ])("a value holding %s goes in", (_what, value) => {
    expect(of({ space: kind("custom-ident", { gutter: value }) })).not.toThrow();
  });
});

/**
 * The count in the module's own header, which a formatting change broke.
 *
 * It was `rows.split("\n").length / 2` — every row assumed to be a one-line doc comment and a
 * declaration. Giving the closed-list rows a longer comment made it read **207.5 properties**, in a
 * sentence a reader sees. A count a formatting change can break is not a count.
 */
describe("the header's count", () => {
  test("is a whole number, whatever shape the rows take", () => {
    const { module } = generate({}, { "z-index": { values: [0, 1] }, "*": { arity: 1 } });
    const said = /The (\S+) properties this project narrows/.exec(module);

    expect(said).not.toBeNull();
    expect(Number.isInteger(Number(said?.[1]))).toBe(true);
  });

  test("and it counts the rows, not the lines", () => {
    const { module } = generate({}, { "z-index": { values: [0, 1] } });
    const said = Number(/The (\S+) properties/.exec(module)?.[1]);
    const declared = [...module.matchAll(/^ {2}"[^"]+"\??:/gm)].length;

    expect(said).toBe(declared);
  });
});

/**
 * The generated module passes on EVERY type the shipped map exports and it does not define.
 *
 * It replaces that map for every file in the project, so a name it drops stops existing. Four were
 * passed on and seven were missing, and three of those seven are what a NAMED block is checked
 * against — so `@@property`, `@@keyframes` and `@@font-face` all stopped type-checking the moment a
 * project declared a variable. `generated.test.ts` holds the behaviour; this holds the LIST, which
 * is what would rot first: the next type added to `properties.ts` is the next one forgotten.
 *
 * Read off the shipped file's own text rather than written out here, because a second copy of the
 * list is the thing this is trying to stop.
 */
describe("what the generated module passes on", () => {
  const shipped = readFileSync(join(PACKAGE, "src", "properties.ts"), "utf8");

  /** Every type `properties.ts` exports, however it spells the export. */
  const exported = new Set<string>();
  for (const [, names] of shipped.matchAll(/export type \{([^}]*)\}/g)) {
    for (const one of names.split(",")) {
      const name = one
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name !== undefined && name !== "") exported.add(name);
    }
  }
  for (const [, name] of shipped.matchAll(/^export (?:type|interface) ([A-Za-z]\w*)/gm)) exported.add(name);

  /** What the generated module defines for itself, narrowed by the config — see its own note. */
  const ITS_OWN = new Set(["CssProperties", "CssBlockShape"]);

  test("every one of them, and the list is read from `properties.ts` rather than repeated", () => {
    const module = generate({ space: kind("length", { gutter: "16px" }) }).module;
    const missing = [...exported].filter((one) => !ITS_OWN.has(one) && !module.includes(one));

    // The control: the sweep found something to check, so an empty set cannot pass for free.
    expect(exported.size).toBeGreaterThan(8);
    expect(missing).toEqual([]);
  });
});
