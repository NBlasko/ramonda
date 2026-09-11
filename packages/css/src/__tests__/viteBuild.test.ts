import { execFileSync } from "node:child_process";
import {
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterEach, describe, expect, test } from "vitest";
import { builtFromThisSource } from "./built";

/** This file runs the BUILD, so a stale `dist` would measure a previous version — see `built.ts`. */
beforeAll(builtFromThisSource);

/**
 * A real Vite build, with the real plugin — the only thing that can say a block RENDERS.
 *
 * `vite.test.ts` calls the hooks directly and is fast; it cannot tell whether Vite calls them, in
 * what order, or whether the stylesheet it serves ends up in the output. Those are the questions a
 * person hits first, and each of them has a way to be wrong that a unit test looks green through:
 *
 * - the plugin runs after esbuild, which has already refused the file — measured before any of this
 *   existed, and the reason `enforce: "pre"` is a requirement;
 * - the sheet is served but nothing imports it, so nothing links it;
 * - the class in the emitted JavaScript is not the class in the emitted CSS.
 *
 * Slow — one Vite build per test — so there are three, and each one asks something the others do not.
 */

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO = resolve(PACKAGE, "..", "..");

/** Vite's own bin, out of the store. The package does not depend on Vite and must not start. */
const VITE = globSync("node_modules/.pnpm/vite@*/node_modules/vite/bin/vite.js", { cwd: REPO })[0];

const projects: string[] = [];
afterEach(() => {
  for (const each of projects.splice(0)) rmSync(each, { recursive: true, force: true });
});

/**
 * A project Vite can build, with the plugin loaded from `dist` — the built artefact, so this also
 * asserts the package's own build produced a loadable plugin.
 */
function project(card: string, entry: string, assets: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "ramonda-css-vite-"));
  projects.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  for (const [name, contents] of Object.entries(assets)) writeFileSync(join(root, "src", name), contents);

  // Vite has to resolve its own runtime imports from somewhere. This package's own tree has it.
  symlinkSync(join(PACKAGE, "node_modules"), join(root, "node_modules"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "probe", private: true, type: "module", version: "0.0.0" }),
  );

  writeFileSync(join(root, "src", "Card.tsx"), card);
  writeFileSync(join(root, "src", "main.ts"), entry);

  /**
   * A JSX runtime of one line, and the JSX is COMPILED rather than preserved.
   *
   * Found by getting it wrong: with `jsx: "preserve"` the build failed on the original `css=@@(`,
   * because esbuild leaves the JSX in and Rollup cannot parse that either. The error frame showed
   * the author's own line, which was the first accidental proof that the source map composes through
   * a real bundler — but it was measuring the wrong thing. The framework is deliberately not used
   * here: this asks about the bundler, not about a renderer.
   */
  mkdirSync(join(root, "src", "jsx"), { recursive: true });
  /**
   * `jsx-runtime` AND `jsx-dev-runtime`, because those are the two names esbuild appends to
   * `jsxImportSource` — the second one whenever the build is not in production mode. Found by
   * getting it wrong twice and reading what Rollup said it could not resolve.
   */
  const runtime = `export const jsx = (tag: unknown, props: unknown) => ({ tag, props });\nexport const jsxs = jsx;\nexport const jsxDEV = jsx;\nexport const Fragment = "fragment";\n`;
  writeFileSync(join(root, "src", "jsx", "jsx-runtime.ts"), runtime);
  writeFileSync(join(root, "src", "jsx", "jsx-dev-runtime.ts"), runtime);

  writeFileSync(
    join(root, "vite.config.js"),
    `import { ramondaCss } from ${JSON.stringify(join(PACKAGE, "dist", "vite.js"))};\n` +
      `export default {\n` +
      `  logLevel: "warn",\n` +
      // The runtime points at `dist`, so the probe needs no `node_modules` entry for the package
      // itself — the same option a wrapper for another JSX library uses.
      `  plugins: [ramondaCss({ runtime: ${JSON.stringify(join(PACKAGE, "dist", "index.js"))} })],\n` +
      `  esbuild: { jsx: "automatic", jsxImportSource: ${JSON.stringify(join(root, "src", "jsx"))} },\n` +
      `  build: { outDir: "out", manifest: true, rollupOptions: { input: "src/main.ts" } },\n` +
      `};\n`,
  );

  return root;
}

