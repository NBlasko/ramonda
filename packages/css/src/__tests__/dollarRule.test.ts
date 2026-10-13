import { describe, expect, test } from "vitest";
import type { Config } from "../config/config";
import { readBlock } from "../compiler/read";
import { type Finding, checkBlock } from "../compiler/rules";
import { findBlocks } from "../compiler/scan";
import { kind } from "../config/declared";

/**
 * `$a.b.c` naming a variable the project never declared.
 *
 * **This is the rule that stops `$` being a quiet way to write a `var()` into nothing.** The
 * compiler emits `var(--a-b-c)` from the path alone and reads no config to do it — deliberately, so
 * the CLI, the bundler and the editor cannot disagree — which means a typo compiles to a name
 * nothing sets. Registered variables resolve to their initial value; an unregistered one resolves to
 * nothing and the property silently becomes something else. Measured: `height: var(--never-set)`
 * laid an element out at 0px with nothing reported anywhere.
 *
 * The types catch this in an editor. This is for everywhere else: CI, a pre-commit hook, a reviewer.
 */

const declared: Config = {
  tokens: {
    $color: kind("color", { primary: { main: "#3b82f6", light: "#93c5fd" } }),
    $size: kind("length", { control: { md: "30px" } }),
  },
};

function check(css: string, config: Config | undefined): Finding[] {
  const source = `<div className={@@(\n${css}\n)}>x</div>`;
  const [site] = findBlocks(source);
  const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
  return checkBlock(read.block, { config });
}

const rules = (css: string, config: Config | undefined = declared) => check(css, config).map((one) => one.rule);
const messages = (css: string, config: Config | undefined = declared) => check(css, config).map((one) => one.message);

