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
import { afterEach, describe, expect, test } from "vitest";

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
        `export const accent = "#10b981";\nexport const card = (\n  <div className="lead" css=@@(\n    display: flex;\n    border-left: 4px solid {{accent}};\n  )>x</div>\n);\n`,
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
    const named = [...new Set(js.match(/r-[0-9a-f]{16}/g) ?? [])];
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
        `export const card = (\n  <div css=@@(\n    {{name}}: 24px;\n  )>x</div>\n);\n`,
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
      const named = readFileSync(join(root, "out", entry.file), "utf8").match(/r-[0-9a-f]{16}/)?.[0];
      const loaded = (entry.css ?? []).map((each) => readFileSync(join(root, "out", each), "utf8")).join("");

      expect(named).toBeDefined();
      expect(loaded, `${route} names ${named} and loads no stylesheet holding it`).toContain(named);
    }
  });
});