/** The build's output, or what it said when it refused. */
function build(root: string): { ok: boolean; output: string; files: Record<string, string> } {
  try {
    const output = execFileSync(process.execPath, [join(REPO, VITE), "build"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      /**
       * **`NODE_ENV` OFF THE PARENT, and every test in this file was getting a TEST build.**
       *
       * Vitest sets `NODE_ENV=test`, `execFileSync` inherits it, and Vite's own define is
       * `JSON.stringify(process.env.NODE_ENV || mode)` — so `process.env.NODE_ENV` was replaced with
       * `"test"` and every `!== "production"` folded to TRUE. Measured: the app's own copy of that
       * expression came out as `typeof process<"u"&&!0`.
       *
       * So this file said "all the way through a production build" and was not building one. It only
       * became visible when a test asked whether development-only code is dropped, which is the one
       * question that depends on it.
       */
      env: { ...process.env, NODE_ENV: "production" },
    });
    const out = join(root, "out", "assets");
    const files: Record<string, string> = {};
    for (const name of readdirSync(out)) files[name] = readFileSync(join(out, name), "utf8");
    return { ok: true, output, files };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${failed.stdout ?? ""}${failed.stderr ?? ""}`, files: {} };
  }
}

const of = (files: Record<string, string>, extension: string) =>
  Object.entries(files).find(([name]) => name.endsWith(extension))?.[1] ?? "";

describe("a block, all the way through a production build", () => {
  test("the class reaches the JavaScript AND the stylesheet, and they are the same class", () => {
    const result = build(
      project(
        `export const accent = "#10b981";\nexport const card = (\n  <div className="lead" css=@@(\n    display: flex;\n    border-left: 4px solid {accent};\n  )>x</div>\n);\n`,
        `import { card } from "./Card";\nconsole.log(card);\n`,
      ),
    );

    expect(result.ok, result.output).toBe(true);

    const js = of(result.files, ".js");
    const css = of(result.files, ".css");

    /**
     * The classes the transform chose, read out of the emitted JavaScript rather than assumed.
     *
     * **Two of them, because a block is one rule per DECLARATION now** — one for `display:flex` and
     * one for the `border-left` that carries the hole. Which is which is not this test's business,
     * so it asserts what must hold of the set: every class the markup names exists in the sheet, and
     * the one with a hole reads the custom property named after ITSELF.
     */
    /**
     * Read out of the QUOTED strings, not out of the text.
     *
     * A block compiles to a map whose keys are property names, so the emitted JavaScript holds
     * `"border-left"` — and a pattern looking for `r-` anywhere found `r-left` inside it. A class is
     * always a whole string literal, which is what this asks for.
     */
    const named = [...new Set([...js.matchAll(/"(r-[^"]+)"/g)].map((one) => one[1]))];
    expect(named.length).toBeGreaterThan(1);

    // The same names on both sides. This is the whole point: the markup names classes, and every one
    // of them has to exist. Asserted without whitespace, because Vite minifies the output — which is
    // also the round trip the sheet's own `verify` is about.
    for (const one of named) expect(css, `${one} is named by the JavaScript`).toContain(`.${one}`);
    expect(css).toContain("display:flex");
    expect(css).toContain("@layer ramonda");

    const holed = named.find((one) => css.includes(`var(--${one}-0)`));
    expect(holed, "one rule reads a custom property named after its own class").toBeDefined();
    expect(css).toContain(`.${holed}{border-left:4px solid var(--${holed}-0)}`);

    // And the hole is a value at the call site, not text the compiler built.
    expect(js).toContain("#10b981");
  });

  test("the stylesheet is linked, so a page actually loads it", () => {
    const result = build(
      project(
        `export const card = <div css=@@( display: flex; )>x</div>;\n`,
        `import { card } from "./Card";\nconsole.log(card);\n`,
      ),
    );

    expect(result.ok, result.output).toBe(true);
    // A `.css` in the output at all: the virtual module took part in the graph, which is the reason
    // it is a module rather than a file written to disk.
    expect(Object.keys(result.files).some((name) => name.endsWith(".css"))).toBe(true);
  });

  test("a block it cannot read fails the build, at the author's own line and column", () => {
    const result = build(
      project(
        `export const card = (\n  <div css=@@(\n    {name}: 24px;\n  )>x</div>\n);\n`,
        `import { card } from "./Card";\nconsole.log(card);\n`,
      ),
    );

    expect(result.ok).toBe(false);
    // `3:5` and not `3:4`: Vite's `loc.column` is 0-based and this is where it is converted, so the
    // printed position is the author's own. Measured — see the note in `src/vite.ts`.
    expect(result.output).toContain("Card.tsx:3:5");
    expect(result.output).toContain("a hole cannot be a whole declaration");
  });
});

/**
 * A named block's own asset, which is the one thing about it that is not this package's to get right.
 *
 * `@@font-face( src: url("./brand.woff2") )` puts a RELATIVE url in a stylesheet the author never
 * writes — a virtual module, served by the plugin — so what it is relative TO is decided by the id
 * that module is given. Get that wrong and the build either fails to resolve the font or emits a url
 * pointing at nothing, and the page renders in the fallback face with no error anywhere.
 *
 * Measured here rather than reasoned about: Vite resolves it against the author's own file, finds
 * the asset and processes it. This is slow, and it is here because nothing cheaper can ask it.
 */
describe("a named block that refers to a file beside it", () => {
  test("the url is resolved against the author's file, not against a virtual one", () => {
    const result = build(
      project(
        `export const brand = @@font-face(\n  font-family: "Brand";\n  src: url("./brand.woff2") format("woff2");\n);\n` +
          `export const card = @@( font-family: "Brand", serif; );\n`,
        `import { card, brand } from "./Card";\nconsole.log(card, brand);\n`,
        { "brand.woff2": "a real file, standing in for a font" },
      ),
    );

    expect(result.ok).toBe(true);
    const css = of(result.files, ".css");
    expect(css).toContain("@font-face");
    // Resolved and processed — Vite inlines an asset this small, which it can only do having found
    // it. What must NOT survive is the author's own relative path, which resolves to nothing.
    expect(css).not.toContain("./brand.woff2");
    expect(css).toContain('format("woff2")');
  });
});

/**
 * The same block in two lazily-loaded routes, which is what splitting is FOR.
 *
 * Dedupe used to mean OWNERSHIP: the first file to claim a class emitted the rule and everyone else
 * merely named it. That is correct while every sheet loads together, and wrong the moment they do
 * not — measured, and this is the shape that measured it. Two sibling routes wrote the same block:
 * one chunk got the rule, the other got a `.js` naming a class **no stylesheet in the build had**.
 * A visitor landing on the second route saw the element render unstyled, with nothing to blame and
 * no error anywhere.
 *
 * So a file emits every rule it NAMES. The cost is a rule written twice when two files in one chunk
 * share a block; the alternative is a page that is sometimes right.
 */
describe("a block written in two routes that never load together", () => {
  test("each route carries the rule it names", () => {
    const root = project(
      `export const panel = @@( color: red; display: flex; );\n`,
      `if (location.hash === "#one") import("./One").then((m) => console.log(m.panel));\n` +
        `else import("./Two").then((m) => console.log(m.panel));\n`,
    );
    const same = `export const panel = @@( color: red; display: flex; );\n`;
    writeFileSync(join(root, "src", "One.tsx"), same);
    writeFileSync(join(root, "src", "Two.tsx"), same);

    const result = build(root);
    expect(result.ok).toBe(true);

    /**
     * The MANIFEST, not the file names — that is what a page loads.
     *
     * Vite dedupes an asset by content, so both routes here end up pointing at one stylesheet file
     * with one copy of the rule: the duplication this design accepts costs nothing whenever the
     * duplicate is identical, which is the only case it creates. Asking for a stylesheet named after
     * the route would call that correct build a failure.
     */
    const manifest = JSON.parse(readFileSync(join(root, "out", ".vite", "manifest.json"), "utf8")) as Record<
      string,
      { file: string; css?: string[] }
    >;

    for (const route of ["One", "Two"]) {
      const entry = manifest[`src/${route}.tsx`];
      const named = readFileSync(join(root, "out", entry.file), "utf8").match(/r-[0-9a-zA-Z][^"\s)]*/)?.[0];
      const loaded = (entry.css ?? []).map((each) => readFileSync(join(root, "out", each), "utf8")).join("");

      expect(named).toBeDefined();
      expect(loaded, `${route} names ${named} and loads no stylesheet holding it`).toContain(named);
    }
  });
});

/**
 * The cascade, all the way through a production build — a real minifier included.
 *
 * The fault this stands over is one no author could have found. One rule goes into the stylesheet of
 * every file that names it, which is what lets a chunk stand on its own; a stylesheet is a sequence,
 * so a second file re-emitting a shared rule put it AFTER the first file's higher-ranked ones and
 * same-specificity later-wins undid the order. Measured in Chromium: `Card.tsx` writing `color: red`
 * and `@media { color: blue }` rendered blue on its own and RED once an innocent `Panel.tsx` loaded
 * after it. Adding an unrelated component moved a page nobody edited.
 *
 * A layer per rank fixes it, because a layer's place is set by its declaration and not by where its
 * rules sit. What a test can ask of a build is the two things the browser then relies on: every rule
 * is in the layer for its rank, and every stylesheet declares the whole rank order — including a
 * file that uses one rank, since a declaration listing only what a file uses is worse than useless
 * (measured: CSS appends an unseen name to the END of the order, so `margin-left: 4px` became
 * `0px`). The browser half is `prototype-layers.mjs`: 2,250 load orders, both minifiers, zero wrong.
 */
test("the layer order is declared in full by every stylesheet, and survives minification", () => {
  const root = project(
    `export const card = @@( color: red; @media (min-width: 40rem) { color: blue; } );\n`,
    `import { card } from "./Card";\nimport { panel } from "./Panel";\nconsole.log(card, panel);\n`,
  );
  // Writes only the rule `Card.tsx` also writes, which is the file that used to reverse it.
  writeFileSync(join(root, "src", "Panel.tsx"), `export const panel = @@( color: red; );\n`);

  const result = build(root);
  expect(result.ok).toBe(true);

  const css = readdirSync(join(root, "out", "assets"))
    .filter((each) => each.endsWith(".css"))
    .map((each) => readFileSync(join(root, "out", "assets", each), "utf8"))
    .join("\n");

  // The statement, which is what makes the order the same in every stylesheet. A minifier may trim
  // a name the same file declares again below, but not the order.
  const declared = [...css.matchAll(/@layer ([^{;]*ramonda\.[^{;]*);/g)].map((each) => each[1]);
  expect(declared.length).toBeGreaterThan(0);
  expect(declared[0]).toContain("ramonda.c");

  // The unconditional rule is in a `u` layer and the conditional one under `c`, which every
  // stylesheet declares last — so the conditional one wins wherever it applies.
  expect(css).toMatch(/@layer u\d+\s*\{\s*\.r-[\w-]+\s*\{\s*color: ?red/);
  expect(css).toMatch(/@layer c\s*\{/);
  expect(css.indexOf("color:red")).toBeLessThan(css.indexOf("@layer c"));
});

/**
 * TWO BREAKPOINTS, through the same build — the half a layer per rank could not settle.
 *
 * Both are conditional and neither is a shorthand, so they used to rank the same and the sheet fell
 * back to the order the file wrote, which a second file writing one of the two then reversed. The
 * width is read off the query now, so each lands in a layer of its own and the wider one is last.
 *
 * Written narrow-first here because that is the only way it compiles: writing the wider one below
 * the narrower one is an override the sheet will not honour, and `override-out-of-order` refuses it
 * — measured by writing it the other way round and watching the build fail.
 */
test("two breakpoints go in different layers, and the wider one is last", () => {
  const root = project(
    `export const card = @@(\n` +
      `  @media (min-width: 40rem) { padding: 1rem; }\n` +
      `  @media (min-width: 64rem) { padding: 2rem; }\n` +
      `);\n`,
    `import { card } from "./Card";\nimport { panel } from "./Panel";\nconsole.log(card, panel);\n`,
  );
  writeFileSync(
    join(root, "src", "Panel.tsx"),
    `export const panel = @@( @media (min-width: 40rem) { padding: 1rem; } );\n`,
  );

  const result = build(root);
  expect(result.ok).toBe(true);

  const css = readdirSync(join(root, "out", "assets"))
    .filter((each) => each.endsWith(".css"))
    .map((each) => readFileSync(join(root, "out", "assets", each), "utf8"))
    .join("\n");

  expect(css.indexOf("40rem")).toBeLessThan(css.indexOf("64rem"));

  // Different layers, so Panel re-emitting the narrow one cannot put it after the wide one.
  const layerOf = (query: string) => {
    const at = css.indexOf(query);
    return [...css.slice(0, at).matchAll(/@layer ([\w.]+)\s*\{/g)].map((each) => each[1]).join(">");
  };
  expect(layerOf("40rem")).not.toBe(layerOf("64rem"));
});

/**
 * A named site that REGISTERS, all the way through a production build.
 *
 * `@property` is the one named site whose whole purpose is a browser behaviour rather than a name:
 * a registered custom property interpolates in a transition and falls back to its `initial-value`
 * instead of dropping the declaration. Measured in Chromium 151, both of those are had ONLY by a
 * registration the browser kept, and a `@property` that is not at the top level of the stylesheet is
 * **dropped entirely** — `.host { @property --n { … } }` came out of `cssRules` as `.host { }`, with
 * the name left accepting any junk at all.
 *
 * So "the CSS is in the output" is not the question here. The question is whether it is still a
 * top-level at-rule holding descriptors after the bundler and the minifier have had it, and nothing
 * asked that: the sheet writes it correctly, and what ships is what a person gets.
 */
test("a `@property` ships as a top-level at-rule holding its descriptors", () => {
  const result = build(
    project(
      `export const ANGLE = @@property(\n  syntax: "<angle>";\n  inherits: false;\n  initial-value: 0deg;\n);\n` +
        `export const card = (\n  <div className="lead" css=@@(\n    transform: rotate(var({ANGLE}));\n  )>x</div>\n);\n`,
      `import { card, ANGLE } from "./Card";\nconsole.log(card, ANGLE);\n`,
    ),
  );

  expect(result.ok, result.output).toBe(true);

  const css = of(result.files, ".css");

  // The descriptors are the registration. A `@property` that lost them registers nothing.
  expect(css).toContain("syntax");
  // And they must be DIRECTLY inside it — not wrapped in a style rule, which is the shape that made
  // Chromium drop the whole at-rule.
  expect(css).not.toMatch(/@property[^{]*\{\s*[.#]/);
});

/**
 * A theme module, all the way through a production build.
 *
 * This is what cross-module resolution is FOR, and the shape a person writes: tokens in one file,
 * read from another. Before it existed the import compiled to `var(var(--…))`, which computes to
 * nothing in Chromium and drops the declaration in silence.
 *
 * Two claims, and the second is the one that pays for the feature: the `@property` registration
 * reaches the sheet, and the reading declarations are STATIC atoms — no custom property on the
 * element at all, so a theme costs nothing per element and a swap needs no render.
 */
test("a token declared in one module and read in another", () => {
  const result = build(
    project(
      `import { accent, gap } from "./theme";\n` +
        `export const card = (\n  <div className="lead" css=@@(\n    color: var({accent});\n    border-color: var({accent});\n    padding: var({gap});\n  )>x</div>\n);\n`,
      `import { card } from "./Card";\nconsole.log(card);\n`,
      {
        "theme.tsx":
          `export const accent = @@property(\n  syntax: "<color>";\n  inherits: true;\n  initial-value: #10b981;\n);\n` +
          `export const gap = @@property(\n  syntax: "<length>";\n  inherits: true;\n  initial-value: 12px;\n);\n`,
      },
    ),
  );

  expect(result.ok, result.output).toBe(true);

  const css = of(result.files, ".css");
  const js = of(result.files, ".js");

  // The registrations travelled from the module that declared them.
  expect(css).toContain('syntax:"<color>"');
  expect(css).toContain('syntax:"<length>"');

  // One variable per TOKEN, not per declaration: `color` and `border-color` read the same name.
  const names = [...css.matchAll(/var\((--r-[^)]+)\)/g)].map((one) => one[1]);
  expect(names).toHaveLength(3);
  expect(new Set(names).size).toBe(2);

  // And nothing is carried on the element — every entry is a bare class, never `[class, value]`.
  expect(js).not.toContain("var(var(");
  expect(js).not.toMatch(/\["r-[^"]*",\s*\w/);
});

