import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import * as compiler from "../compiler/index";
import * as api from "../index";

/**
 * What each entry exports, asserted as a list — the same tripwire the other packages have.
 *
 * The entries are not one audience. `@ramonda/css` is loaded by every page that renders a block, so
 * anything added to it is shipped to a browser; `@ramonda/css/compiler` runs in a build and may
 * reach for `node:crypto`. The split is what keeps the second out of the first, and a list per entry
 * is what keeps the split honest.
 *
 * **It used to say "there are two entries", and there are eight.** Two were asserted and six were
 * not, and `./properties` — the one this package's users import `CssBlock` from, and the one a
 * release reshaped most — was among them. A tripwire that watches a quarter of a surface is a
 * tripwire with a quarter of a claim.
 */
/**
 * `mergeClassNames` is composition's half: the order of classes in a `class` attribute decides
 * nothing — measured — so keeping ONE class per thing set is the only place precedence can be
 * decided, and the call site is where it happens.
 */
const RUNTIME = [
  /**
   * What a module REGISTERS, which is the half a class string cannot carry.
   *
   * `shorthands` is what a `padding` needs to clear a caller's `padding-left`, and it ships because
   * clearing is what a merge does. `conditionsOf` and `namesOf` are read only by the development
   * warning, and the emitted call is guarded so a production bundle drops both.
   */
  "conditionsOf",
  "mergeClassNames",
  "namesOf",
  /**
   * What a `match` chooses between at run time. The compiler emits the call and the table, so this
   * is here for the same reason `mergeClassNames` is: the emitted module imports it by name, and a name a
   * build imports is part of the surface whether anybody writes it themselves or not.
   */
  "pick",
  // A declared variable OUTSIDE a block: setting one for a runtime theme, and reading one back.
  // Inside a block `$` is compiled away, so these are the only two that ever ship.
  "read",
  "shorthands",
  "toStyle",
  // What a development build's emitted code calls for a spread when source marks are on.
  "withoutSourceMarks",
];

/**
 * The TYPES the runtime entry exports, which `Object.keys` cannot see.
 *
 * That blindness was real: seven types were added to this entry and every assertion above stayed
 * green, because a type is gone by the time there is an object to ask. A published type is a promise
 * exactly as a published function is — it is what somebody writes in their own annotation — so it
 * needs the same tripwire, and it needs it read from the SOURCE rather than from a runtime object.
 */
const TYPES = [
  "CssAngleUnit",
  // A colour, for the declaration that makes one. Ninety-six properties say what they take now, so
  // a value reaching one through a hole has to say what it is — and this is what says it.
  "CssColor",
  "CssColorKeyword",
  "CssDimension",
  "CssFrequencyUnit",
  "CssLengthUnit",
  "CssResolutionUnit",
  "CssTimeUnit",
  // The name `@@property( … )` binds, carrying its declared kind — what a setter checks against.
  "CssVar",
  "CssUnit",

  // What `$color.primary.main` is, for the module codegen writes. A type and nothing else: a
  // token's runtime value is the string `var(--name)`, written into that module, so importing `$`
  // pulls in no code from here at all.
  // A bare declaration's mark, named by the generated module and so part of the surface.
  "Fixed",
  "Kind",
  "Setting",
  "StyleValue",
  "Token",
  "ValueByKind",
];

/** Everything one module exports, values and types alike, through a real program. */
function exportsOf(entry: string): string[] {
  const program = ts.createProgram([entry], { strict: true, target: ts.ScriptTarget.ES2022, noEmit: true });
  const file = program.getSourceFile(entry);
  if (file === undefined) throw new Error(`no source file for ${entry}`);

  const checker = program.getTypeChecker();
  const symbol = checker.getSymbolAtLocation(file);
  if (symbol === undefined) throw new Error(`${entry} is not a module`);

  return checker
    .getExportsOfModule(symbol)
    .map((one) => one.name)
    .sort();
}

