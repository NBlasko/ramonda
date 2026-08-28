/**
 * Type-checks every code block in the documentation and in the packages' READMEs.
 *
 * ## The fault it exists for
 *
 * `packages/query/README.md` called `draft(title)`. Nothing named `draft` exists anywhere in the
 * repository, so that example could never have run — and it sat there because the same example lives
 * in three hand-maintained copies (the docs page, this README, and a doc comment on `Mutation`) and
 * one of them drifted. Nothing compiled any of them.
 *
 * Measured before this was written: 265 blocks across the docs and the READMEs, 41 examples that
 * exist in more than one place, and no check of any kind over any of them.
 *
 * ## Why a preamble, rather than making every block a whole file
 *
 * Most blocks are fragments on purpose — `api.createTodo(title)` is the reader's own code, and a
 * block that had to declare `api`, `Todo` and a schema before it could show one line would teach
 * worse. So the context is declared ONCE per section, in an ordinary `.ts` file the editor checks
 * too, and prepended to every block on the pages below it.
 *
 * That is what makes `draft` a failure and `api` a fact: `api` is declared in a preamble because
 * somebody decided it should be, and `draft` is not because nobody ever did.
 *
 *   node scripts/check-examples.mjs           # check everything
 *   node scripts/check-examples.mjs query     # only paths containing "query"
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, globSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const filter = process.argv[2];

/* ── what counts as an example ─────────────────────────────────────────────────────────────── */

/**
 * A fenced block worth checking.
 *
 * `sh`, `json`, `jsonc` and the rest are not TypeScript. A `tsx` block of one line is usually a
 * signature being pointed at rather than code, and wrapping it in a file to check it would report
 * on something nobody wrote.
 */
const CHECKED = new Set(["ts", "tsx"]);

/**
 * What this check does not ask of an example, and why.
 *
 * Each of these is a question about a whole program, and a documentation block is deliberately not
 * one. Leaving them on would report the docs for being docs, and a gate that cries wolf is a gate
 * somebody turns off.
 */
const IGNORED = new Set([
  // 2307 — a module the block imports that is not Ramonda's. `import { z } from "zod"` is the
  // reader's dependency, not ours to resolve.
  2307,
  // 2515 — a class that does not implement `render`. Showing ONE member of a component is how most
  // of these pages teach; requiring `render` beside it would put noise in every example.
  2515,
  // 2564 — a property with no initializer. `@state count: number;` is the shape being pointed at.
  2564,
]);

function blocksIn(file) {
  const text = readFileSync(file, "utf8");
  const out = [];
  const pattern = /```(\w+)([^\n]*)\n([\s\S]*?)```/g;
  for (const match of text.matchAll(pattern)) {
    const [, lang, attrs, code] = match;
    if (!CHECKED.has(lang)) continue;
    if (code.trim().split("\n").length < 2) continue;
    // ```ts expect-error — a block that shows what a MISTAKE looks like. The bguard page teaches
    // that `ctx.sibling((row) => row.kynd)` does not compile; reporting it would be reporting the
    // lesson. markdown-it hands the language and the attributes separately, so the marker costs no
    // highlighting.
    // ```tsx alternatives — two ways of writing the same thing, shown side by side. As one file
    // they collide, and the collision is the point rather than a fault.
    if (attrs.includes("expect-error") || attrs.includes("alternatives")) {
      expected.push({ file, line: text.slice(0, match.index).split("\n").length + 1 });
      continue;
    }
    // The line the code starts on, so an error can name a place in the markdown.
    const line = text.slice(0, match.index).split("\n").length + 1;
    out.push({ code, line });
  }
  return out;
}

/**
 * The declaration files a block is checked against, outermost first.
 *
 * They are AMBIENT — `declare global` in a `.d.ts` — rather than text pasted above the block, and
 * that is what makes the arrangement work. A block stays its own module, so it may import
 * `Component` itself without colliding with the context, and every error points at the line the
 * reader can see instead of one shifted by however long the preamble was.
 *
 * A page inherits `content/_preamble.d.ts`, then its own section's, then one named for the page.
 * Every one is optional.
 */