/**
 * The project's config, reaching a real build.
 *
 * Every other test of it calls `checkBlock` with a config in hand. This is the one that says the
 * file is FOUND and read — from `process.cwd()`, which is the project the plugin was created in.
 */
test("a unit the project's `ramonda.css.ts` does not allow fails the build", () => {
  const root = project(
    `export const card = <div className="lead" css=@@( padding: 1em; )>x</div>;\n`,
    `import { card } from "./Card";\nconsole.log(card);\n`,
    { "../ramonda.css.ts": `export default { units: ["px", "rem"] };\n` },
  );

  const result = build(root);
  expect(result.ok).toBe(false);
  // The refusal is the message, not the rule id — a build says what to change, and `ramonda-check`
  // is where a fault is listed under its id.
  expect(result.output).toContain("a CSS unit this project does not use");
  expect(result.output).toContain("px, rem");
});

/**
 * **THE DEV WARNING COSTS NOTHING IN PRODUCTION, and nothing was holding that claim.**
 *
 * `merge.ts` says it in a comment — "it never grows in a production build: nothing reaches it,
 * because the only caller is behind a `NODE_ENV` check, so a bundler folds the check and drops
 * everything it alone referenced" — and that was measured once, by hand, and then left. A measured
 * claim in a comment with no test over it is a claim that rots on the next edit, and the warning has
 * since grown: it now walks a shorthand's clear-list, which for `all` is 559 entries.
 *
 * So this asks a real Vite production build. The evidence is the warning's own SENTENCE, which
 * appears nowhere else in the package and cannot be minified away — a name could be mangled, a
 * string cannot.
 */
