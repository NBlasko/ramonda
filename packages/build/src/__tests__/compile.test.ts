import { describe, expect, test } from "vitest";
import { build as esbuild, type Plugin, transformSync } from "esbuild";
import { createServer } from "vite";
import { createRequire } from "node:module";

/** Oxc's own transform, as Vite 8 runs it — rolldown's, reached through the Vite this package tests with. */
function oxc(): { transformSync(file: string, code: string, options: object): { code: string } } {
  const fromVite = createRequire(createRequire(import.meta.url).resolve("vite"));
  return fromVite("rolldown/utils") as never;
}
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
 * The module a compile returns, without the import and the `var` put at its head, and each template shown
 * by its name alone — the templates are compared on their own. Both shapes a block takes read the same
 * here: made where first used, inside code that runs later, and made on the spot, pure, where the module
 * is evaluated. The tests of the two shapes read `full`.
 */
function body(code: string, all: string[]): string {
  let text = code.replace(/\nimport \{ __template[^\n]*\n(var [^\n]*;\n)?/, "");
  all.forEach((description, i) => {
    const name = `__ramondaT${i}`;
    text = text.replace(`${name} || (${name} = __ramondaTemplate(${description}))`, name);
    text = text.replace(`/* @__PURE__ */ __ramondaTemplate(${description})`, name);
  });
  return text.replaceAll("/* @__PURE__ */ __ramondaBlock(", "__ramondaBlock(");
}

function compile(source: string, id = "page.tsx") {
  const out = compileJsx(source, id);
  if (out === undefined) throw new Error("nothing was compiled");
  return { code: body(out.code, out.templates), templates: out.templates, full: out.code };
}

describe("where a block is made", () => {
  test("where the module is evaluated: once, its template on the spot, both calls pure", () => {
    const { full } = compile(`export const icon = <svg viewBox="0 0 1 1">{size}</svg>;`);
    expect(full).toContain(
      `export const icon = /* @__PURE__ */ __ramondaBlock(/* @__PURE__ */ __ramondaTemplate({ t: "svg", a: { "viewBox": "0 0 1 1" }, h: 0 }), [size]);`,
    );
  });

  test.each([
    ["a function", `function view() { return <p>{x}</p>; }`],
    ["an arrow", `const view = () => <p>{x}</p>;`],
    ["a method", `class A { render() { return <p>{x}</p>; } }`],
    ["a class field", `class A { view = <p>{x}</p>; }`],
    ["a function expression", `const view = function () { return <p>{x}</p>; };`],
    ["a for…of loop", `for (const x of xs) rows.push(<p>{x}</p>);`],
    ["a for loop", `for (let i = 0; i < n; i++) rows.push(<p>{x}</p>);`],
    ["a for…in loop", `for (const k in o) rows.push(<p>{x}</p>);`],
    ["a while loop", `while (more()) rows.push(<p>{x}</p>);`],
    ["a do…while loop", `do rows.push(<p>{x}</p>); while (more());`],
    ["a hole of a block in a function", `const view = () => <ul>{xs.map((x) => <p>{x}</p>)}</ul>;`],
  ])("inside %s: its template made where first used, and kept", (_name, source) => {
    const { full } = compile(source);
    expect(full).toContain(`__ramondaBlock(__ramondaT0 || (__ramondaT0 = __ramondaTemplate(`);
    expect(full).not.toContain("@__PURE__");
  });

  test("an element no module imports is left out of the bundle, as a `jsx()` call would be", async () => {
    const icons = `export const used = <svg viewBox="0 0 1 1" />;\nexport const unused = <svg viewBox="0 0 2 2" />;\n`;
    const compiled = compileJsx(icons, "icons.tsx");
    const result = await esbuild({
      stdin: { contents: `import { used } from "icons"; console.log(used);`, loader: "js" },
      bundle: true,
      write: false,
      format: "esm",
      plugins: [
        {
          name: "icons",
          setup(build) {
            build.onResolve({ filter: /^(icons|@ramonda\/core\/jsx-runtime)$/ }, (args) => ({
              path: args.path,
              namespace: "icons",
            }));
            build.onLoad({ filter: /.*/, namespace: "icons" }, (args) => ({
              contents:
                args.path === "icons"
                  ? (compiled?.code ?? "")
                  : "export function __template(d) { return { d }; }\nexport function __block(t, v) { return { t, v }; }\n",
              loader: "js",
            }));
          },
        },
      ],
    });
    const out = result.outputFiles[0].text;
    expect({ used: out.includes("0 0 1 1"), unused: out.includes("0 0 2 2") }).toEqual({ used: true, unused: false });
  });
});

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

  test("a literal written over two lines of a CRLF file is baked as written, as esbuild and Oxc hand it to `jsx()`", () => {
    const source = `const p = <p title="one\r\ntwo">x</p>;`;
    const {
      templates: [p],
    } = compile(source);
    const written = /title: "([^"]*)"/.exec(transformSync(source, { loader: "jsx", jsx: "automatic" }).code)?.[1];
    expect({ baked: p, esbuild: written }).toEqual({
      baked: `{ t: "p", a: { "title": "one\\r\\ntwo" }, c: ["x"] }`,
      esbuild: "one\\r\\ntwo",
    });
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
  test("on an SVG element, names that differ in case are two attributes, and each is baked", () => {
    const {
      templates: [svg],
    } = compile(`const s = <svg viewBox="0 0 1 1" viewbox="0 0 2 2" />;`);
    expect(svg).toBe(`{ t: "svg", a: { "viewBox": "0 0 1 1", "viewbox": "0 0 2 2" } }`);
  });

  test.each([
    ["a name written twice", `<div title="a" title={t}>x</div>`],
    ["`htmlFor` and `for`", `<label htmlFor="a" for={b}>x</label>`],
    ["`tabIndex` and `tabindex`", `<div tabIndex="1" tabindex={b}>x</div>`],
    ["`__proto__`, which an object literal takes as its prototype", `<div __proto__="x">y</div>`],
  ])(
    "an element writing one attribute twice, or one no object can hold — %s — is left to `jsx()`",
    (_name, element) => {
      expect(compileJsx(`const e = ${element};`, "page.tsx")).toBeUndefined();
    },
  );

  test("and the elements inside it are still compiled", () => {
    const { code } = compile(`const e = <div title="a" title={t}><p>{x}</p></div>;`);
    expect(code).toBe(`const e = <div title="a" title={t}>{__ramondaBlock(__ramondaT0, [x])}</div>;`);
  });
});