function preamblesFor(file) {
  const found = [];
  const add = (path) => {
    if (existsSync(path)) found.push(path);
  };
  if (file.startsWith("apps/docs/content/")) {
    add(join(repo, "apps/docs/content/_preamble.d.ts"));
    const dir = dirname(file);
    if (dir !== "apps/docs/content") add(join(repo, dir, "_preamble.d.ts"));
    add(join(repo, file.replace(/\.md$/, ".preamble.d.ts")));
  } else {
    add(join(repo, "packages/_preamble.d.ts"));
    add(join(repo, dirname(file), "README.preamble.d.ts"));
  }
  return found;
}

/**
 * Every name Ramonda exports, as an ambient global.
 *
 * Derived from the packages' own declarations rather than written down, and that is the point: when
 * an export is renamed the global is renamed with it, and any example still using the old name stops
 * compiling. Written by hand it would be one more copy to drift — which is the fault this whole
 * script exists for.
 *
 * A fragment may still import what it uses; an import shadows a global, so both spellings check.
 */
/**
 * Names the DOM already owns.
 *
 * `@ramonda/router` exports `Navigator`, and so does `lib.dom` — as a `var`, which a `declare global`
 * of ours cannot outrank. So those names are left out of the generated globals, and diagnostics that
 * mention one are skipped: in real code the reader imports the router's, and an import shadows a
 * global, so the ambiguity exists only in a fragment that shows no imports.
 *
 * Read from TypeScript's own lib rather than listed here, so it stays true as TypeScript changes.
 */
function domGlobals() {
  const lib = join(dirname(fileURLToPath(import.meta.resolve("typescript"))), "lib.dom.d.ts");
  const names = new Set();
  try {
    const text = readFileSync(lib, "utf8");
    for (const m of text.matchAll(/^declare var (\w+)\s*:/gm)) names.add(m[1]);
  } catch {
    // No lib to read means no collisions can be detected; the errors will say so plainly.
  }
  return names;
}

const DOM_GLOBALS = domGlobals();

/** Ramonda names the DOM also owns, filled in as the globals are generated and skipped when reporting. */
const shadowed = new Set();

/** Blocks that are not one program — a mistake shown on purpose, or two alternatives. */
const expected = [];

/**
 * The framework's own names, read from the BUILT `.d.ts` rather than written down here — which is
 * why this runs after `turbo run build` in `pnpm check`. Measured with `packages/core/dist` moved
 * aside: the globals come out empty and every example fails on `Component`. On a fresh checkout
 * that is what CI would see, so the order in the script is load-bearing rather than tidy.
 */