describe("what development-only code costs a visitor", () => {
  test("the order warning's words are in no production asset", () => {
    const root = project(
      `const base = @@(\n  @media (min-width: 1px) {\n    padding: 11px;\n  }\n);\n` +
        `export const Card = () => <div css=@@(\n  ...{base};\n  padding-left: 4px;\n)>x</div>;\n`,
      `import { Card } from "./Card";\nconsole.log(Card());\n`,
    );

    const result = build(root);
    expect(result.ok, result.output).toBe(true);

    const javascript = of(result.files, ".js");
    expect(javascript.length).toBeGreaterThan(0);
    // The class the block compiled to IS there, so this is measuring the right bundle.
    expect(javascript).toMatch(/r-/);

    for (const words of ["is composed later under", "will not override it", "@ramonda/css"]) {
      expect(javascript, `\`${words}\` reached the bundle`).not.toContain(words);
    }
  });

  /**
   * And the SLOT table the warning uses to compare two conditions — `widthSlot` and the mode
   * patterns. They are the warning's only reason to exist in a bundle, so a fold that missed would
   * show up as a regular expression nobody needs at run time.
   */
  test("and neither is the slot table it compares with", () => {
    const root = project(
      `export const Card = () => <div css=@@(\n  @media (min-width: 40rem) {\n    gap: 8px;\n  }\n)>x</div>;\n`,
      `import { Card } from "./Card";\nconsole.log(Card());\n`,
    );

    const result = build(root);
    expect(result.ok, result.output).toBe(true);

    const javascript = of(result.files, ".js");
    for (const words of ["prefers-reduced-motion", "forced-colors", "min|max"]) {
      expect(javascript, `\`${words}\` reached the bundle`).not.toContain(words);
    }
  });
});

test("zzdiagnose", () => {
  const root = project(
    `const base = @@(\n  @media (min-width: 1px) {\n    padding: 11px;\n  }\n);\n` +
      `export const Card = () => <div css=@@(\n  ...{base};\n  padding-left: 4px;\n)>x</div>;\n`,
    `import { Card } from "./Card";\nconsole.log(Card());\n`,
  );
  const result = build(root);
  const javascript = of(result.files, ".js");
  const lines: string[] = [`bundle ${javascript.length} bytes`];
  for (const needle of ["process.env", '"production"', "typeof process", "is composed later", "NODE_ENV"]) {
    const at = javascript.indexOf(needle);
    lines.push(
      `  ${needle.padEnd(22)} ${at === -1 ? "absent" : `at ${at}  ...${JSON.stringify(javascript.slice(Math.max(0, at - 70), at + 70))}`}`,
    );
  }
  require("node:fs").writeFileSync("/tmp/zzdiag.txt", lines.join("\n"));
  expect(result.ok).toBe(true);
});