describe("text, cleaned as the JSX transforms clean it", () => {
  /** The text esbuild's own JSX transform gives `<p>…</p>`'s one child, or `undefined` for none. */
  const esbuildText = (inner: string): string | undefined => {
    const out = transformSync(`const a = <p>${inner}</p>;`, { loader: "jsx", jsx: "automatic" }).code;
    const children = /children: ("(?:[^"\\]|\\.)*")/.exec(out);
    // A JavaScript string — esbuild leaves a tab in it as a tab, which JSON does not allow.
    return children === null ? undefined : (new Function(`return ${children[1]};`)() as string);
  };
  /** The text the compiler bakes for the same `<p>`, or `undefined` for none. */
  const compiledText = (inner: string): string | undefined => {
    const template = compileJsx(`const a = <p>${inner}</p>;`, "page.tsx")?.templates[0];
    const children = template === undefined ? null : /c: \[("(?:[^"\\]|\\.)*")\]/.exec(template);
    return children === null ? undefined : (JSON.parse(children[1]) as string);
  };

  test.each([
    ["a tab inside a line", "a\tb"],
    ["a non-breaking space where a line begins", "\n  \u00a0Total\n"],
    ["a non-breaking space where a line ends", "\n  Total:\u00a0\n  more\n"],
    ["a line separator", "a\u2028   b"],
    ["a vertical tab and a byte-order mark at the edges", "\n\u000b  x \ufeff\n"],
    ["spaces on a single line", "  a  "],
    ["blank lines between two", "\n  one\n\n  two  \n"],
  ])("as esbuild does: %s", (_name, inner) => {
    expect(compiledText(inner)).toBe(esbuildText(inner));
  });

  /** The text Oxc — Vite 8's transform — gives the same `<p>`, or `undefined` for none. */
  const oxcText = (inner: string): string | undefined => {
    const out = oxc().transformSync("a.jsx", `const a = <p>${inner}</p>;`, { jsx: { runtime: "automatic" } }).code;
    const children = /children: ("(?:[^"\\]|\\.)*")/.exec(out);
    return children === null ? undefined : (new Function(`return ${children[1]};`)() as string);
  };

  test("as esbuild and Oxc both do, over every mix of whitespace and line breaks — or not at all", () => {
    const pieces = [
      " ",
      "\t",
      "\n",
      "\r\n",
      "\r",
      "\u00a0",
      "\u2028",
      "\u3000",
      "\u180e",
      "\u200b",
      "\u0085",
      "a",
      "b",
    ];
    let seed = 7;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    const differ: string[] = [];
    for (let run = 0; run < 600; run++) {
      let inner = "x";
      for (let k = next() % 8; k > 0; k--) inner += pieces[next() % pieces.length];
      inner += "y";
      // Left to `jsx()`, it is whichever transform's: nothing to compare.
      if (compileJsx(`const a = <p>${inner}</p>;`, "page.tsx") === undefined) continue;
      const compiled = compiledText(inner);
      if (compiled !== esbuildText(inner) || compiled !== oxcText(inner)) differ.push(JSON.stringify(inner));
    }
    expect(differ).toEqual([]);
  });

  test.each([
    ["a zero-width space", "\n  \u200bHello\n"],
    ["a next-line character", "\n \u0085Hello\n"],
  ])("text the two transforms clean differently — %s — is left to `jsx()`", (_name, inner) => {
    expect({
      esbuild: esbuildText(inner) === oxcText(inner),
      compiled: compileJsx(`const a = <p>${inner}</p>;`, "page.tsx"),
    }).toEqual({
      esbuild: false,
      compiled: undefined,
    });
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

  test.each([
    [
      "an HTML element",
      `<div constructor="x" toString="y">hi</div>`,
      `{ t: "div", a: { "constructor": "x", "toString": "y" }, c: ["hi"] }`,
    ],
    ["an SVG element", `<svg constructor="a" />`, `{ t: "svg", a: { "constructor": "a" } }`],
  ])(
    "an attribute named like an object's own member, on %s, is an attribute like any other",
    (_name, element, description) => {
      expect(compileJsx(`const e = ${element};`, "page.tsx")?.templates).toEqual([description]);
    },
  );

  test('`<this>` — the `this` expression to Oxc, the string "this" to esbuild — is left to `jsx()`', () => {
    expect(compileJsx(`class A { r() { return <this>x</this>; } }`, "a.tsx")).toBeUndefined();
  });

  test("a module that is not JSX is not read", () => {
    expect(compileJsx(`const a = <div />;`, "a.ts")).toBeUndefined();
  });
});