describe("a `$` path the project did not declare", () => {
  test("a declared path is silent, which is the case that must not regress", () => {
    expect(rules("color: $color.primary.main;")).toEqual([]);
    expect(rules("padding: $size.control.md;")).toEqual([]);
  });

  test("an undeclared path is reported, and a near miss is offered", () => {
    expect(rules("color: $color.primary.mian;")).toEqual(["unknown-token"]);
    expect(messages("color: $color.primary.mian;")[0]).toContain("color.primary.main");
  });

  test("a path with nothing like it gets no invented suggestion", () => {
    expect(rules("color: $nothing.like.it;")).toEqual(["unknown-token"]);
    expect(messages("color: $nothing.like.it;")[0]).not.toContain("Did you mean");
  });

  test("a GROUP is reported too, because a group is not a value", () => {
    expect(rules("color: $color.primary;")).toEqual(["unknown-token"]);
    expect(messages("color: $color.primary;")[0]).toMatch(/group/i);
  });

  test("`$` with nothing after it is reported rather than compiled", () => {
    expect(rules("color: $;")).toEqual(["unknown-token"]);
    expect(messages("color: $;")[0]).toContain("`$( … )`");
  });

  test("a project that declared NO variables is told so, not quietly allowed", () => {
    // The user's own instruction on defaults: a config that permits everything when it was never
    // set means people can do as they like without ever learning the config exists.
    expect(rules("color: $color.primary.main;", {})).toEqual(["unknown-token"]);
    expect(messages("color: $color.primary.main;", {})[0]).toMatch(/declares no tokens/i);
  });

  test("no config object at all is silence, because nothing was asked", () => {
    // `transform` may be called without one — by a test, or by a caller that does not want
    // config-aware checking. That is different from a config that declares nothing.
    expect(rules("color: $color.primary.main;", undefined)).toEqual([]);
  });

  test("the finding lands on the path, not on the declaration", () => {
    const source = `<div className={@@(\ncolor: $color.primary.mian;\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    const [found] = checkBlock(read.block, { config: declared });

    expect(source.slice(found.at, found.at + (found.length ?? 0))).toBe("$color.primary.mian");
  });
});

/**
 * A `$` whose GROUP the project does not have — the case most likely to be a reach for code.
 *
 * `$` and a name is only ever a token, so `$theme.dark` or `$props.size` is somebody who
 * meant a value from TypeScript. The message names the groups that DO exist, and the door for code.
 */
describe("a `$` naming a group the project does not have", () => {
  test("names the groups there are, and `$( … )` for a value from code", () => {
    expect(rules("color: $props.tone;")).toEqual(["unknown-token"]);
    const [message] = messages("color: $props.tone;");

    expect(message).toContain("`$color`");
    expect(message).toContain("`$size`");
    expect(message).toContain("`$( … )`");
  });

  test("a misspelt group is offered the nearest one", () => {
    expect(messages("color: $colr.primary.main;")[0]).toContain("`$color.primary.main`");
  });

  test("a known group with a wrong path is not told about code", () => {
    expect(messages("color: $color.primary.mian;")[0]).not.toContain("`$( … )`");
  });
});

/**
 * `var(--color-primary-main)` written by hand for a variable the project DECLARES.
 *
 * It renders the same, and it is the one spelling of a variable nothing checks: rename the variable
 * in `ramonda.css.ts` and this keeps reading the old name, which nothing sets. `$color.primary.main`
 * is checked against the config, so the message names it.
 */
describe("a token read with a hand-written `var()`", () => {
  test("is reported, naming the spelling to write instead", () => {
    expect(rules("color: var(--color-primary-main);")).toEqual(["token-by-hand"]);
    expect(messages("color: var(--color-primary-main);")[0]).toContain("`$color.primary.main`");
  });

  test("inside a longer value, on the `var()` itself", () => {
    const source = "<div className={@@(\nborder: 1px solid var(--color-primary-light);\n)}>x</div>";
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    const [found] = checkBlock(read.block, { config: declared });

    expect(source.slice(found.at, found.at + found.length)).toBe("var(--color-primary-light)");
  });

  test.each([
    ["a name the project does not declare", "color: var(--brand);"],
    ["one with a fallback, which `$` cannot say", "color: var(--color-primary-main, red);"],
    ["a group's name, which is no variable", "color: var(--color-primary);"],
    ["the `$` spelling itself", "color: $color.primary.main;"],
  ])("%s is left alone", (_what, css) => {
    expect(rules(css)).toEqual([]);
  });

  test("with no config, nothing is asked", () => {
    expect(check("color: var(--color-primary-main);", undefined)).toEqual([]);
  });
});

/**
 * A token SET in a block, against what its declaration allows.
 *
 * A bare declaration means it never changes — the hover says `Fixed<…>` and `toStyle` refuses to set
 * it — and a `range` lists what it may become. Both were promises only `toStyle` kept: measured, a
 * block wrote `--color-surface-sunken: red` over a fixed variable, and a value outside a range, in
 * silence. `@property` cannot forbid it; CSS lets anything set a custom property.
 */
describe("a token set in a block", () => {
  const themed: Config = {
    tokens: {
      $color: kind("color", {
        sunken: "#f3f4f6",
        moving: { value: "#ffffff", range: ["#ffffff", "#111827"] },
        free: { value: "#ffffff", range: "any" },
      }),
    },
  };
  const set = (css: string) => check(css, themed);

  test.each([
    ["at the top", "--color-sunken: red;"],
    ["to its own value", "--color-sunken: #f3f4f6;"],
    ["in a nested rule", "&:hover { --color-sunken: red; }"],
    ["in a `when`", "when $(a) { --color-sunken: red; }"],
    ["in a match arm", "match $(t) { a => ( --color-sunken: red; ); _ => (); }"],
  ])("a FIXED one is refused %s, naming the variable and `range`", (_what, css) => {
    const found = set(css).filter((one) => one.rule === "token-set-against-its-declaration");

    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("`$color.sunken`");
    expect(found[0].message).toContain("range");
  });

  test.each([
    ["outside the range", "--color-moving: red;", "red"],
    ["one branch of a choice outside it", "--color-moving: $(a) ? #ffffff : red;", "red"],
    ["one arm of a match outside it", "--color-moving: match $(t) { a => #111827; _ => blue; };", "blue"],
  ])("a value %s is refused, naming it and the range", (_what, css, value) => {
    const found = set(css).filter((one) => one.rule === "token-set-against-its-declaration");

    expect(found).toHaveLength(1);
    expect(found[0].message).toContain(`\`${value}\``);
    expect(found[0].message).toContain("#ffffff, #111827");
  });

  test.each([
    ["a value in the range", "--color-moving: #111827;"],
    ["in another case", "--color-moving: #FFFFFF;"],
    ["with `!important`", "--color-moving: #111827 !important;"],
    ["a choice inside it", "--color-moving: $(a) ? #ffffff : #111827;"],
    ["a range of `any`", "--color-free: red;"],
    ["a value from a `var()`, which is not known here", "--color-moving: var(--elsewhere);"],
    ["a name the project did not declare", "--brand: red;"],
  ])("%s is not", (_what, css) => {
    expect(set(css).map((one) => one.rule)).not.toContain("token-set-against-its-declaration");
  });
});