function ramondaGlobals(except = new Set()) {
  const values = new Set();
  const types = new Set();
  const classes = new Set();
  const taken = new Set();
  /** Each type's parameter list, so the alias can pass them through rather than swallowing them. */
  const generics = new Map();

  /**
   * Every ENTRY POINT, not only the main one.
   *
   * `index.d.ts` alone left a hole with no way to notice it: `IsrStore` is exported from
   * `@ramonda/router/server`, so the store example on the ISR modes page could not be annotated with
   * it, and stood as an untyped object literal. It could have drifted from the interface it teaches
   * and this gate would have said nothing — which is the one thing a gate exists to stop.
   *
   * Read from `dist` rather than from source, exactly as the main entries are. The alternative — a
   * preamble importing the type — pulls the router's SOURCE and its whole import graph into a
   * program configured with `types: []`, and the file it is written in stops applying: measured, 46
   * errors across 19 blocks, none of them about ISR.
   *
   * Sorted so `index.d.ts` comes first and wins any name it shares with a sibling entry, which is
   * what `taken` below decides. `server.d.ts` and `server.browser.d.ts` export the same names for
   * two environments, and the main entry is the one a reader means.
   */
  const entries = globSync("packages/*/dist/*.d.ts", { cwd: repo })
    .filter((path) => !path.split("/").pop().includes("-"))
    .sort((a, b) => Number(b.endsWith("index.d.ts")) - Number(a.endsWith("index.d.ts")));

  for (const declaration of entries) {
    const pkg = declaration.split("/")[1];
    const entry = declaration
      .split("/")
      .pop()
      .replace(/\.d\.ts$/, "");
    const base = pkg === "core" ? "@ramonda/core" : `@ramonda/${pkg}`;
    const specifier = entry === "index" ? base : `${base}/${entry}`;
    const text = readFileSync(join(repo, declaration), "utf8");
    const exported = [...text.matchAll(/^export \{([^}]*)\};/gms)].flatMap((m) => m[1].split(","));

    /**
     * What each name IS, read off its declaration across the whole build rather than off the export
     * list. The list is not enough: core exports `RamondaNode` with no `type` modifier even though
     * it is one, and its declaration lives in a chunk the entry only re-exports from. Declared as a
     * value it made every `: RamondaNode` in the docs an error — fifty of them.
     */
    const declaredType = new Set();
    const declaredClass = new Set();
    for (const part of globSync(`packages/${pkg}/dist/*.d.ts`, { cwd: repo })) {
      const partText = readFileSync(join(repo, part), "utf8");
      // The parameter list may contain defaults (`<Input = unknown, Output = Input>`) and nested
      // angles, so it is matched by balance rather than by "anything but `=`".
      for (const m of partText.matchAll(/^(?:declare )?(?:type|interface) (\w+)(<(?:[^<>]|<[^<>]*>)*>)?[\s={]/gm)) {
        declaredType.add(m[1]);
        // Its type parameters, kept so the alias below can pass them through. Without this
        // `StandardSchemaV1<Signup, Signup>` collapsed to `StandardSchemaV1<unknown, unknown>`
        // and every `f.email` on the form pages became an error about a name the schema has.
        if (m[2] && !generics.has(m[1])) generics.set(m[1], m[2]);
      }
      // A class is a value AND a type. Declared only as a value, `<This extends Component>` in a
      // doc example failed on the framework's own base class.
      for (const m of partText.matchAll(/^(?:declare )?(?:abstract )?class (\w+)/gm)) declaredClass.add(m[1]);
    }

    for (const raw of exported) {
      const entry = raw.trim();
      if (entry === "") continue;
      const name = entry
        .replace(/^type /, "")
        .split(" as ")
        .pop()
        .trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
      // A preamble beside the page says what this name means THERE, and that is more specific than
      // the framework's export of the same word — `lens` uses `state` for the reader's object while
      // core exports `state` as a decorator. The local declaration wins.
      if (except.has(name)) continue;
      // The DOM already declares this one, and its `var` wins over anything we add.
      if (DOM_GLOBALS.has(name)) {
        shadowed.add(name);
        continue;
      }
      // A name two packages both export is declared once; the first wins, which is core.
      if (taken.has(name)) continue;
      taken.add(name);
      const isType = entry.startsWith("type ") || declaredType.has(name);
      (isType ? types : values).add(`${name}\u0000${specifier}`);
      // Both, for a class: the constructor to call and the instance type to extend.
      if (declaredClass.has(name)) classes.add(`${name}\u0000${specifier}`);
    }
  }

  const lines = [
    "// Generated per run from the packages' own .d.ts — never committed.",
    "export {};",
    "declare global {",
  ];
  for (const entry of values) {
    const [name, from] = entry.split("\u0000");
    lines.push(`  const ${name}: typeof import("${from}")["${name}"];`);
  }
  for (const entry of types) {
    const [name, from] = entry.split("\u0000");
    const params = generics.get(name);
    if (params === undefined) {
      lines.push(`  type ${name} = import("${from}").${name};`);
      continue;
    }
    // `<S extends Schema = Schema, T = unknown>` on the left, `<S, T>` on the right.
    const names = params
      .slice(1, -1)
      .split(",")
      .map((part) => part.trim().split(/[\s=]/)[0])
      .filter(Boolean);
    lines.push(`  type ${name}${params} = import("${from}").${name}<${names.join(", ")}>;`);
  }
  for (const entry of classes) {
    const [name, from] = entry.split("\u0000");
    lines.push(`  type ${name}<P = any> = InstanceType<typeof import("${from}")["${name}"]>;`);
  }
  lines.push("}");
  return lines.join("\n");
}

