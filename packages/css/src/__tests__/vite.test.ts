import { describe, expect, test } from "vitest";
import { ramondaCss } from "../vite";

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

const STYLED = `const a = <div css=@( display: flex; )>x</div>;\n`;

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
    expect(css).toContain("@layer ramonda {");
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
   * Dedupe, which per-file serving had to keep. The first file to claim a class owns the rule; the
   * second names the class and emits nothing, so there is one rule wherever it was written.
   */
  test("a block written in two files is emitted by one of them", () => {
    const { transform, load } = hooks();
    transform.call({}, STYLED, "/src/One.tsx");
    transform.call({}, STYLED, "/src/Two.tsx");

    expect(load.call({}, cssOf("/src/One.tsx"))).toContain("display:flex;");
    expect(load.call({}, cssOf("/src/Two.tsx"))).toBe("");
  });

  test("and the second file still gets the class, which is the point of deduping", () => {
    const { transform } = hooks();
    const one = transform.call({}, STYLED, "/src/One.tsx")?.code ?? "";
    const two = transform.call({}, STYLED, "/src/Two.tsx")?.code ?? "";

    const className = one.match(/r-[0-9a-f]{16}/)?.[0];
    expect(className).toBeDefined();
    expect(two).toContain(className as string);
  });
});

describe("a save, which is what a dev server does all day", () => {
  const cssOf = (file: string) => `${file}?ramonda-css.css`;

  test("a block the author deleted leaves the sheet with it", () => {
    const { transform, load } = hooks();
    transform.call({}, `const a = <div css=@( display: flex; )>x</div>;\n`, "/src/Card.tsx");
    transform.call({}, `const a = <div css=@( display: grid; )>x</div>;\n`, "/src/Card.tsx");

    const css = load.call({}, cssOf("/src/Card.tsx"));
    expect(css).toContain("display:grid;");
    expect(css).not.toContain("display:flex;");
  });

  /**
   * Ownership moves, and nothing in the module graph connects the edit to the file that gains the
   * rule. So the plugin has to say so — otherwise the block keeps working in the browser only until
   * the next full reload, and stops working in the build.
   */
  test("a rule whose owner stopped using it moves, and the new owner is invalidated", () => {
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
    expect(load.call({}, cssOf("/src/Two.tsx"))).toBe("");

    reloaded.length = 0;
    // One.tsx drops the block. Two.tsx never changed and its CSS is now different.
    transform.call(context, `const a = <div>x</div>;\n`, "/src/One.tsx");

    expect(load.call({}, cssOf("/src/Two.tsx"))).toContain("display:flex;");
    expect(reloaded).toContain(cssOf("/src/Two.tsx"));
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

  test("a file that keeps some blocks and drops one still hands that rule on", () => {
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
      `const a = <div css=@( display: flex; )>x</div>;\nconst b = <p css=@( color: red; )>y</p>;\n`,
      "/src/One.tsx",
    );
    transform.call(context, `const c = <div css=@( color: red; )>z</div>;\n`, "/src/Two.tsx");
    expect(load.call({}, cssOf("/src/Two.tsx"))).toBe("");

    reloaded.length = 0;
    // One.tsx keeps `display:flex` and drops `color:red`, so it still has blocks — a different path
    // from losing every one of them.
    transform.call(context, `const a = <div css=@( display: flex; )>x</div>;\n`, "/src/One.tsx");

    expect(load.call({}, cssOf("/src/Two.tsx"))).toContain("color:red;");
    expect(reloaded).toContain(cssOf("/src/Two.tsx"));
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
      transform.call({}, `const a = <div css=@( {{name}}: 24px; )>x</div>;\n`, "/src/Card.tsx");
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
       * The `{{` is at 1-based column 23 in the source below.
       */
      const source = `const a = <div css=@( {{name}}: 24px; )>x</div>;\n`;
      expect(source.indexOf("{{") + 1).toBe(23);
      expect(refusal.loc).toEqual({ line: 1, column: 22 });
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