/**
 * `unknownCustomProperties: false` — a project that wants no custom property made up on the spot.
 *
 * Asked for by the user: a name invented in one block and read in another works by luck and breaks
 * by a typo, and this project has three doors that are checked — tokens, `@@property`, and the
 * names an outside stylesheet sets. With the switch off, any other name is refused.
 */
describe("a custom property nobody declared, with `unknownCustomProperties: false`", () => {
  const strict: Config = {
    tokens: { $color: kind("color", { accent: "#00f" }) },
    externalCustomProperties: ["--mui-primary"],
    unknownCustomProperties: false,
  };
  const found = (css: string, config: Config = strict) =>
    check(css, config)
      .filter((one) => one.rule === "unknown-custom-property")
      .map((one) => one.message);

  test.each([
    ["set", "--brand: red;", "--brand"],
    ["read", "color: var(--brand);", "--brand"],
    ["read with a fallback", "color: var(--brand, blue);", "--brand"],
    ["read inside a function", "color: color-mix(in srgb, var(--brand), white);", "--brand"],
    ["read in a choice branch", "color: $(a) ? var(--brand) : blue;", "--brand"],
    ["set in a nested rule", "&:hover { --brand: red; }", "--brand"],
  ])("is refused, %s", (_what, css, name) => {
    const [only, ...rest] = found(css);

    expect(rest).toEqual([]);
    expect(only).toContain(`\`${name}\``);
    expect(only).toContain("`tokens`");
    expect(only).toContain("`@@property");
    expect(only).toContain("`externalCustomProperties`");
  });

  test.each([
    ["a token set by name", "--color-accent: #00f;"],
    ["an outside name, read and set", "--mui-primary: red; color: var(--mui-primary);"],
    ["a registered property, through its binding", "color: var($(w));"],
  ])("is not: %s", (_what, css) => {
    expect(found(css)).toEqual([]);
  });

  test("and nothing is refused when the switch is left alone", () => {
    expect(found("--brand: red; color: var(--brand);", { tokens: strict.tokens })).toEqual([]);
  });
});

/**
 * `unknownCustomProperties: "same-block"` — a made-up name is a LOCAL: one block both sets it and
 * reads it, and nothing else may. The user's rule: global goes in the theme, local is written with
 * `var`, and a value scoped beyond one block is a `@@property`. A typo cannot hide, because a local
 * read and its local setting are in the same few lines.
 */
describe('a made-up custom property with `unknownCustomProperties: "same-block"`', () => {
  const local: Config = {
    tokens: { $color: kind("color", { accent: "#00f" }) },
    externalCustomProperties: ["--mui-primary"],
    unknownCustomProperties: "same-block",
  };
  const found = (css: string) =>
    check(css, local)
      .filter((one) => one.rule === "unknown-custom-property")
      .map((one) => one.message);

  test.each([
    ["set and read in the block", "--gap: 4px; padding: var(--gap);"],
    ["set at the top and read in a nested rule", "--gap: 4px; &:hover { padding: var(--gap); }"],
    ["a token, set by name", "--color-accent: red;"],
    ["an outside name, read alone", "color: var(--mui-primary);"],
  ])("is allowed: %s", (_what, css) => {
    expect(found(css)).toEqual([]);
  });

  test("a name read but not set in this block is refused, saying so", () => {
    const [only, ...rest] = found("padding: var(--gap);");

    expect(rest).toEqual([]);
    expect(only).toContain("`--gap` is read here and not set in this block");
    expect(only).toContain("`tokens`");
    expect(only).toContain("`@@property");
  });

  test("a name set but read nowhere in this block is refused too — it could only be for another element", () => {
    const [only, ...rest] = found("--gap: 4px; padding: 2px;");

    expect(rest).toEqual([]);
    expect(only).toContain("`--gap` is set here and read nowhere in this block");
  });

  test("a misspelt read beside its setting is caught", () => {
    // In source order: the setting comes first.
    expect(found("--gap: 4px; padding: var(--gpa);")).toEqual([
      expect.stringContaining("`--gap` is set here and read nowhere in this block"),
      expect.stringContaining("`--gpa` is read here and not set in this block"),
    ]);
  });
});

/**
 * `styleOtherElements: false` — a block styles its own element and nothing else.
 *
 * Asked for by the user: a parent reaching into a child (`.title { … }`, `& > img`) or a sibling
 * (`& + .card`) makes two independently composed elements depend on each other, and neither file
 * says so. With the switch off, a selector whose subject — its last compound — is not `&` is refused.
 */
