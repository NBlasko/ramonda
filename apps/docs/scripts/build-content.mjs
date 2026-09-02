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
 * — which `Markdown.tsx` renders with `__h()`. That makes a doc page an ordinary
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

/**
 * Raw HTML in prose, which this pipeline renders as TEXT.
 *
 * `md.render` runs with `html: false` on purpose — a documentation page has no business injecting
 * markup — but the consequence is that a tag written in prose is escaped and shown to the reader
 * verbatim. That shipped: `/devtools` told people to press `<kbd>Alt</kbd>+<kbd>D</kbd>`, in those exact
 * characters, because the author (me) assumed the tag would work and nothing said otherwise. A picture
 * cannot fail a build and neither could this.
 *
 * Code is exempt, because inside a fence or backticks a tag is the subject rather than a mistake. Every
 * page passes today — the scan found nothing once `/devtools` was fixed — so failing is safe.
 */
const RAW_TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(\s[^<>]*)?\/?>/;

function findRawHtml(nodes, inCode = false) {
  for (const node of nodes) {
    if (typeof node === "string") {
      if (inCode) continue;
      const found = RAW_TAG.exec(node);
      if (found) return found[0];
      continue;
    }
    if (!node || typeof node !== "object") continue;
    const code = inCode || node.t === "code" || node.t === "pre";
    const hit = findRawHtml(node.c ?? [], code);
    if (hit) return hit;
  }
  return undefined;
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

    // Prove the check can fail before trusting that it passes.
    const rawHtml = findRawHtml(process.env.DOCS_SELFTEST === "rawhtml" ? [...tree, "<kbd>Alt</kbd>"] : tree);
    if (rawHtml) {
      throw new Error(
        `[docs] ${relative(root, file)} contains raw HTML in prose: ${rawHtml}\n\n` +
          `        Markdown here is rendered with html: false, so that tag reaches the reader as those\n` +
          `        exact characters. Put it in backticks if you meant to show it, or use markdown\n` +
          `        (**bold**, *italic*) if you meant to format.`,
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
      `import { Component, __h } from "@ramonda/core";\n` +
      `import type { RamondaNode } from "@ramonda/core";\n` +
      `import { Markdown } from "../../Markdown";\n` +
      `import type { ContentNode } from "../../content-types";\n\n` +
      `const tree: ContentNode[] = ${JSON.stringify(page.tree)};\n\n` +
      `export class Page extends Component {\n` +
      `  render(): RamondaNode {\n` +
      `    return __h("div", null, __h(Markdown, { tree })) as RamondaNode;\n` +
      `  }\n` +
      `}\n`,
  );
}

// Metadata only — no trees. This is what the route table and sidebar import.
const meta = pages.map(({ tree: _tree, ...rest }) => rest);

/**
 * `satisfies` rather than an annotation, and the difference is the whole point.
 *
 * `: readonly PageMeta[]` checked the shape and WIDENED every `path` back to `string` — so
 * `createRoutes` inferred `keyof` as `string`, `AnyHref` collapsed to `string`, and every
 * `<Link href>` on this site was unchecked. Measured while fixing it:
 * `href="/total/nonsense/not/a/route"` compiled. The `as const` beside the annotation had been
 * there the whole time and could not help; an `as const` is only as narrow as what sits next to it.
 *
 * `satisfies` checks the same shape and keeps the literals, so `DocPath` below is the real union of
 * this site's paths and `RouteTypeClaims.tsx` can assert what it refuses.
 */
writeFileSync(
  outFile,
  `// GENERATED by scripts/build-content.mjs — do not edit.\n` +
    `// Page METADATA only; each page's content is its own chunk (see pages.ts).\n` +
    `import type { PageMeta } from "../content-types";\n\n` +
    `export const pages = ${JSON.stringify(meta, null, 2)} as const satisfies readonly PageMeta[];\n\n` +
    `/** Every path this site has, as a union — what types \`<Link href>\` and \`nav.push\`. */\n` +
    `export type DocPath = (typeof pages)[number]["path"];\n`,
);

/**
 * The route table, written OUT rather than built in a loop.
 *
 * A loop over `Record<string, VNode>` produces an object whose key type is `string`, and
 * `createRoutes` infers its path union from the keys — so the loop was what threw the checking
 * away. This is the same argument `page-loaders.ts` below is written for, one level up: a bundler
 * can only split what it can see statically, and a type can only check what it can see written.
 *
 * Still generated from the content directory, so adding a markdown file still adds a route and
 * there is no second list to keep in step with the first.
 */
const tableEntries = meta
  .map((page, index) => `  ${JSON.stringify(page.path)}: __h(DocPage, { meta: pages[${index}] }),`)
  .join("\n");

writeFileSync(
  join(root, "src", "generated", "route-table.ts"),
  `// GENERATED by scripts/build-content.mjs — do not edit.\n` +
    `// One entry per page, written out so the keys are literal: \`createRoutes\` takes the path\n` +
    `// union from them, and that union is what makes a wrong <Link href> a compile error.\n\n` +
    `import { __h } from "@ramonda/core";\n` +
    `import { DocPage } from "../DocPage";\n` +
    `import { pages } from "./content";\n\n` +
    `export const table = {\n${tableEntries}\n` +
    `  // The catch-all. Its meta is the home page's, and \`notFound\` is what DocPage reads.\n` +
    `  "*": __h(DocPage, { meta: pages[0], notFound: true }),\n};\n`,
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
    `// \`Lazy\` rather than a hand-written signature: it is what <AsyncLoad lazy> takes, so a\n` +
    `// change to it is caught here rather than at the one call site that indexes this map.\n` +
    `import type { Lazy } from "@ramonda/core";\n\n` +
    `export const pageLoaders: Record<string, Lazy> = {\n${loaderEntries}\n};\n`,
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
