import { afterEach, describe, expect, test } from "vitest";
import { ramondaCss } from "../vite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Temporary directories the scan tests write into, cleaned up after each one. */
const roots: string[] = [];
afterEach(() => {
  for (const one of roots.splice(0)) rmSync(one, { recursive: true, force: true });
});

/**
 * The plugin, exercised through the hooks Vite calls rather than through Vite.
 *
 * A real dev server is `prototype-testrunner.mjs`'s job and it already ran: **`enforce: "pre"` is a
 * requirement, not a preference** — without it the plugin runs after Vite's own esbuild step, which
 * has already refused the file. That measurement is what this shape is built around; everything
 * below is about what the hooks do once the ordering is right.
 */

/** Every hook this asserts on, narrowed off the structural plugin type. */
function hooks() {
  const plugin = ramondaCss();
  const transform = plugin.transform as (this: unknown, code: string, id: string) => { code: string } | null;
  const load = plugin.load as (this: unknown, id: string) => string | null;
  const resolveId = plugin.resolveId as (this: unknown, id: string) => string | null;
  return { plugin, transform, load, resolveId };
}

const STYLED = `const a = <div css=@@( display: flex; )>x</div>;\n`;

describe("where it sits in the pipeline", () => {
  test("before esbuild, which is a requirement rather than a preference", () => {
    // Measured in prototype-testrunner.mjs, both ways: without `pre` the plugin runs after Vite's
    // own esbuild step, which has already refused the file. The same ordering covers the dev server,
    // the build and the test runner, because all three transform through Vite.
    expect(ramondaCss().enforce).toBe("pre");
  });

  test("and it has a name a stack trace can carry", () => {
    expect(ramondaCss().name).toBe("ramonda-css");
  });
});

describe("what it transforms", () => {
  test("a file with a block becomes valid TSX, with a map", () => {
    const { transform } = hooks();
    const result = transform.call({}, STYLED, "/src/Card.tsx");

    expect(result?.code).toContain("css={_s0}");
    expect(result).toHaveProperty("map");
  });

  test("a file with no block is handed on untouched", () => {
    const { transform } = hooks();

    expect(transform.call({}, `const a = <div>x</div>;\n`, "/src/Plain.tsx")).toBeNull();
  });

  test("a decorator is not a block, so that file is untouched too", () => {
    const { transform } = hooks();

    expect(transform.call({}, `class C {\n  @(dec) m() {}\n}\n`, "/src/Dec.ts")).toBeNull();
  });

  test.each([
    ["node_modules", "/project/node_modules/thing/index.js"],
    ["a virtual module of somebody else's", "\0virtual:something"],
    ["a stylesheet", "/src/app.css"],
    ["a json file", "/src/data.json"],
  ])("%s is not transformed", (_what, id) => {
    const { transform } = hooks();

    expect(transform.call({}, STYLED, id)).toBeNull();
  });

  test("a query string does not stop a file being recognised", () => {
    // Vite appends them: `?used`, `?v=hash`, `?worker`. A file that is skipped because of one is a
    // file whose blocks silently do not compile.
    const { transform } = hooks();

    expect(transform.call({}, STYLED, "/src/Card.tsx?v=deadbeef")?.code).toContain("css={_s0}");
  });
});

