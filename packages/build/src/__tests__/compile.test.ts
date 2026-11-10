import { describe, expect, test } from "vitest";
import { build as esbuild } from "esbuild";
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

/** The module a compile returns, without the import and the templates put at its head. */
function body(code: string): string {
  return code.replace(/\nimport \{ __template[^\n]*\n(const __ramondaT\d+ = [^\n]*\n)*/, "");
}

/** The templates a compile defined, in order. */
function templates(code: string): string[] {
  return [...code.matchAll(/const __ramondaT\d+ = \/\* @__PURE__ \*\/ __ramondaTemplate\((.*)\);/g)].map((m) => m[1]);
}

function compile(source: string, id = "page.tsx") {
  const out = compileJsx(source, id);
  if (out === undefined) throw new Error("nothing was compiled");
  return { code: body(out.code), templates: templates(out.code), full: out.code };
}

describe("a host element tree", () => {
  test("the js-framework-benchmark row: plain attributes in the template, five holes and the key", () => {
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
      code: `const r = __ramondaBlock(__ramondaT0, [on ? "danger" : "", row.id, select, row.label, remove], row.id);`,
      row:
        `{ t: "tr", d: [["className", 0]], c: [` +
        `{ t: "td", a: { "class": "col-md-1" }, h: 1 }, ` +
        `{ t: "td", a: { "class": "col-md-4" }, c: [{ t: "a", d: [["onclick", 2]], h: 3 }] }, ` +
        `{ t: "td", a: { "class": "col-md-1" }, c: [{ t: "a", d: [["onclick", 4]], c: [{ t: "span", a: { "class": "glyphicon", "aria-hidden": "true" } }] }] }, ` +
        `{ t: "td", a: { "class": "col-md-6" } }] }`,
    });
  });

  test("text, a value and an element mixed are one hole, the element a block of its own", () => {
    const { code, templates: all } = compile(`const p = <p>Hello {name}, <i>welcome</i>!</p>;`);
    expect({ code, all }).toEqual({
      code: `const p = __ramondaBlock(__ramondaT1, [["Hello ", name, ", ", __ramondaBlock(__ramondaT0, []), "!"]]);`,
      all: [`{ t: "i", c: ["welcome"] }`, `{ t: "p", k: 0 }`],
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

describe("what is left to the transform after this one", () => {
  test.each([
    ["a component", `const c = <Panel title="t" />;`],
    ["a spread", `const s = <div {...rest} />;`],
    ["a `class` attribute, which the runtime reports and renames", `const k = <p class="x">a</p>;`],
    ["text holding an entity", `const e = <p>a &amp; b</p>;`],
    ["a namespaced attribute", `const x = <svg xlink:href="#a" />;`],
  ])("%s", (_name, source) => {
    expect(compileJsx(source, "page.tsx")).toBeUndefined();
  });

  test("an element keyed below the root is a block of its own, in its parent's children hole", () => {
    const { code, templates: all } = compile(`const n = <ul><li key="a">a</li></ul>;`);
    expect({ code, all }).toEqual({
      code: `const n = __ramondaBlock(__ramondaT1, [[__ramondaBlock(__ramondaT0, [], "a")]]);`,
      all: [`{ t: "li", c: ["a"] }`, `{ t: "ul", k: 0 }`],
    });
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
  test("after the imports, so a block built while the module loads finds its template", () => {
    const { full } = compile(`import { a } from "a";\nimport b from "b";\nconst top = <i>x</i>;\n`);
    expect(full.indexOf("const __ramondaT0")).toBeGreaterThan(full.indexOf(`import b from "b";`));
    expect(full.indexOf("const __ramondaT0")).toBeLessThan(full.indexOf("const top"));
  });

  test("after a directive, which has to stay first", () => {
    const { full } = compile(`"use client";\nconst top = <i>x</i>;\n`);
    expect(full.startsWith(`"use client";\nimport { __template`)).toBe(true);
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