describe("where the templates go", () => {
  test("after the imports, the runtime import and one `var` for the module's templates", () => {
    const { full } = compile(`import { a } from "a";\nimport b from "b";\nconst top = () => <i>x</i>;\n`);
    expect(full.indexOf("var __ramondaT0;")).toBeGreaterThan(full.indexOf(`import b from "b";`));
    expect(full.indexOf("var __ramondaT0;")).toBeLessThan(full.indexOf("const top"));
  });

  test("a `var` only for a template made where first used: one made where the module is evaluated has none", () => {
    const { full } = compile(`const icon = <i>x</i>;\nconst view = () => <b>{y}</b>;\n`);
    expect(full.match(/\nvar [^\n]*;\n/g)).toEqual(["\nvar __ramondaT1;\n"]);
    expect(compile(`export const icon = <i>x</i>;\n`).full).not.toContain("\nvar ");
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

  test("before a first statement that is an expression, not a directive", () => {
    const { full } = compile(`render(<div id="a">x</div>);\n`);
    expect(full.indexOf("import { __template")).toBeLessThan(full.indexOf("render("));
  });

  test("after a directive, which has to stay first", () => {
    const { full } = compile(`"use client";\nconst top = <i>x</i>;\n`);
    expect(full.startsWith(`"use client";\nimport { __template`)).toBe(true);
  });

  test("after a `#!` line, which has to stay the first", () => {
    const { full } = compile(`#!/usr/bin/env node\nconst top = <i>x</i>;\n`);
    expect(full.startsWith(`#!/usr/bin/env node\n\nimport { __template`)).toBe(true);
  });

  test.each([
    ["CR", "\r"],
    ["CRLF", "\r\n"],
    ["a line separator", "\u2028"],
    ["a paragraph separator", "\u2029"],
  ])("after a `#!` line ended by %s, and nowhere later in the module", (_name, end) => {
    const source = `#!/usr/bin/env node${end}const a = <p>x</p>;${end}const s = \`a\nb\`;`;
    const { full } = compile(source);
    expect({
      first: full.startsWith(`#!/usr/bin/env node${end}\nimport { __template`),
      literal: full.includes("const s = `a\nb`;"),
    }).toEqual({ first: true, literal: true });
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

  test("the Vite plugin reads no file itself: a file outside `server.fs.allow` stays refused", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ramonda-build-allow-"));
    const app = join(dir, "app");
    const outside = join(dir, "outside");
    await mkdir(app);
    await mkdir(outside);
    await writeFile(join(outside, "Secret.tsx"), `export const secret = <p>{"secret"}</p>;\n`);
    await writeFile(join(app, "View.tsx"), `export const view = <p>{"view"}</p>;\n`);
    // The runtime the compiled module imports, as a stand-in: this package does not depend on core.
    const runtime = join(app, "runtime.js");
    await writeFile(runtime, `export const __template = (d) => d, __block = (t, v) => v, jsx = () => null;\n`);
    const server = await createServer({
      configFile: false,
      root: app,
      logLevel: "silent",
      plugins: [viteRamonda()],
      resolve: { alias: { "@ramonda/core/jsx-runtime": runtime, "@ramonda/core/jsx-dev-runtime": runtime } },
      server: { middlewareMode: true, fs: { strict: true, allow: [app] }, ws: false },
    });
    try {
      const serve = (url: string) =>
        server.transformRequest(url).then(
          (result) => result?.code ?? null,
          (error: { code?: string }) => error.code,
        );
      const [inside, outsideIt] = await Promise.all([serve("/View.tsx"), serve(`/@fs${join(outside, "Secret.tsx")}`)]);
      expect({ inside: inside?.includes("__ramondaTemplate"), outside: outsideIt }).toEqual({
        inside: true,
        outside: "ERR_LOAD_URL",
      });
    } finally {
      await server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('the Vite plugin compiles after an `order: "pre"` transform, listed before or after it', async () => {
    // A syntax no JavaScript parser reads, which such a transform rewrites — as `@ramonda/css`'s does.
    const blocks = {
      name: "blocks",
      enforce: "pre" as const,
      transform: {
        order: "pre" as const,
        handler: (code: string) => (code.includes("@@(") ? code.replace(/@@\(([^)]*)\)/g, '"$1"') : null),
      },
    };
    const dir = await mkdtemp(join(tmpdir(), "ramonda-build-order-"));
    await writeFile(join(dir, "Card.tsx"), `export const card = <div className={@@(card)}><b>{title}</b></div>;\n`);
    const runtime = join(dir, "runtime.js");
    await writeFile(runtime, `export const __template = (d) => d, __block = (t, v) => v, jsx = () => null;\n`);
    const served = async (plugins: unknown[]) => {
      const server = await createServer({
        configFile: false,
        root: dir,
        logLevel: "silent",
        plugins: plugins as never,
        resolve: { alias: { "@ramonda/core/jsx-runtime": runtime, "@ramonda/core/jsx-dev-runtime": runtime } },
        server: { middlewareMode: true, ws: false },
      });
      try {
        return (await server.transformRequest("/Card.tsx"))?.code.includes("__ramondaTemplate");
      } finally {
        await server.close();
      }
    };
    try {
      expect({ after: await served([viteRamonda(), blocks]), before: await served([blocks, viteRamonda()]) }).toEqual({
        after: true,
        before: true,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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

  test("the Vite plugin compiles an app's JSX module unless told not to — no package's, no virtual one", async () => {
    const source = `export const view = <p>{1}</p>;\n`;
    const file = "/app/src/view.tsx";
    const [, compiler] = viteRamonda();
    const compile = (plugin: ReturnType<typeof viteRamonda>[1], id: string) =>
      plugin.transform.handler.call(undefined, source, id);
    const [on, off, query, packaged, virtual] = await Promise.all([
      compile(compiler, file),
      compile(viteRamonda({ compile: false })[1], file),
      compile(compiler, `${file}?raw`),
      compile(compiler, "/app/node_modules/lib/view.tsx"),
      compile(compiler, "\0virtual.tsx"),
    ]);
    expect({ on: on?.code.includes("__ramondaTemplate"), off, query, packaged, virtual }).toEqual({
      on: true,
      off: null,
      query: null,
      packaged: null,
      virtual: null,
    });
  });
});

/** The source map's original line for the first generated position of `needle`, decoded by hand. */
function originalPosition(
  code: string,
  map: { mappings: string },
  needle: string,
): { line: number; column: number } | undefined {
  const at = code.indexOf(needle);
  const line = code.slice(0, at).split("\n").length - 1;
  const column = at - code.lastIndexOf("\n", at - 1) - 1;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let source = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let found: { line: number; column: number } | undefined;
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
      if (generatedLine === line && generatedColumn <= column && fields.length > 1) {
        found = { line: sourceLine, column: sourceColumn + (column - generatedColumn) };
      }
    }
  });
  void source;
  return found;
}

describe("where each element was written, for a development build", () => {
  test("the file on the root, and every element's line and column, counted from 1 as `jsxDEV`'s are", () => {
    const source = `const v = (\n  <section>\n    <p>x</p>\n    <button onclick={go}>save</button>\n  </section>\n);\n`;
    const out = compileJsx(source, "/app/src/page.tsx", { sources: true });
    expect(out?.templates).toEqual([
      `{ t: "section", f: "/app/src/page.tsx", l: [2, 3], c: [{ t: "p", l: [3, 5], c: ["x"] }, { t: "button", l: [4, 5], d: [["onclick", 0]], c: ["save"] }] }`,
    ]);
  });

  test.each([
    ["a CR line break", "const s = 1;\rconst x = <p>{y}</p>;"],
    ["a CRLF line break", "const s = 1;\r\nconst x = <p>{y}</p>;"],
    ["a line separator in a string", 'const s = "\u2028";\nconst x = <p>{y}</p>;'],
    ["a paragraph separator in a string", 'const s = "\u2029";\nconst x = <p>{y}</p>;'],
    ["a character outside the BMP", 'const s = "😀"; const x = <p>{y}</p>;'],
  ])("at the line and column esbuild and Oxc hand `jsxDEV`, after %s", (_name, source) => {
    const place = (code: string): string | undefined => {
      const found = /lineNumber: (\d+),\s*columnNumber: (\d+)/.exec(code);
      return found === null ? undefined : `${found[1]}:${found[2]}`;
    };
    const fromEsbuild = place(transformSync(source, { loader: "jsx", jsx: "automatic", jsxDev: true }).code);
    const fromOxc = place(
      oxc().transformSync("a.jsx", source, { jsx: { runtime: "automatic", development: true } }).code,
    );
    const compiled = /l: \[(\d+), (\d+)\]/.exec(compileJsx(source, "a.jsx", { sources: true })?.templates[0] ?? "");
    expect({ esbuild: fromEsbuild, oxc: fromOxc }).toEqual({
      esbuild: `${compiled?.[1]}:${compiled?.[2]}`,
      oxc: `${compiled?.[1]}:${compiled?.[2]}`,
    });
  });

  test("and nothing of it otherwise: a production bundle carries no file paths", () => {
    expect(compileJsx(`const p = <p>{x}</p>;`, "/app/src/page.tsx")?.templates).toEqual([`{ t: "p", h: 0 }`]);
  });

  test("the Vite plugin asks for it when the build is not production", async () => {
    const source = `export const view = <p>{1}</p>;\n`;
    const compiled = async (isProduction: boolean) => {
      const [, compiler] = viteRamonda();
      compiler.configResolved({ isProduction });
      return (await compiler.transform.handler.call(undefined, source, "/app/src/view.tsx"))?.code ?? "";
    };
    expect({
      development: (await compiled(false)).includes(`f: "/app/src/view.tsx"`),
      production: (await compiled(true)).includes("f:"),
    }).toEqual({
      development: true,
      production: false,
    });
  });
});

describe("the source map", () => {
  test("points code inside the JSX — a handler's body — at the line and column it was written on", () => {
    const source = `const v = (\n  <div onclick={() => {\n    doThing();\n    throw new Error("boom");\n  }}>x</div>\n);\n`;
    const out = compileJsx(source, "page.tsx");
    if (out === undefined) throw new Error("nothing was compiled");
    // 0-based: `throw` is on the fourth line of the source, four spaces in.
    expect(originalPosition(out.code, out.map, "throw new Error")).toEqual({ line: 3, column: 4 });
  });
});