describe("the stylesheet, one module per file", () => {
  /**
   * The first design had ONE stylesheet for the whole app, imported by the entry. Measured on a real
   * build, that shipped no CSS at all: Rollup loaded the shared module before the styled file was
   * transformed, so the sheet was empty, and the build was green with an unstyled page. A bundler
   * does not wait for the transform to finish.
   *
   * Per file, the ordering cannot arise: the rules exist because that file was just read.
   */
  const cssOf = (file: string) => `${file}?ramonda-css.css`;

  test("a styled file gains an import of its own rules", () => {
    const { transform } = hooks();

    expect(transform.call({}, STYLED, "/src/Card.tsx")?.code).toContain(`import "/src/Card.tsx?ramonda-css.css";`);
  });

  test("a file with no block gains nothing, because it owns no rules", () => {
    const { transform } = hooks();

    expect(transform.call({}, `const a = <div>x</div>;\n`, "/src/Plain.tsx")).toBeNull();
  });

  test("the id is claimed, or Vite tries to read it off the disk", () => {
    const { resolveId } = hooks();

    expect(resolveId.call({}, cssOf("/src/Card.tsx"))).toBe(cssOf("/src/Card.tsx"));
  });

  test("anything else is left to the rest of the pipeline", () => {
    const { resolveId } = hooks();

    expect(resolveId.call({}, "./styles.css")).toBeNull();
  });

  test("it holds that file's rules, in a layer", () => {
    const { transform, load } = hooks();
    transform.call({}, STYLED, "/src/Card.tsx");

    const css = load.call({}, cssOf("/src/Card.tsx"));
    expect(css).toContain("@layer ramonda.");
    expect(css).toContain("display:flex;");
  });

  test("and nothing else is loaded by this plugin", () => {
    const { load } = hooks();

    expect(load.call({}, "/src/Card.tsx")).toBeNull();
  });

  test("its own stylesheet coming back round is not transformed again", () => {
    const { transform } = hooks();

    expect(transform.call({}, "@layer ramonda { }", cssOf("/src/Card.tsx"))).toBeNull();
  });

  /**
   * Dedupe is the CLASS, and each file still serves the rule it names.
   *
   * The first design gave the rule an owner and let the second file emit nothing. Measured through a
   * real build: two lazily-loaded routes writing the same block produced one chunk with the rule and
   * one whose JavaScript named a class no stylesheet contained — unstyled, in production, silently.
   * What the duplicate costs is nothing whenever it is identical: Vite dedupes an asset by content,
   * and both routes came out pointing at one file.
   */
  test("a block written in two files is served by both of them", () => {
    const { transform, load } = hooks();
    transform.call({}, STYLED, "/src/One.tsx");
    transform.call({}, STYLED, "/src/Two.tsx");

    expect(load.call({}, cssOf("/src/One.tsx"))).toContain("display:flex;");
    expect(load.call({}, cssOf("/src/Two.tsx"))).toContain("display:flex;");
  });

  test("and the second file still gets the class, which is the point of deduping", () => {
    const { transform } = hooks();
    const one = transform.call({}, STYLED, "/src/One.tsx")?.code ?? "";
    const two = transform.call({}, STYLED, "/src/Two.tsx")?.code ?? "";

    const className = one.match(/r-[0-9a-zA-Z][^"\s)]*/)?.[0];
    expect(className).toBeDefined();
    expect(two).toContain(className as string);
  });
});

describe("a save, which is what a dev server does all day", () => {
  const cssOf = (file: string) => `${file}?ramonda-css.css`;

  test("a block the author deleted leaves the sheet with it", () => {
    const { transform, load } = hooks();
    transform.call({}, `const a = <div css=@@( display: flex; )>x</div>;\n`, "/src/Card.tsx");
    transform.call({}, `const a = <div css=@@( display: grid; )>x</div>;\n`, "/src/Card.tsx");

    const css = load.call({}, cssOf("/src/Card.tsx"));
    expect(css).toContain("display:grid;");
    expect(css).not.toContain("display:flex;");
  });

  /**
   * One file's edit cannot change what another file serves, and that is the point.
   *
   * It used to. A rule had an owner, ownership moved when the owner dropped the block, and a whole
   * mechanism existed to tell the file that gained it. **Measured through a real dev server, that
   * mechanism could not work:** the file that gained the rule had been transformed while it owned
   * nothing, so no stylesheet import was appended to it — and reloading a module nobody imports
   * delivers nothing. Editing one file took the styling off another, until a restart.
   *
   * A file serving every rule it names removes the question rather than answering it.
   */
  test("a file that drops a shared block takes nothing away from anyone else", () => {
    const reloaded: string[] = [];
    const context = {
      server: {
        moduleGraph: { getModuleById: (id: string) => ({ id }) },
        reloadModule: (module: { id: string }) => reloaded.push(module.id),
      },
    };
    const { transform, load } = hooks();

    transform.call(context, STYLED, "/src/One.tsx");
    transform.call(context, STYLED, "/src/Two.tsx");
    expect(load.call({}, cssOf("/src/Two.tsx"))).toContain("display:flex;");

    reloaded.length = 0;
    transform.call(context, `const a = <div>x</div>;\n`, "/src/One.tsx");

    expect(load.call({}, cssOf("/src/Two.tsx"))).toContain("display:flex;");
    // Nothing to tell anyone: Two's CSS is what it always was.
    expect(reloaded).toEqual([]);
  });

  test("a file whose own CSS did not move tells nobody anything", () => {
    const reloaded: string[] = [];
    const context = {
      server: {
        moduleGraph: { getModuleById: (id: string) => ({ id }) },
        reloadModule: (module: { id: string }) => reloaded.push(module.id),
      },
    };
    const { transform } = hooks();

    transform.call(context, STYLED, "/src/One.tsx");
    // Its own stylesheet is reloaded with its JavaScript, so it is never in this list.
    expect(reloaded).toEqual([]);

    transform.call(context, STYLED, "/src/One.tsx");
    expect(reloaded).toEqual([]);
  });

  test("a file that keeps some blocks and drops one leaves the other file alone", () => {
    const reloaded: string[] = [];
    const context = {
      server: {
        moduleGraph: { getModuleById: (id: string) => ({ id }) },
        reloadModule: (module: { id: string }) => reloaded.push(module.id),
      },
    };
    const { transform, load } = hooks();

    transform.call(
      context,
      `const a = <div css=@@( display: flex; )>x</div>;\nconst b = <p css=@@( color: red; )>y</p>;\n`,
      "/src/One.tsx",
    );
    transform.call(context, `const c = <div css=@@( color: red; )>z</div>;\n`, "/src/Two.tsx");
    expect(load.call({}, cssOf("/src/Two.tsx"))).toContain("color:red;");

    reloaded.length = 0;
    // One.tsx keeps `display:flex` and drops `color:red`, so it still has blocks — a different path
    // from losing every one of them.
    transform.call(context, `const a = <div css=@@( display: flex; )>x</div>;\n`, "/src/One.tsx");

    expect(load.call({}, cssOf("/src/Two.tsx"))).toContain("color:red;");
    expect(reloaded).toEqual([]);
  });

  test("and a build with no server does not reach for one", () => {
    const { transform } = hooks();
    transform.call({}, STYLED, "/src/One.tsx");

    expect(() => transform.call({}, `const a = <div>x</div>;\n`, "/src/One.tsx")).not.toThrow();
  });
});

describe("a block it cannot read", () => {
  test("becomes an error Vite can point at, not a stack trace", () => {
    const { transform } = hooks();

    try {
      transform.call({}, `const a = <div css=@@( {name}: 24px; )>x</div>;\n`, "/src/Card.tsx");
      expect.unreachable("the plugin should have refused");
    } catch (error) {
      const refusal = error as Error & { id?: string; loc?: { line: number; column: number } };
      expect(refusal.id).toBe("/src/Card.tsx");
      expect(refusal.message).toContain("a hole cannot be a whole declaration");

      /**
       * **0-based, and it had to be measured.** Vite's type says `column: number` and nothing else,
       * and Vite echoes whatever it is given — so a wrong base is a caret one character off and no
       * error anywhere to find it. Measured on a real parse error at a known position: `@` on
       * 1-based column 20 came back as `1:19`, caret under it.
       *
       * The hole's `{` is at 1-based column 24 in the source below.
       */
      const source = `const a = <div css=@@( {name}: 24px; )>x</div>;\n`;
      expect(source.indexOf("{", source.indexOf("@@(") + 3) + 1).toBe(24);
      expect(refusal.loc).toEqual({ line: 1, column: 23 });
    }
  });
});

describe("what an app has to write", () => {
  test("the runtime can be pointed somewhere else, which is what a wrapper needs", () => {
    const plugin = ramondaCss({ runtime: "my-wrapper" });
    const transform = plugin.transform as (this: unknown, code: string, id: string) => { code: string } | null;

    expect(transform.call({}, STYLED, "/src/Card.tsx")?.code).toContain(`from "my-wrapper"`);
  });

  test("nothing at all beyond the plugin", () => {
    // No stylesheet to import, which is what per-file serving bought. A README that says otherwise
    // is a README this test contradicts.
    const { transform } = hooks();

    expect(ramondaCss().name).toBe("ramonda-css");
    expect(transform.call({}, STYLED, "/src/Card.tsx")?.code).toContain("?ramonda-css.css");
  });
});

/**
 * What came back from post-processing, checked against what the sheet promised.
 *
 * ## The fault this exists for
 *
 * `Sheet.verify` was written, tested, and **nothing called it** — a safety net that looks like it is
 * there and is not, which is worse than none. This is the hook that runs it.
 *
 * What it guards is invisible by construction: the class name is written into the emitted
 * JavaScript, so a minifier that renames or drops a rule ships a page pointing at a class that is not
 * in the stylesheet. Nothing throws. The page renders, unstyled, with nothing to blame.
 */
describe("the assembled stylesheet", () => {
  const SOURCE = `const a = <div css=@@( color: {c}; )>x</div>;\n`;

  /** The plugin after one file has been through it, and the CSS it produced. */
  const built = () => {
    const plugin = ramondaCss();
    plugin.transform.call({}, SOURCE, "/src/Card.tsx");
    return { plugin, css: plugin.load.call({}, "/src/Card.tsx?ramonda-css.css") ?? "" };
  };

  const bundleOf = (css: string) => ({
    "assets/index.css": { type: "asset", fileName: "assets/index.css", source: css },
  });

  test("passes when the CSS that came back still names everything", () => {
    const { plugin, css } = built();

    expect(() => plugin.generateBundle?.call({}, {}, bundleOf(css))).not.toThrow();
  });

  /**
   * The one that matters, and it is measured against a REAL minifier rather than a hand-written
   * imitation of one: a check that cried wolf on ordinary minification would be turned off within a
   * day, which is the same as not having it.
   */
  test("and when a real minifier has been over it", async () => {
    const { plugin, css } = built();
    const esbuild = await import("esbuild");
    const minified = (await esbuild.transform(css, { loader: "css", minify: true })).code;

    expect(minified.length).toBeLessThan(css.length);
    expect(() => plugin.generateBundle?.call({}, {}, bundleOf(minified))).not.toThrow();
  });

  test("refuses when a class was renamed", () => {
    const { plugin, css } = built();
    const renamed = css.replace(/\.r-[0-9a-zA-Z]+/g, ".a1");

    expect(() => plugin.generateBundle?.call({}, {}, bundleOf(renamed))).toThrow(/renamed or removed/);
  });

  test("refuses when a custom property the markup carries was dropped", () => {
    const { plugin, css } = built();
    const dropped = css.replace(/var\([^)]+\)/g, "red");

    expect(() => plugin.generateBundle?.call({}, {}, bundleOf(dropped))).toThrow(/var\(/);
  });

  /**
   * A build that emits no CSS asset at all is not evidence of anything. An SSR build is the ordinary
   * case — the client build is where the stylesheet is written — and reporting every rule missing
   * there would be a false alarm on every server build in the repository.
   */
  test("says nothing when the build emitted no stylesheet to check", () => {
    const { plugin } = built();

    expect(() =>
      plugin.generateBundle?.call({}, {}, { "index.js": { type: "chunk", fileName: "index.js" } }),
    ).not.toThrow();
  });
});

/**
 * The dependency SCAN, which is a second pass and never sees this plugin's `transform`.
 *
 * Reported from a real `pnpm dev`: the server starts, the first request arrives, and the scan fails
 * with *Expected identifier but found "@"* on every file holding a block — then *Skipping dependency
 * pre-bundling*, which leaves every bare import unbundled.
 *
 * Vite pre-bundles by walking the entries with **esbuild**, and that walk has its own plugin list.
 * So the same transform is handed to it through `config`. It only has to make the file PARSE,
 * because all the scan wants is the imports.
 */
/**
 * The build's own answer to "is this production", which the config may ask and nothing supplied.
 *
 * `readConfig` takes an environment and every consumer passed two arguments, so `env.production` was
 * always `undefined`: a config written the way the docs document it took its development branch in
 * a production build, silently. The mechanism had a test; the JOIN had none.
 *
 * Vite is told which build this is, in the `config` hook — which is why the settings are read
 * lazily now rather than when the plugin is constructed, since a plugin exists before any hook runs.
 */
describe("what the plugin tells a config about the build", () => {
  const project = (body: string) => {
    const dir = mkdtempSync(join(tmpdir(), "ramonda-vite-env-"));
    writeFileSync(join(dir, "ramonda.css.ts"), body);
    return dir;
  };

  const inside = <T>(dir: string, run: () => T): T => {
    const before = process.cwd();
    process.chdir(dir);
    try {
      return run();
    } finally {
      process.chdir(before);
    }
  };

  const STRICT = `export default (env: { production: boolean }) => ({\n  units: env.production ? ["px"] : ["px", "em"],\n});\n`;

  test("a production build gets the production branch", () => {
    const dir = project(STRICT);
    const said = inside(dir, () => {
      const plugin = ramondaCss();
      plugin.config({}, { mode: "production" });
      const transform = plugin.transform as (this: unknown, code: string, id: string) => unknown;
      try {
        transform.call({}, `const a = <div css=@@( padding: 1em; )>x</div>;\n`, join(dir, "Card.tsx"));
        return "accepted";
      } catch (error) {
        return (error as Error).message;
      }
    });

    expect(said).toContain("em");
  });

  test("and a dev server gets the other one, from the same file", () => {
    const dir = project(STRICT);
    const said = inside(dir, () => {
      const plugin = ramondaCss();
      plugin.config({}, { mode: "development" });
      const transform = plugin.transform as (this: unknown, code: string, id: string) => unknown;
      try {
        transform.call({}, `const a = <div css=@@( padding: 1em; )>x</div>;\n`, join(dir, "Card.tsx"));
        return "accepted";
      } catch (error) {
        return (error as Error).message;
      }
    });

    expect(said).toBe("accepted");
  });
});

describe("the dependency scan", () => {
  /** The esbuild plugin the config hook contributes, and its one `onLoad` handler. */
  function scanner() {
    const config = ramondaCss().config({}, { mode: "development" }) as {
      optimizeDeps: { esbuildOptions: { plugins: { name: string; setup(build: unknown): void }[] } };
    };
    const [plugin] = config.optimizeDeps.esbuildOptions.plugins;
    let handler: ((args: { path: string }) => { contents: string; loader: string } | null) | undefined;
    plugin.setup({ onLoad: (_filter: unknown, callback: typeof handler) => void (handler = callback) });
    return { name: plugin.name, load: handler };
  }

  const written = (name: string, text: string) => {
    const root = mkdtempSync(join(tmpdir(), "ramonda-css-scan-"));
    roots.push(root);
    const path = join(root, name);
    writeFileSync(path, text);
    return path;
  };

  test("the plugin contributes one to the scan", () => {
    expect(scanner().name).toBe("ramonda-css:scan");
  });

  test("a file with a block is handed back as something esbuild can parse", () => {
    const { load } = scanner();
    const path = written(
      "Card.tsx",
      `import { thing } from "./thing";\nconst a = <div css=@@( display: flex; )>x</div>;\n`,
    );

    const result = load?.({ path });
    expect(result?.contents).not.toContain("@@(");
    // The imports are the whole point of a scan.
    expect(result?.contents).toContain(`from "./thing"`);
    expect(result?.loader).toBe("tsx");
  });

  test("a file with no block is left to esbuild", () => {
    const { load } = scanner();

    expect(load?.({ path: written("Plain.ts", "const a = 1;\n") })).toBeNull();
  });

  /** A scan is not where an author should meet a diagnostic — the real transform reports it. */
  test("a block it cannot read is passed over rather than thrown from", () => {
    const { load } = scanner();
    const path = written("Broken.tsx", `const a = <div css=@@( {whatever}: 4px; )>x</div>;\n`);

    expect(() => load?.({ path })).not.toThrow();
    expect(load?.({ path })).toBeNull();
  });

  test("and a path that is not there does not take the scan down", () => {
    const { load } = scanner();

    expect(load?.({ path: "/nowhere/at/all.tsx" })).toBeNull();
  });
});

/**
 * WHICH config the build enforces, which a review found was the one above the working directory.
 *
 * In a monorepo that is a different file from the one the editor reads for the same source file, so
 * an author could be squiggled against settings the build never applied, or the other way round —
 * and which of the two they met depended on where they typed `pnpm dev`. The file being transformed
 * is the anchor now; see `configReader`.
 */
describe("which config a transform is measured against", () => {
  const monorepo = () => {
    const repo = mkdtempSync(join(tmpdir(), "ramonda-vite-which-"));
    roots.push(repo);
    mkdirSync(join(repo, ".git"), { recursive: true });
    for (const name of ["web", "admin"]) mkdirSync(join(repo, "packages", name), { recursive: true });
    writeFileSync(join(repo, "packages", "web", "ramonda.css.ts"), `export default { units: ["px"] };\n`);
    writeFileSync(join(repo, "packages", "admin", "ramonda.css.ts"), `export default { units: ["px", "em"] };\n`);
    return repo;
  };

  const inside = <T>(dir: string, run: () => T): T => {
    const before = process.cwd();
    process.chdir(dir);
    try {
      return run();
    } finally {
      process.chdir(before);
    }
  };

  const transforming = (file: string, source = `const a = <div css=@@( padding: 1em; )>x</div>;\n`) => {
    const plugin = ramondaCss();
    plugin.config({}, { mode: "development" });
    const transform = plugin.transform as (this: unknown, code: string, id: string) => unknown;
    try {
      transform.call({}, source, file);
      return "accepted";
    } catch (error) {
      return (error as Error).message;
    }
  };

  test("the file's own package, and not the directory the command was run in", () => {
    const repo = monorepo();

    // Run from `admin`, which allows `em`. The file is `web`'s, which does not.
    const said = inside(join(repo, "packages", "admin"), () => transforming(join(repo, "packages", "web", "Card.tsx")));

    expect(said).toContain("px");
  });

  test("and the other package's file is accepted in the same process", () => {
    const repo = monorepo();

    const said = inside(join(repo, "packages", "web"), () => transforming(join(repo, "packages", "admin", "Card.tsx")));

    expect(said).toBe("accepted");
  });

  /**
   * The second half of the same finding: the settings were read once when the plugin was
   * constructed, so a dev server kept enforcing what it booted with while the editor — which
   * re-reads — had already moved on. One file, two tools, two answers.
   */
  test("a config edited while the dev server runs is picked up", () => {
    const repo = monorepo();
    const file = join(repo, "packages", "admin", "Card.tsx");
    const plugin = ramondaCss();
    plugin.config({}, { mode: "development" });
    const transform = plugin.transform as (this: unknown, code: string, id: string) => unknown;
    const run = () => {
      try {
        transform.call({}, `const a = <div css=@@( padding: 1em; )>x</div>;\n`, file);
        return "accepted";
      } catch (error) {
        return (error as Error).message;
      }
    };

    expect(run()).toBe("accepted");
    writeFileSync(join(repo, "packages", "admin", "ramonda.css.ts"), `export default { units: ["px"] };\n`);

    expect(run()).toContain("px");
  });
});
