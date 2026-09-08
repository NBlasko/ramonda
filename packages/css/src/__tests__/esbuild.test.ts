import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as esbuild from "esbuild";
import { afterAll, describe, expect, test } from "vitest";
import { ramondaCss } from "../esbuild";

/**
 * The esbuild adapter, measured by running esbuild.
 *
 * ## Why a real build rather than the plugin's hooks
 *
 * Every interesting thing here is an agreement with a bundler rather than a decision of our own:
 * whether an `onLoad` really runs before the built-in parser, whether a virtual module loaded as CSS
 * reaches the stylesheet, whether an error lands on the author's line. A test that called the hooks
 * itself would assert what this package believes and nothing about what esbuild does.
 */

const roots: string[] = [];

/** A throwaway project, so a build has real files to resolve. */
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ramonda-css-esbuild-"));
  roots.push(root);
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(root, name), contents);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const build = (root: string, options: Parameters<typeof esbuild.build>[0] = {}) =>
  esbuild.build({
    entryPoints: [join(root, "index.tsx")],
    bundle: true,
    write: false,
    outdir: join(root, "dist"),
    jsx: "preserve",
    plugins: [ramondaCss()],
    external: ["@ramonda/css"],
    ...options,
  });

const outputs = (result: esbuild.BuildResult) =>
  Object.fromEntries((result.outputFiles ?? []).map((file) => [file.path.split(".").pop(), file.text]));

