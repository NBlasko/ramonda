import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import MarkdownIt from "markdown-it";
import { JSDOM } from "jsdom";
import { createHighlighter } from "shiki";

/**
 * Turns `content/**.md` into one generated module the site imports.
 *
 * ## Why markdown becomes a TREE rather than an HTML string
 *
 * Ramonda has no `dangerouslySetInnerHTML`, and that is not an omission to work
 * around: markup injected as a string is invisible to the diff, so it cannot be
 * hydrated, cannot contain a component, and cannot be part of the render at all.
 * The content has to arrive as vnodes.
 *
 * So each page is serialized to a small tree — `{ t: tag, a: attrs, c: children }`
 * — which `Markdown.tsx` renders with `h()`. That makes a doc page an ordinary
 * Ramonda render: the server prerenders it, the client hydrates it, and a `demo:`
 * fence can resolve to a real component sitting in the middle of the prose.
 *
 * ## Why the tree is built by parsing HTML instead of walking markdown-it tokens
 *
 * markdown-it hands back a FLAT token stream with open/close markers, so building
 * a tree from it means reimplementing nesting for every construct — and getting
 * tables, nested lists and inline runs right is most of a day that buys nothing.
 * Rendering to HTML and walking the parsed DOM is a dozen lines and inherits
 * every construct markdown-it supports, including ones added later.
 *
 * This runs at BUILD time, so jsdom and the markdown parser never reach the
 * browser bundle. What ships is the tree.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const contentDir = join(root, "content");
const outFile = join(root, "src", "generated", "content.ts");
const demosOut = join(root, "src", "generated", "demo-sources.ts");
const demosDir = join(root, "src", "demos");

/**
 * Highlighting happens HERE, at build time, and never in the browser.
 *
 * Shiki uses the same TextMate grammars VS Code does, which is the reason to pay
 * for it: a docs site for a decorator-heavy framework gets `@state count = 0`
 * and generic TSX right, and a regex highlighter gets them visibly wrong often
 * enough to undermine the code it is trying to explain.
 *
 * `defaultColor: false` emits BOTH themes as CSS variables on every token, so
 * the page follows the reader's light/dark preference with no second render and
 * no JavaScript. The cost is a slightly larger HTML payload, paid once at build.
 */
const highlighter = await createHighlighter({
  themes: ["github-light", "github-dark"],
  langs: ["tsx", "ts", "js", "json", "css", "html", "bash", "markdown"],
});

/** A fence language Shiki does not know would throw; fall back to plain text. */
const KNOWN_LANGS = new Set(highlighter.getLoadedLanguages());

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  highlight(code, lang) {
    // A demo fence is not code to highlight — it is a component reference, and
    // it has to reach `toTree` with its language intact. Returning "" lets
    // markdown-it emit its own <pre><code class="language-demo:Name">.
    if (lang.startsWith("demo:")) return "";

    return highlighter.codeToHtml(code, {
      lang: KNOWN_LANGS.has(lang) ? lang : "text",
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
    });
  },
});

/** Attributes that are not `class` are passed through under their own name. */
const ATTRIBUTE_ALIASES = { class: "className", for: "htmlFor" };

/**
 * A fence written as ```demo:Counter becomes a node the site resolves against
 * the demo registry, so an example is a real component rendered live rather than
 * a string that can drift from the code it claims to show.
 */
const DEMO_PREFIX = "language-demo:";