/**
 * The smallest wrapper that makes a block parse.
 *
 * Plenty of examples are deliberately not whole files — a run of class members with no class around
 * them, a couple of properties from an options object. Asking an author to write the wrapper would
 * put ceremony in the docs to satisfy a script, so the script finds it instead: try the block as it
 * is, then inside a class, then inside a method. The first that parses is the one used, and its
 * `offset` is how many lines were added above so an error still names the right line.
 *
 * `export {}` makes the file a module, which is what a fragment with a top-level `await` needs and
 * what stops a `const` in one block colliding with the same name in another.
 */
function shape(code) {
  // The filler `render` is only added when the fragment has none of its own. Plenty of blocks ARE a
  // `render` — `render() { return <p/>; }` is how the JSX page opens — and adding a second one made
  // every such block report a duplicate implementation.
  const filler = /^\s*(?:public |private |protected )?render\s*\(/m.test(code)
    ? ""
    : "  render(): any { return null; }\n";
  // Imports have to stay at the top of the file, so a block that has them AND uses `this` is split:
  // the imports keep their place and the rest goes in the class. `lens/index.md` is one of these.
  const importLines = [];
  const rest = [];
  for (const line of code.split("\n")) {
    (/^\s*import\s/.test(line) ? importLines : rest).push(line);
  }
  const head = importLines.length === 0 ? "" : `${importLines.join("\n")}\n`;
  const body = rest.join("\n");
  const offsetFor = (added) => (importLines.length === 0 ? added : added - importLines.length);

  const attempts = [
    { text: `${code}\nexport {};\n`, offset: 0 },
    // `render` is abstract on `Component`, so the wrapper has to satisfy it — otherwise every
    // wrapped fragment reports a missing member that its author never wrote.
    {
      text: `${head}class __Example extends Component<any> {
  [key: string]: any;
${body}
${filler}}
export {};
`,
      offset: offsetFor(2),
    },
    {
      // `async`, because a fragment may `await` at what is its own top level.
      text: `${head}class __Example extends Component<any> {
  [key: string]: any;
  render(): any { return null; }
  async __body() {
${body}
  }
}
export {};
`,
      offset: offsetFor(4),
    },
  ];
  // A block whose statements start with `this.` PARSES on its own — at the top of a module `this`
  // is legal and means nothing — and then every property on it is reported as possibly undefined,
  // about something the example never wrote. It belongs in a class.
  const needsClass =
    (/\bthis\./.test(code) || /^\s*return\s/m.test(code)) &&
    !/^\s*(?:@|class |export class |abstract class )/m.test(code);

  // A block with a top-level `const` cannot be a class BODY — it has to be inside a method. Both
  // shapes parse, so the choice has to be made here rather than left to the first that does.
  const needsMethod = /^\s*(?:const|let|var)\s/m.test(code);

  for (const [index, attempt] of attempts.entries()) {
    if (index === 0 && needsClass) continue;
    if (index === 1 && needsClass && needsMethod) continue;
    const sf = ts.createSourceFile("probe.tsx", attempt.text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
    if (sf.parseDiagnostics.length === 0) return attempt;
  }
  return null;
}

/**
 * The names a `.d.ts` declares at the top of its `declare global` block.
 *
 * Text, not the type-checker: these files are small and hand-written, and running a program to read
 * them would mean a program per preamble before the programs that use them.
 */
function declaredIn(text) {
  return new Set([...text.matchAll(/^  (?:class|interface|const|type|function) (\w+)/gm)].map((m) => m[1]));
}

/**
 * The same file with some declarations taken out.
 *
 * This is what makes the preambles a HIERARCHY rather than a pile. `query/testing.md` defines its own
 * `mount()` helper in one block and uses it in the next; `mount` is also a Ramonda decorator, and the
 * section preamble has no reason to know that one page means something else by it. Without this the
 * outer declaration won and the page-level one was silently ignored.
 */
function withoutNames(text, names) {
  if (names.size === 0) return text;
  const lines = text.split("\n");
  const kept = [];
  let skipDepth = null;
  for (const line of lines) {
    if (skipDepth !== null) {
      skipDepth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      if (skipDepth <= 0) skipDepth = null;
      continue;
    }
    const match = /^  (?:class|interface|const|type|function) (\w+)/.exec(line);
    if (match && names.has(match[1])) {
      const opens = (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      if (opens > 0) skipDepth = opens;
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

/* ── assemble ──────────────────────────────────────────────────────────────────────────────── */

const files = [
  ...globSync("apps/docs/content/**/*.md", { cwd: repo }),
  ...globSync("packages/*/README.md", { cwd: repo }),
].filter((f) => !filter || f.includes(filter));

const work = mkdtempSync(join(tmpdir(), "ramonda-examples-"));

/**
 * `./routes` — the module every routed app has, so an example can import from it and be checked.
 *
 * `Link` and `Navigator` are reachable only through `createRouter`, so there is no import from the
 * package that a component example could show. Writing the factory call into every example instead
 * would teach the opposite of what the router asks for — call it ONCE, in a module of its own — and
 * a reader copies what the example does.
 *
 * Every block is written flat into this directory, so a sibling `routes.d.ts` is what `./routes`
 * resolves to from any of them. The types come from the real package rather than a hand-written
 * shim: `this.use(Navigator)` then has to actually carry `push`, `params` and the rest, which is
 * the half a shim gets wrong quietly.
 */
writeFileSync(
  join(work, "routes.d.ts"),
  `import { createRouter } from "@ramonda/router";
import type { RouteConfig } from "@ramonda/router";

declare const kit: ReturnType<typeof createRouter<RouteConfig>>;

export declare const routes: RouteConfig;
export declare const Router: typeof kit.Router;
export declare const RouteOutlet: typeof kit.RouteOutlet;
export declare const Navigator: typeof kit.Navigator;
export declare const Link: typeof kit.Link;
export declare const route: typeof kit.route;
`,
);

const units = [];

const unparseable = [];

for (const file of files) {
  const blocks = blocksIn(file);
  if (blocks.length === 0) continue;
  const ambient = preamblesFor(file);

  blocks.forEach((block, index) => {
    const shaped = shape(block.code);
    if (shaped === null) {
      unparseable.push({ file, index, line: block.line });
      return;
    }
    const name = `${file.replace(/[^\w]/g, "_")}__${index}.tsx`;
    const path = join(work, name);
    writeFileSync(path, shaped.text);
    units.push({ path, file, index, line: block.line, offset: shaped.offset, ambient });
  });
}

/* ── check ─────────────────────────────────────────────────────────────────────────────────── */

const core = join(repo, "packages/core/src");
const options = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  jsxImportSource: "@ramonda/core",
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  // The examples are teaching material, and three of `strict`'s parts are about whole programs
  // rather than about whether an example is right:
  //   - an unused import is often the point of the line above it;
  //   - `(title) => api.create(title)` infers in a real file and cannot in a fragment, so
  //     `noImplicitAny` would report the reader's own shorthand as an error;
  //   - a fragment is not asked to prove exhaustiveness.
  // Everything that says a NAME does not exist, or that a call is wrong, stays on — which is the
  // whole reason this runs.
  noUnusedLocals: false,
  noUnusedParameters: false,
  noImplicitAny: false,
  types: [],
  lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  baseUrl: repo,
  paths: {
    "@ramonda/core/jsx-runtime": [`${core}/jsx-runtime.ts`],
    "@ramonda/core/jsx-dev-runtime": [`${core}/jsx-dev-runtime.ts`],
    "@ramonda/core/testing": [`${core}/testing.ts`],
    "@ramonda/core": [`${core}/index.ts`],
    "@ramonda/router/server": [`${repo}/packages/router/src/server.ts`],
    "@ramonda/router": [`${repo}/packages/router/src/index.ts`],
    "@ramonda/query": [`${repo}/packages/query/src/index.ts`],
    "@ramonda/form/bguard": [`${repo}/packages/form/src/bguard.ts`],
    "@ramonda/form": [`${repo}/packages/form/src/index.ts`],
    "@ramonda/lens": [`${repo}/packages/lens/src/index.ts`],
    "@ramonda/devtools": [`${repo}/packages/devtools/src/index.ts`],
    "@ramonda/testing-library": [`${repo}/packages/testing-library/src/index.ts`],
    // A real dependency of `@ramonda/form`, and the form examples build their schema with it. Left
    // unresolved, `object(…)` fell back to a placeholder returning `any`, so `Form<typeof schema>`
    // knew no field names and every `f.email` was an error.
    bguard: [`${repo}/packages/form/node_modules/bguard`],
    "bguard/*": [`${repo}/packages/form/node_modules/bguard/*`],
  },
};

/**
 * One program per SET of preambles, not one for everything.
 *
 * Every ambient file lands in the same global scope, so a single program would make the sections
 * collide — `query` and `ssr` both want a `User`, `concepts` and `hooks` both want a `ThemeStore`,
 * and neither is wrong. Grouping by preamble set is what the design already means: a page sees the
 * context declared above it and nothing else.
 *
 * Measured: 34 names were declared in more than one preamble, and every one of them was a
 * duplicate-identifier error until this split.
 */
const groups = new Map();
for (const unit of units) {
  const key = unit.ambient.join("|");
  const group = groups.get(key) ?? { ambient: unit.ambient, units: [] };
  group.units.push(unit);
  groups.set(key, group);
}

const byUnit = new Map();
let groupIndex = 0;
for (const group of groups.values()) {
  // The globals are generated PER GROUP, so a section's own preamble can claim a name the framework
  // also exports. Generating one shared file made whichever loaded first win, silently.
  const texts = group.ambient.map((path) => readFileSync(path, "utf8"));
  const names = texts.map(declaredIn);
  const declaredHere = new Set(names.flatMap((set) => [...set]));

  // Innermost wins: each preamble gives up any name a more specific one claims.
  const ambientFiles = texts.map((text, index) => {
    const claimedInside = new Set(names.slice(index + 1).flatMap((set) => [...set]));
    const path = join(work, `__ambient-${groupIndex}-${index}.d.ts`);
    writeFileSync(path, withoutNames(text, claimedInside));
    return path;
  });

  const globalsFile = join(work, `__globals-${groupIndex++}.d.ts`);
  writeFileSync(globalsFile, ramondaGlobals(declaredHere));

  const program = ts.createProgram([globalsFile, ...ambientFiles, ...group.units.map((u) => u.path)], options);
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const source = diagnostic.file;
    if (!source) continue;
    const unit = group.units.find((u) => u.path === source.fileName);
    // Diagnostics inside the framework's own sources are not this script's business.
    if (!unit || IGNORED.has(diagnostic.code)) continue;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
    // A name the DOM owns too — see `domGlobals`. The reader's import settles it; a fragment
    // showing no imports cannot.
    if ([...shadowed].some((name) => message.includes(`'${name}'`))) continue;
    const { line, character } = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    const list = byUnit.get(unit) ?? [];
    list.push({
      where: `${unit.file}:${unit.line + line - unit.offset}`,
      column: character + 1,
      message,
      code: diagnostic.code,
    });
    byUnit.set(unit, list);
  }
}

rmSync(work, { recursive: true, force: true });

/* ── report ────────────────────────────────────────────────────────────────────────────────── */

const total = [...byUnit.values()].reduce((n, list) => n + list.length, 0);

const skipped =
  (unparseable.length === 0 ? "" : `, ${unparseable.length} not standalone code and skipped`) +
  (expected.length === 0 ? "" : `, ${expected.length} marked as not one program`);

if (total === 0) {
  console.log(`[examples] ${units.length} code blocks in ${files.length} files type-check${skipped}.`);
  for (const u of unparseable) console.log(`           skipped ${u.file}:${u.line}`);
  process.exit(0);
}

console.error(`\n[examples] ${total} problem(s) in ${byUnit.size} of ${units.length} code blocks:\n`);
for (const [unit, list] of byUnit) {
  console.error(`  ${unit.file}  (block ${unit.index + 1})`);
  for (const problem of list) console.error(`    ${problem.where}  TS${problem.code}: ${problem.message}`);
  console.error("");
}
console.error(
  "A name the example is entitled to assume — the reader's own `api`, their `Todo` — belongs in a\n" +
    "`_preamble.ts` beside the page. A name nothing declares is the example being wrong.\n",
);
process.exit(1);