const COMPILER = [
  "CssBlockError",
  "Sheet",
  "checkBlock",
  "checkSource",
  "checkText",
  "HASH_LENGTH",
  "HOLE",
  "MEDIA_FEATURES",
  "classNameFor",
  "fileMayHoldABlock",
  "findBlocks",
  "mayHoldABlock",
  "holeOutOfPlace",
  // The key a class carries — what its declaration SETS. `keyIn` reads one back out of a class name,
  // which is how a merge decides anything once a block travels as a string. See `keyToken`.
  "keyIn",
  "keyTextOf",
  "keyToken",
  "normalise",
  // The key a class carries, split into the context it sits in and the property it sets.
  "partsOf",
  "placehold",
  "positionOf",
  "readBlock",
  "substitute",
  "transform",
  "variableNameFor",
  "virtualFile",
];

/**
 * `ramonda.css.ts` imports from here and nothing else does. `defineConfig` and `kind` are what a
 * config file calls; the five types are what it is checked against.
 */
const CONFIG = ["Config", "Declared", "Kind", "ValueByKind", "Variable", "defineConfig", "kind"];

/**
 * The types a COMPONENT is written against, and the entry a reader is sent to for them.
 *
 * `CssBlock` is here rather than on the runtime entry, which is worth a list of its own: a project
 * with a `ramonda.css.ts` gets it re-exported through the generated `css-system`, and one without a
 * config imports it from here. Either way this is where it lives.
 */
const PROPERTIES = [
  "CssBlock",
  "CssBlockShape",
  "CssCondition",
  "CssFontFaceDescriptors",
  "CssGlobal",
  "CssKeyframesShape",
  "CssProperties",
  "CssPropertyDescriptors",
  "CssRegistered",
  "CssSpreadable",
  "CssValue",
  "CssVar",
  "Keyword",
  "Narrowed",
  "StyleValue",
];

/** A bundler adapter is one function and the shapes of what it is handed. */
const VITE = ["Bundle", "CssPluginLike", "CssPluginOptions", "HotUpdate", "ramondaCss"];
const ESBUILD = ["EsbuildCssPluginLike", "EsbuildCssPluginOptions", "EsbuildLike", "loaderFor", "ramondaCss"];

/**
 * One default and nothing beside it, for both of these.
 *
 * Prettier loads a plugin by its default export and a TypeScript language service loads one by
 * `init`, which `plugin.cjs.ts` default-exports. A named export added here would be a thing neither
 * host looks at, which is the kind of surface that grows unnoticed.
 */
const ONE_DEFAULT = ["default"];

describe("public API surface", () => {
  test("the runtime entry exports exactly what it means to", () => {
    expect(Object.keys(api).sort()).toEqual([...RUNTIME].sort());
  });

  test("the compiler entry exports exactly what it means to", () => {
    expect(Object.keys(compiler).sort()).toEqual([...COMPILER].sort());
  });

  test("and exactly the types it means to, which `Object.keys` cannot see", () => {
    const entry = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

    expect(exportsOf(entry)).toEqual([...RUNTIME, ...TYPES].sort());
  });

  /**
   * The six entries nothing watched. Read from SOURCE, like the types test above — `Object.keys`
   * cannot see a type, and `./properties` is nothing but types.
   */
  test.each([
    ["configEntry.ts", CONFIG],
    ["properties.ts", PROPERTIES],
    ["vite.ts", VITE],
    ["esbuild.ts", ESBUILD],
    ["prettier.ts", ONE_DEFAULT],
    ["plugin.cjs.ts", ONE_DEFAULT],
  ])("%s exports exactly what it means to", (file, expected) => {
    const entry = join(dirname(fileURLToPath(import.meta.url)), "..", file);

    expect(exportsOf(entry)).toEqual([...expected].sort());
  });

  test("the runtime entry does not re-export the compiler", () => {
    // The class name is decided at build time. A runtime that could hash one would be a runtime that
    // could invent a rule, and no rule is ever created at runtime — see DESIGN.md, decision 7.
    for (const name of COMPILER) expect(api).not.toHaveProperty(name);
  });
});