/** "RMD004 — Props mutated" → "rmd004-props-mutated". */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[`'"“”‘’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Gives every heading an `id`, so any section of any page is linkable.
 *
 * It matters most for the reference: somebody who has just been shown `RMD004`
 * by the framework will paste that code into a search box, and the result has to
 * land on the paragraph about it rather than the top of a long page.
 */
function addHeadingIds(document) {
  const used = new Set();
  for (const heading of document.querySelectorAll("h2, h3, h4")) {
    let id = slugify(heading.textContent ?? "");
    if (!id) continue;
    let n = 2;
    while (used.has(id)) id = `${slugify(heading.textContent)}-${n++}`;
    used.add(id);
    heading.setAttribute("id", id);
  }
}

function toTree(node) {
  if (node.nodeType === 3) {
    const text = node.nodeValue;
    return text.trim() === "" && !/[ \n]/.test(text) ? null : text;
  }
  if (node.nodeType !== 1) return null;

  const tag = node.tagName.toLowerCase();

  // <pre><code class="language-demo:Name"> → a demo reference.
  if (tag === "pre") {
    const code = node.firstElementChild;
    const cls = code?.getAttribute("class") ?? "";
    if (cls.startsWith(DEMO_PREFIX)) {
      return { t: "demo", a: { name: cls.slice(DEMO_PREFIX.length) } };
    }
  }

  const attributes = {};
  for (const { name, value } of Array.from(node.attributes)) {
    attributes[ATTRIBUTE_ALIASES[name] ?? name] = value;
  }

  const children = [];
  for (const child of Array.from(node.childNodes)) {
    const built = toTree(child);
    if (built !== null) children.push(built);
  }

  const built = { t: tag };
  if (Object.keys(attributes).length > 0) built.a = attributes;
  if (children.length > 0) built.c = children;
  return built;
}

/** `--- key: value ---` at the top of a file. Deliberately not YAML. */
function splitFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { data: {}, body: source };

  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at === -1) continue;
    data[line.slice(0, at).trim()] = line
      .slice(at + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return { data, body: source.slice(match[0].length) };
}

function walkFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walkFiles(full));
    else if (entry.endsWith(".md")) found.push(full);
  }
  return found;
}

/** `content/index.md` → `/`; `content/guide/state.md` → `/guide/state`. */
function toRoutePath(file) {
  const rel = relative(contentDir, file).split(sep).join("/");
  const withoutExt = rel.replace(/\.md$/, "");
  if (withoutExt === "index") return "/";
  return "/" + withoutExt.replace(/\/index$/, "");
}

const pages = walkFiles(contentDir)
  .map((file) => {
    const { data, body } = splitFrontmatter(readFileSync(file, "utf8"));
    const dom = new JSDOM(`<body>${md.render(body)}</body>`);
    addHeadingIds(dom.window.document);
    const tree = Array.from(dom.window.document.body.childNodes)
      .map(toTree)
      .filter((node) => node !== null);

    if (!data.title) {
      throw new Error(
        `[docs] ${relative(root, file)} has no \`title\` in its frontmatter. ` +
          `Every page needs one: it is the <title>, the search result, and the sidebar label.`,
      );
    }

    return {
      path: toRoutePath(file),
      title: data.title,
      description: data.description ?? "",
      section: data.section ?? "",
      order: Number(data.order ?? 0),
      tree,
    };
  })
  .sort((a, b) => a.order - b.order || a.path.localeCompare(b.path));

/**
 * One module per page, plus a metadata index.
 *
 * The trees used to live in a single `content.ts` that the route table imported
 * eagerly — so every visitor downloaded every page on the site. Measured: 329 KB
 * of client bundle at 26 pages, **511 KB at 44**, growing linearly with nothing
 * to stop it.
 *
 * Now each page is its own module behind a literal `import()`, which the bundler
 * turns into its own chunk. The route table carries only metadata — path, title,
 * description, section — which is what the sidebar needs anyway.
 *
 * The specifiers have to be LITERAL for a bundler to see them, which is why the
 * loader map below is generated rather than built from a variable.
 */
const pagesDir = join(root, "src", "generated", "pages");
rmSync(pagesDir, { recursive: true, force: true });
mkdirSync(pagesDir, { recursive: true });