describe("a build", () => {
  const APP = `const a = <div css=@@(\n  display: flex;\n  gap: 8px;\n)>x</div>;\nexport default a;\n`;

  test("compiles the block, and the class is in both halves", async () => {
    const root = project({ "index.tsx": APP });
    const { js, css } = outputs(await build(root));

    expect(js).toMatch(/r-[0-9a-zA-Z][^"\s)]*/);
    expect(css).toContain("@layer ramonda");
    expect(css).toContain("display: flex");

    // The same class in the JavaScript and in the stylesheet, which is the only thing that matters.
    // The whole string literal: a map key like `"border-left"` holds `r-left` inside it.
    const named = /"(r-[^"]+)"/.exec(js ?? "")?.[1];
    expect(css).toContain(`.${named}`);
  });

  test("a hole becomes a custom property the element carries", async () => {
    const root = project({
      "index.tsx": `const w = 4;\nconst a = <div css=@@(\n  border-left: {\`\${w}px\`} solid red;\n)>x</div>;\nexport default a;\n`,
    });
    const { js, css } = outputs(await build(root));

    expect(css).toMatch(/var\(--r-[0-9a-zA-Z][^"\s)]*-0\)/);
    expect(js).toContain("`${w}px`");
  });

  test("a file with no block is left exactly as esbuild had it", async () => {
    const root = project({ "index.tsx": `const a = 1;\nexport default a;\n` });
    const withPlugin = outputs(await build(root)).js;
    const without = outputs(await build(root, { plugins: [] })).js;

    expect(withPlugin).toBe(without);
  });

  /** The refusal has to arrive as a position in the author's file, not as a stack trace. */
  test("a block it cannot read is reported on the author's line", async () => {
    const root = project({ "index.tsx": `const a = <div css=@@(\n  {whole}\n)>x</div>;\n` });

    await expect(build(root)).rejects.toMatchObject({
      errors: [expect.objectContaining({ location: expect.objectContaining({ line: 2 }) })],
    });
  });

  /**
   * The same check the Vite plugin runs, and for the same reason: the class name is written into the
   * emitted JavaScript, so a rule that was renamed or dropped ships a page pointing at nothing.
   */
  test("what came back is checked against what the sheet promised", async () => {
    const root = project({ "index.tsx": APP });

    await expect(
      build(root, {
        // FIRST, because `onEnd` callbacks run in the order their plugins were registered — so a
        // minifier standing in for a real one has to have finished before the check looks.
        plugins: [
          {
            name: "rename-the-class",
            setup(build) {
              build.onEnd((result) => {
                for (const [index, file] of (result.outputFiles ?? []).entries()) {
                  if (!file.path.endsWith(".css")) continue;
                  const renamed = file.text.replace(/\.r-[0-9a-zA-Z]+/g, ".a1");
                  // biome-ignore lint/style/noNonNullAssertion: the array is the one just indexed.
                  result.outputFiles![index] = { ...file, text: renamed, contents: Buffer.from(renamed) };
                }
              });
            },
          },
          ramondaCss(),
        ],
      }),
    ).rejects.toThrow(/renamed or removed/);
  });
});

/**
 * The cost this option exists for, measured on 400 tiny modules with no block in any of them:
 * esbuild alone 11.4 ms, a plugin that does nothing but be asked +12%, and one that reads the file
 * +60%. **The read is the whole cost** — this package's own work on top of it is 0.3 µs/file. The
 * obvious fix is worse: handing the contents back claims the file, so no other `onLoad` plugin is
 * offered it and the loader has to be named, and contents returned with no loader are parsed as
 * plain JavaScript on every file.
 */
describe("what a file is loaded as", () => {
  /**
   * A block written as a VALUE can live in a `.ts` file, where there is no JSX at all — so the loader
   * cannot be "whatever holds JSX". esbuild picks one from the extension only when a plugin declines
   * the file, and this one does not decline a file it changed.
   */
  test("a value block in a .ts file is loaded as TypeScript", async () => {
    const root = project({
      "index.tsx": `import { panel } from "./styles";
export default <div css={panel}>x</div>;
`,
      "styles.ts": `const width: number = 4;
export const panel = @@(\n  gap: {\`\${width}px\`};\n);
`,
    });
    const { js, css } = outputs(await build(root));

    // The annotation is TypeScript, and a `ts` loader is what strips it rather than choking on it.
    expect(js).not.toContain(": number");
    expect(css).toMatch(/var\(--r-[0-9a-zA-Z][^"\s)]*-0\)/);
  });

  test("a block in a .jsx file keeps its JSX", async () => {
    const root = project({
      "index.tsx": `import { c } from "./card";
export default c;
`,
      "card.jsx": `export const c = <div css=@@( display: flex; )>x</div>;
`,
    });

    expect(outputs(await build(root)).js).toMatch(/r-[0-9a-zA-Z][^"\s)]*/);
  });
});

describe("what it does not read", () => {
  test("a dependency is left to esbuild, block or no block", async () => {
    const root = project({
      "index.tsx": `export default 1;
`,
    });
    const dep = join(root, "node_modules", "dep");
    mkdirSync(dep, { recursive: true });
    writeFileSync(join(dep, "package.json"), JSON.stringify({ name: "dep", version: "1.0.0", main: "index.js" }));
    writeFileSync(
      join(dep, "index.js"),
      `module.exports = 1;
`,
    );
    writeFileSync(
      join(root, "index.tsx"),
      `import d from "dep";
export default d;
`,
    );

    // The claim is that it built at all: a `node_modules` file read and handed back with a loader
    // this package chose is how a dependency stops compiling.
    expect(outputs(await build(root)).js).toContain("module.exports");
  });
});

describe("a build that writes to disk", () => {
  /**
   * `write: false` hands the output text to a plugin and is what the tests above use. A real build
   * writes, and then the only way to see what was written is the metafile — so that path is a
   * separate one, and a build with neither has nothing to check rather than everything to report.
   */
  test("is checked through the metafile", async () => {
    const root = project({
      "index.tsx": `const a = <div css=@@(\n  display: flex;\n)>x</div>;
export default a;
`,
    });
    const result = await build(root, { write: true, metafile: true, outdir: join(root, "dist") });

    const css = Object.keys(result.metafile?.outputs ?? {}).find((path) => path.endsWith(".css"));
    expect(css).toBeDefined();
    expect(readFileSync(css as string, "utf8")).toContain("@layer ramonda");
  });

  test("and says nothing when it can see neither", async () => {
    const root = project({
      "index.tsx": `const a = <div css=@@( display: flex; )>x</div>;
export default a;
`,
    });

    await expect(build(root, { write: true, metafile: false })).resolves.toBeDefined();
  });
});

describe("the filter", () => {
  test("a file outside it is compiled as if the plugin were not there", async () => {
    const root = project({
      "index.tsx": `import { b } from "./skipped";\nexport default b;\n`,
      "skipped.tsx": `export const b = <div className="x">y</div>;\n`,
    });

    const only = /index\.tsx$/;
    const { js } = outputs(await build(root, { plugins: [ramondaCss({ filter: only })] }));
    const { js: without } = outputs(await build(root, { plugins: [] }));

    expect(js).toBe(without);
  });
});

/**
 * WHICH config the build enforces. A review found it read from `process.cwd()`, which is where a
 * command was typed rather than where the source file lives — so in a monorepo the build and the
 * editor could hold two different files for one source file. The file being loaded is the anchor
 * now; see `configReader`.
 */
describe("which config a file is measured against", () => {
  const monorepo = () => {
    const repo = mkdtempSync(join(tmpdir(), "ramonda-esbuild-which-"));
    roots.push(repo);
    mkdirSync(join(repo, ".git"), { recursive: true });
    for (const name of ["web", "admin"]) mkdirSync(join(repo, "packages", name), { recursive: true });
    writeFileSync(join(repo, "packages", "web", "ramonda.css.ts"), `export default { units: ["px"] };\n`);
    writeFileSync(join(repo, "packages", "admin", "ramonda.css.ts"), `export default { units: ["px", "em"] };\n`);
    const app = `const a = <div css=@@(\n  padding: 1em;\n)>x</div>;\nexport default a;\n`;
    for (const name of ["web", "admin"]) writeFileSync(join(repo, "packages", name, "index.tsx"), app);
    return repo;
  };

  test("the package the file is in, whatever the working directory holds", async () => {
    const repo = monorepo();

    await expect(build(repo, { entryPoints: [join(repo, "packages", "web", "index.tsx")] })).rejects.toMatchObject({
      errors: [expect.objectContaining({ text: expect.stringContaining("px") })],
    });
  });

  test("and the package next door, in the same run, is allowed its own units", async () => {
    const repo = monorepo();

    const { css } = outputs(await build(repo, { entryPoints: [join(repo, "packages", "admin", "index.tsx")] }));

    expect(css).toContain("padding: 1em");
  });
});
