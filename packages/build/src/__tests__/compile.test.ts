import { describe, expect, test } from "vitest";
import { build as esbuild, type Plugin } from "esbuild";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileJsx } from "../compile";
import { ramonda as esbuildRamonda } from "../esbuild";
import { ramonda as viteRamonda } from "../vite";

/**
 * The JSX compiler: what each shape of JSX becomes. A host element tree is a template and holes; what the
 * compiler leaves alone is left byte for byte, for the transform after it.
 */

/**
 * The module a compile returns, without the import and the `var` put at its head, and each template made
 * where it is first used shown by its name alone — the templates are compared on their own.
 */
function body(code: string, all: string[]): string {
  let text = code.replace(/\nimport \{ __template[^\n]*\nvar [^\n]*;\n/, "");
  all.forEach((description, i) => {
    const name = `__ramondaT${i}`;
    text = text.replace(`${name} || (${name} = __ramondaTemplate(${description}))`, name);
  });
  return text;
}

function compile(source: string, id = "page.tsx") {
  const out = compileJsx(source, id);
  if (out === undefined) throw new Error("nothing was compiled");
  return { code: body(out.code, out.templates), templates: out.templates, full: out.code };
}

describe("a host element tree", () => {
  test("the js-framework-benchmark row: plain attributes in the template, five holes and the key, in source order", () => {
    const {
      code,
      templates: [row],
    } = compile(
      `const r = <tr key={row.id} className={on ? "danger" : ""}>` +
        `<td className="col-md-1">{row.id}</td>` +
        `<td className="col-md-4"><a onclick={select}>{row.label}</a></td>` +
        `<td className="col-md-1"><a onclick={remove}><span className="glyphicon" aria-hidden="true" /></a></td>` +
        `<td className="col-md-6" />` +
        `</tr>;`,
    );
    expect({ code, row }).toEqual({
      code: `const r = __ramondaBlock(__ramondaT0, [row.id, on ? "danger" : "", row.id, select, row.label, remove]);`,
      row:
        `{ t: "tr", d: [["className", 1]], c: [` +
        `{ t: "td", a: { "class": "col-md-1" }, h: 2 }, ` +
        `{ t: "td", a: { "class": "col-md-4" }, c: [{ t: "a", d: [["onclick", 3]], h: 4 }] }, ` +
        `{ t: "td", a: { "class": "col-md-1" }, c: [{ t: "a", d: [["onclick", 5]], c: [{ t: "span", a: { "class": "glyphicon", "aria-hidden": "true" } }] }] }, ` +
        `{ t: "td", a: { "class": "col-md-6" } }], y: 0 }`,
    });
  });

  test("text, a value and an element mixed are one hole, the element a block of its own", () => {
    const { code, templates: all } = compile(`const p = <p>Hello {name}, <i>welcome</i>!</p>;`);
    expect({ code, all }).toEqual({
      code: `const p = __ramondaBlock(__ramondaT0, [["Hello ", name, ", ", __ramondaBlock(__ramondaT1, []), "!"]]);`,
      all: [`{ t: "p", k: 0 }`, `{ t: "i", c: ["welcome"] }`],
    });
  });

  test("text as JSX writes it: lines trimmed where they meet, blank lines gone", () => {
    const {
      templates: [p],
    } = compile(`const p = <p>\n  one\n\n  two  three\n</p>;`);
    expect(p).toBe(`{ t: "p", c: ["one two  three"] }`);
  });

  test("an attribute with a rule is a hole, whatever its value: a field, a style, a boolean, a ref", () => {
    const { code, templates: all } = compile(
      `const f = <div><input type="checkbox" checked={on} disabled /><b style="color: red" ref={r} hidden /></div>;`,
    );
    expect({ code, all }).toEqual({
      code: `const f = __ramondaBlock(__ramondaT0, ["checkbox", on, true, "color: red", r, true]);`,
      all: [
        `{ t: "div", c: [{ t: "input", d: [["type", 0], ["checked", 1], ["disabled", 2]] }, ` +
          `{ t: "b", d: [["style", 3], ["ref", 4], ["hidden", 5]] }] }`,
      ],
    });
  });

  test("a literal the runtime has a rule for is a hole too: a listener's string, a boolean's word", () => {
    const {
      templates: [a],
    } = compile(`const a = <a onclick="go()" hidden="false">x</a>;`);
    expect(a).toBe(`{ t: "a", d: [["onclick", 0], ["hidden", 1]], c: ["x"] }`);
  });

  test("`htmlFor` is written as `for` on the template", () => {
    const {
      templates: [label],
    } = compile(`const l = <label htmlFor="name">Name</label>;`);
    expect(label).toBe(`{ t: "label", a: { "for": "name" }, c: ["Name"] }`);
  });
});

describe("a literal written as a hole", () => {
  test("is JSX's string as JavaScript's — a backslash kept, a line break escaped", () => {
    const { code } = compile(`const f = <input pattern="\\d+" placeholder="a\nb" />;`);
    expect(code).toBe(`const f = __ramondaBlock(__ramondaT0, [${JSON.stringify("\\d+")}, ${JSON.stringify("a\nb")}]);`);
  });
});

describe("text in a template", () => {
  test("runs a JSX comment splits are one text, as a server sends them", () => {
    const {
      templates: [p],
    } = compile(`const p = <p>Hello{/* name later */}world</p>;`);
    expect(p).toBe(`{ t: "p", c: ["Helloworld"] }`);
  });
});

describe("what is left to the transform after this one", () => {
  test.each([
    ["a component", `const c = <Panel title="t" />;`],
    ["a spread", `const s = <div {...rest} />;`],
    ["a `class` attribute, which the runtime reports and renames", `const k = <p class="x">a</p>;`],
    ["a `children` attribute, which is the element's children", `const k = <div children="x" />;`],
    ["text holding an entity", `const e = <p>a &amp; b</p>;`],
    ["an attribute holding an entity", `const e = <a title="Tom &amp; Jerry">x</a>;`],
    ["a namespaced attribute", `const x = <svg xlink:href="#a" />;`],
  ])("%s", (_name, source) => {
    expect(compileJsx(source, "page.tsx")).toBeUndefined();
  });

  test("an element keyed below the root is a block of its own, in its parent's children hole", () => {
    const { code, templates: all } = compile(`const n = <ul><li key="a">a</li></ul>;`);
    expect({ code, all }).toEqual({
      code: `const n = __ramondaBlock(__ramondaT0, [[__ramondaBlock(__ramondaT1, ["a"])]]);`,
      all: [`{ t: "ul", k: 0 }`, `{ t: "li", c: ["a"], y: 0 }`],
    });
  });

  test("blocks side by side among a component's children each keep their braces", () => {
    const { code } = compile(`const c = <Card><h2>T</h2><p>{body}</p></Card>;`);
    expect(code).toBe(`const c = <Card>{__ramondaBlock(__ramondaT0, [])}{__ramondaBlock(__ramondaT1, [body])}</Card>;`);
  });

  test("a host element inside kept JSX is still compiled, as a block of its own", () => {
    const { code } = compile(`const k = <Panel icon={<b>i</b>}><p>{x}</p>{show && <em>e</em>}</Panel>;`);
    expect(code).toBe(
      `const k = <Panel icon={__ramondaBlock(__ramondaT0, [])}>{__ramondaBlock(__ramondaT1, [x])}` +
        `{show && __ramondaBlock(__ramondaT2, [])}</Panel>;`,
    );
  });

  test("a fragment is kept, and its elements are compiled", () => {
    const { code } = compile(`const f = <><b>a</b>{x}</>;`);
    expect(code).toBe(`const f = <>{__ramondaBlock(__ramondaT0, [])}{x}</>;`);
  });

  test("a module with no JSX, or one that does not parse, is not touched", () => {
    // The parser recovers from a closing tag that names another element and hands back the rest; the
    // module is still broken, and is left whole for the transform after this to report.
    const broken = `const a = <i>x</i>;\nconst b = <a></b>;`;
    expect([compileJsx(`const a = 1 < 2;`, "a.tsx"), compileJsx(broken, "a.tsx")]).toEqual([undefined, undefined]);
  });

  test("a module that is not JSX is not read", () => {
    expect(compileJsx(`const a = <div />;`, "a.ts")).toBeUndefined();
  });
});

describe("where the templates go", () => {
  test("after the imports, the runtime import and one `var` for the module's templates", () => {
    const { full } = compile(`import { a } from "a";\nimport b from "b";\nconst top = <i>x</i>;\n`);
    expect(full.indexOf("var __ramondaT0;")).toBeGreaterThan(full.indexOf(`import b from "b";`));
    expect(full.indexOf("var __ramondaT0;")).toBeLessThan(full.indexOf("const top"));
  });

  test("made where first used, so a block built before the module's body has run still finds it", () => {
    // A function that builds a block, called from a module that imports this one in a cycle — before the
    // `var` line is reached. Run as it would be: the call is the first use, and makes the template.
    const out = compileJsx(`export function icon() {\n  return <b>i</b>;\n}\n`, "icon.tsx");
    if (out === undefined) throw new Error("nothing was compiled");
    const made: unknown[] = [];
    const module = new Function(
      "__ramondaTemplate",
      "__ramondaBlock",
      // `early` runs first, as the importing module of a cycle would: before any line below it.
      `const early = icon();\n${out.code.replace(/^\nimport [^\n]*\n/, "").replace("export function", "function")}\nreturn early;`,
    ) as (template: (d: unknown) => unknown, block: (t: unknown, v: unknown[]) => unknown) => unknown;
    const early = module(
      (description) => {
        made.push(description);
        return { description };
      },
      (template) => template,
    );
    expect([early, made.length]).toEqual([{ description: { t: "b", c: ["i"] } }, 1]);
  });

  test("after a directive, which has to stay first", () => {
    const { full } = compile(`"use client";\nconst top = <i>x</i>;\n`);
    expect(full.startsWith(`"use client";\nimport { __template`)).toBe(true);
  });

  test("after a `#!` line, which has to stay the first", () => {
    const { full } = compile(`#!/usr/bin/env node\nconst top = <i>x</i>;\n`);
    expect(full.startsWith(`#!/usr/bin/env node\n\nimport { __template`)).toBe(true);
  });

  test("at the start of a module with neither", () => {
    const { full } = compile(`const top = <i>x</i>;\n`);
    expect(full.startsWith(`\nimport { __template as __ramondaTemplate, __block as __ramondaBlock }`)).toBe(true);
  });
});

describe("the plugins", () => {
  async function bundle(compileOption: boolean | undefined, inPackage = false) {
    const dir = await mkdtemp(join(tmpdir(), "ramonda-build-compile-"));
    try {
      const folder = inPackage ? join(dir, "node_modules", "lib") : dir;
      await mkdir(folder, { recursive: true });
      const entry = join(folder, "entry.tsx");
      await writeFile(entry, `export const view = <p className="a">{1}</p>;\n`);
      const result = await esbuild({
        entryPoints: [entry],
        bundle: true,
        format: "esm",
        write: false,
        external: ["@ramonda/core", "@ramonda/core/*"],
        plugins: [esbuildRamonda(compileOption === undefined ? {} : { compile: compileOption })],
      });
      return result.outputFiles.map((file) => file.text).join("\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test("the esbuild plugin compiles an app's JSX unless told not to, and never a package's", async () => {
    const [on, off, packaged] = await Promise.all([bundle(undefined), bundle(false), bundle(undefined, true)]);
    expect({
      on: on.includes("__ramondaTemplate"),
      off: off.includes("__ramondaTemplate"),
      packaged: packaged.includes("__ramondaTemplate"),
    }).toEqual({ on: true, off: false, packaged: false });
  });

  test("the esbuild plugin reads files only: a module another plugin made up is left to it", async () => {
    const virtual: Plugin = {
      name: "virtual",
      setup(build) {
        build.onResolve({ filter: /^virtual:/ }, (args) => ({ path: args.path, namespace: "virtual" }));
        build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({
          contents: `export const view = <p>{1}</p>;`,
          loader: "tsx",
        }));
      },
    };
    const result = await esbuild({
      stdin: {
        contents: `import { view } from "virtual:page.tsx"; export default view;`,
        loader: "ts",
        resolveDir: tmpdir(),
      },
      bundle: true,
      format: "esm",
      write: false,
      external: ["@ramonda/core", "@ramonda/core/*"],
      plugins: [esbuildRamonda(), virtual],
    });
    expect(result.errors).toEqual([]);
  });

  test("the esbuild plugin leaves a package's module alone on Windows too", async () => {
    let load: ((args: { path: string }) => Promise<unknown>) | undefined;
    esbuildRamonda().setup({
      initialOptions: {},
      onLoad: (_options, callback) => {
        load = callback;
      },
    });
    // A path that does not exist: a module the plugin set out to read would fail here.
    expect(await load?.({ path: "C:\\app\\node_modules\\lib\\view.tsx" })).toBeUndefined();
  });

  test("the Vite plugin loads an app's JSX module compiled unless told not to — no package's, no virtual one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ramonda-build-compile-"));
    try {
      const file = join(dir, "view.tsx");
      await writeFile(file, `export const view = <p>{1}</p>;\n`);
      const load = (plugin: ReturnType<typeof viteRamonda>) => plugin.load.call(undefined, file);
      // A package's own module was built by its authors, and a virtual one is no file to read.
      const vendored = join(dir, "node_modules", "lib", "view.tsx");
      await mkdir(join(dir, "node_modules", "lib"), { recursive: true });
      await writeFile(vendored, `export const view = <p>{1}</p>;\n`);
      const plugin = viteRamonda();
      const [on, off, query, packaged, virtual] = await Promise.all([
        load(plugin),
        load(viteRamonda({ compile: false })),
        plugin.load.call(undefined, `${file}?raw`),
        plugin.load.call(undefined, vendored),
        plugin.load.call(undefined, "\0virtual.tsx"),
      ]);
      expect({ on: on?.code.includes("__ramondaTemplate"), off, query, packaged, virtual }).toEqual({
        on: true,
        off: null,
        query: null,
        packaged: null,
        virtual: null,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/** The source map's original line for the first generated position of `needle`, decoded by hand. */
function originalLine(code: string, map: { mappings: string }, needle: string): number | undefined {
  const at = code.indexOf(needle);
  const line = code.slice(0, at).split("\n").length - 1;
  const column = at - code.lastIndexOf("\n", at - 1) - 1;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let source = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let found: number | undefined;
  map.mappings.split(";").forEach((segments, generatedLine) => {
    let generatedColumn = 0;
    for (const segment of segments.split(",").filter(Boolean)) {
      const fields: number[] = [];
      let value = 0;
      let shift = 0;
      for (const char of segment) {
        const digit = alphabet.indexOf(char);
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else {
          fields.push(value & 1 ? -(value >> 1) : value >> 1);
          value = 0;
          shift = 0;
        }
      }
      generatedColumn += fields[0];
      if (fields.length > 1) {
        source += fields[1];
        sourceLine += fields[2];
        sourceColumn += fields[3];
      }
      if (generatedLine === line && generatedColumn <= column && fields.length > 1) found = sourceLine;
    }
  });
  void source;
  void sourceColumn;
  return found;
}

describe("the source map", () => {
  test("points code inside the JSX — a handler's body — at the line it was written on", () => {
    const source = `const v = (\n  <div onclick={() => {\n    doThing();\n    throw new Error("boom");\n  }}>x</div>\n);\n`;
    const out = compileJsx(source, "page.tsx");
    if (out === undefined) throw new Error("nothing was compiled");
    // 0-based: `throw` is on the fourth line of the source.
    expect(originalLine(out.code, out.map, "throw new Error")).toBe(3);
  });
});