/** `/concepts/state` → `concepts-state`; `/` → `index`. */
function moduleName(path) {
  if (path === "/") return "index";
  return path.replace(/^\//, "").replace(/\//g, "-");
}

for (const page of pages) {
  const name = moduleName(page.path);
  writeFileSync(
    join(pagesDir, `${name}.ts`),
    `// GENERATED by scripts/build-content.mjs — do not edit.\n` +
      `// Content for ${page.path}\n` +
      `import { Component, Host, h } from "@ramonda/core";\n` +
      `import type { RamondaNode } from "@ramonda/core";\n` +
      `import { Markdown } from "../../Markdown";\n` +
      `import type { ContentNode } from "../../content-types";\n\n` +
      `const tree: ContentNode[] = ${JSON.stringify(page.tree)};\n\n` +
      `@Host("div")\n` +
      `export class Page extends Component {\n` +
      `  render(): RamondaNode {\n` +
      `    return h(Markdown, { tree }) as RamondaNode;\n` +
      `  }\n` +
      `}\n`,
  );
}

// Metadata only — no trees. This is what the route table and sidebar import.
const meta = pages.map(({ tree: _tree, ...rest }) => rest);

writeFileSync(
  outFile,
  `// GENERATED by scripts/build-content.mjs — do not edit.\n` +
    `// Page METADATA only; each page's content is its own chunk (see pages.ts).\n` +
    `import type { PageMeta } from "../content-types";\n\n` +
    `export const pages: readonly PageMeta[] = ${JSON.stringify(meta, null, 2)} as const;\n`,
);

// A placeholder preload map, so a clean checkout can build. The real one is
// written by build-manifest.mjs, which cannot run until a client build has
// produced a metafile — hence the two client passes in `npm run build`.
const preloadsFile = join(root, "src", "generated", "preloads.ts");
if (!existsSync(preloadsFile)) {
  writeFileSync(
    preloadsFile,
    `// PLACEHOLDER — overwritten by scripts/build-manifest.mjs.\n` +
      `export const preloads: Record<string, string> = {};\n` +
      `export const pagePreloads: Record<string, string | undefined> = {};\n`,
  );
}

// Literal specifiers, so the bundler can see each one and emit a chunk.
const loaderEntries = pages
  .map((p) => `  ${JSON.stringify(p.path)}: () => import("./pages/${moduleName(p.path)}"),`)
  .join("\n");

writeFileSync(
  join(root, "src", "generated", "page-loaders.ts"),
  `// GENERATED by scripts/build-content.mjs — do not edit.\n` +
    `// One entry per page. The specifiers are literal because a bundler can only\n` +
    `// split what it can see statically.\n\n` +
    `export const pageLoaders: Record<string, () => Promise<unknown>> = {\n${loaderEntries}\n};\n`,
);

/**
 * The source of every demo, as a string, so a page can show the code beside the
 * running component.
 *
 * Generated rather than pasted, which is the entire point: an example that is
 * copied into prose starts drifting from the code it claims to show on the first
 * refactor, and nothing catches it. Here there is one definition — the `.tsx`
 * file — rendered live and printed verbatim from the same bytes.
 */
const demoFiles = readdirSync(demosDir)
  .filter((f) => f.endsWith(".tsx"))
  .sort();

const sources = {};
for (const file of demoFiles) {
  const code = readFileSync(join(demosDir, file), "utf8").trimEnd();

  // Highlighted at build time exactly like a prose code fence, then serialized
  // to the same vnode tree — so the "show source" panel gets real syntax colour
  // instead of a flat monospace block, following the reader's theme with no JS.
  const html = highlighter.codeToHtml(code, {
    lang: "tsx",
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });
  const dom = new JSDOM(`<body>${html}</body>`);
  const pre = Array.from(dom.window.document.body.childNodes)
    .map(toTree)
    .find((node) => node && typeof node === "object" && node.t === "pre");

  sources[file.replace(/\.tsx$/, "")] = pre ?? { t: "pre", c: [code] };
}

writeFileSync(
  demosOut,
  `// GENERATED by scripts/build-content.mjs — do not edit.\n` +
    `// Source of truth is apps/docs/src/demos/*.tsx.\n\n` +
    `import type { ContentNode } from "../content-types";\n\n` +
    `export const demoSources: Record<string, ContentNode> = ${JSON.stringify(sources)};\n`,
);
console.log(`[docs] ${demoFiles.length} demo source(s) → src/generated/demo-sources.ts`);
console.log(
  `[docs] ${pages.length} page(s) → ${relative(root, outFile)}\n` +
    pages.map((p) => `        ${p.path}  ${p.title}`).join("\n"),
);