describe("a selector on another element, with `styleOtherElements: false`", () => {
  const own: Config = { styleOtherElements: false };
  const found = (css: string, config: Config = own) =>
    check(css, config)
      .filter((one) => one.rule === "styles-another-element")
      .map((one) => one.message);

  test.each([
    ["a child by class", ".title { font-weight: 700; }", ".title"],
    ["a child with `&`", "& .title { font-weight: 700; }", "& .title"],
    ["a direct child", "& > img { width: 100%; }", "& > img"],
    ["a sibling", "& + .card { margin-top: 8px; }", "& + .card"],
    ["a later sibling", "& ~ p { color: red; }", "& ~ p"],
    ["a child on hover", "&:hover .icon { opacity: 1; }", "&:hover .icon"],
    ["one of a list", "&:hover, & .icon { opacity: 1; }", "& .icon"],
    ["a child inside a state", "&:hover { & .icon { opacity: 1; } }", "& .icon"],
  ])("is refused: %s", (_what, css, selector) => {
    const [only, ...rest] = found(css);

    expect(rest).toEqual([]);
    expect(only).toContain(`\`${selector}\` styles another element`);
  });

  test.each([
    ["a state", "&:hover { color: red; }"],
    ["a pseudo-element", '&::before { content: ""; }'],
    ["a class on itself", "&.active { color: red; }"],
    ["an attribute on itself", '&[aria-busy="true"] { opacity: 0.5; }'],
    ["itself, by what it holds", "&:has(> img) { padding: 0; }"],
    ["itself, under an ancestor", '[data-theme="dark"] & { color: white; }'],
    ["a condition", "@media (min-width: 40rem) { padding: 8px; }"],
    ["a group", "when $(on) { color: red; }"],
  ])("is allowed: %s", (_what, css) => {
    expect(found(css)).toEqual([]);
  });

  test("and nothing is refused when the switch is left alone", () => {
    expect(found(".title { font-weight: 700; } & > img { width: 100%; }", {})).toEqual([]);
  });
});

/**
 * Review round 2: the strict options against the named sites, measured through one project with
 * every option on. Both false reports broke a correct build.
 */
describe("the strict options against `@@keyframes` and `@@property`", () => {
  const strict: Config = { styleOtherElements: false, unknownCustomProperties: "same-block" };
  const named = (source: string) => {
    const sites = findBlocks(source);
    const site = sites[sites.length - 1];
    const references = new Map([["angle", "--r-angle"]]);
    const read = readBlock(source, site.open, "C.tsx", { tolerant: true, resolve: (name) => references.get(name) });
    return checkBlock(read.block, { at: site.at, config: strict, references }).map((one) => one.rule);
  };

  test("a frame is not a selector on another element", () => {
    expect(named(`const k = @@keyframes( from { opacity: 0; } 50% { opacity: 0.5; } to { opacity: 1; } );`)).toEqual(
      [],
    );
  });

  test("a frame setting a registered property through its binding is not a made-up name", () => {
    expect(named(`const k = @@keyframes( from { $(angle): 0deg; } to { $(angle): 90deg; } );`)).toEqual([]);
  });

  test("nor is a block setting one through its binding", () => {
    expect(named(`const b = @@( $(angle): 45deg; transform: rotate(var($(angle))); );`)).toEqual([]);
  });
});

/**
 * Review round 5: setting a ranged token to a value in its range, under `hardcoded: false`.
 *
 * Measured: `--color-moving: #000;` was refused as a colour written out, while its range permits
 * `#000` — two rules saying opposite things about one line. Setting a token IS where a colour is
 * written: that is what a theme is. Its value is the range's to judge
 * (`token-set-against-its-declaration`), so `hardcoded` stands aside on it.
 */
describe("a token set under `hardcoded: false`", () => {
  const config: Config = {
    tokens: { $color: kind("color", { moving: { value: "#fff", range: ["#fff", "#000"] }, fixed: "#111" }) },
    properties: { "<color>": { hardcoded: false }, "<length>": { hardcoded: false } },
  };
  const rules = (css: string) => check(css, config).map((one) => one.rule);

  test("to a value in its range is not a hardcoded colour", () => {
    expect(rules("--color-moving: #000;")).toEqual([]);
  });

  test("to one outside its range is the range's fault, said once", () => {
    expect(rules("--color-moving: red;")).toEqual(["token-set-against-its-declaration"]);
  });

  test("and an ordinary property still may not hold a colour written out", () => {
    expect(rules("color: #000;")).toEqual(["hardcoded-not-allowed"]);
  });
});
