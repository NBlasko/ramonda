import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import MarkdownIt from "markdown-it";
import { JSDOM } from "jsdom";
import { highlighter } from "./highlighter.mjs";
import { ruleCatalogue } from "@ramonda/check";

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

/**
 * A page for every diagnostic, split out of the one page they all shared.
 *
 * ## Why split rather than generate
 *
 * The runtime HAS a structured table — `SPECS` in `core/src/debug/diagnostics.ts`, with a title and
 * a fix per code — and generating from it was the obvious move. Two things against it. The prose
 * here is richer: it carries examples, the reasoning, and what the fault looks like from the
 * outside, where `SPECS.fix` is one paragraph for a console. And that table is DEV-only and
 * stripped from production builds, so publishing it as surface would invite it back into a bundle.
 *
 * So the markdown stays the source, and this reads it. The file is unchanged and still checked by
 * `check-api-coverage.mjs`, which asserts every code raised in the source has a section here.
 *
 * ## What this buys, beyond a page each
 *
 * The anchors it replaces were the whole HEADING — `#rmd003-context-consumed-without-a-provider-
 * above-it` — so rewording a title broke every link to it. That is the exact fault `links.test.ts`
 * was written for, after twenty-two of them died at once. `/reference/diagnostics/rmd003` cannot
 * break that way: the code is the one part of a diagnostic that never changes, because a code is
 * never reused.
 */
function diagnosticPages(source) {
  const { data, body } = splitFrontmatter(source);
  const lines = body.split("\n");

  /** Where each family and each code starts, in file order. */
  const marks = [];
  lines.forEach((line, at) => {
    const family = /^# (.+)$/.exec(line);
    const code = /^## (RM[A-Z]\d{3})\s+—\s+(.+)$/.exec(line);
    if (family && at > 0) marks.push({ kind: "family", at, name: family[1] });
    if (code) marks.push({ kind: "code", at, code: code[1], title: code[2] });
  });

  const first = marks.find((mark) => mark.kind === "family");
  if (first === undefined) throw new Error("[docs] diagnostics.md has no family heading to split on");

  const made = [];
  const index = [lines.slice(0, first.at).join("\n")];

  for (const [n, mark] of marks.entries()) {
    const until = marks[n + 1]?.at ?? lines.length;
    if (mark.kind === "family") {
      index.push(`# ${mark.name}`, "");
      continue;
    }
    const path = `/reference/diagnostics/${mark.code.toLowerCase()}`;
    index.push(`- [\`${mark.code}\`](${path}) — ${mark.title}`);
    made.push({
      source: [
        "---",
        `title: ${mark.code}`,
        `description: ${mark.title.replace(/`/g, "")}`,
        "section: Diagnostics",
        "nav: false",
        `order: ${400 + n}`,
        "---",
        "",
        `# ${mark.code} — ${mark.title}`,
        "",
        lines
          .slice(mark.at + 1, until)
          .join("\n")
          .replace(/\n*---\n*$/, "")
          .trim(),
        "",
        "## Next",
        "",
        "- [All diagnostics](/reference/diagnostics) — every code the framework can report.",
        "- [Checking your app](/reference/check) — the faults proved from the source, before anything runs.",
      ].join("\n"),
      path,
      label: `reference/diagnostics/${mark.code.toLowerCase()} (generated)`,
    });
  }

  /**
   * The index's own `Next`, added HERE rather than written at the end of the file.
   *
   * A `## Next` in `diagnostics.md` would sit after the last code's section, so the split would
   * carry it onto that code's PAGE and the index would still end nowhere — the one page on the site
   * where the obvious place to write it is the wrong one.
   */
  index.push(
    "## Next",
    "",
    "- [Checking your app](/reference/check) — the same faults proved from your source, before any",
    "  of these can be reported.",
    "- [Rules](/rules) — every check that runs there, one page each.",
    "- [Reference](/reference) — the other pages you come back to rather than read once.",
  );

  const front = Object.entries(data).map(([key, value]) => `${key}: ${value}`);
  return {
    index: { source: ["---", ...front, "---", "", ...index, ""].join("\n"), path: "/reference/diagnostics" },
    pages: made,
  };
}

/**
 * A page for every rule the checker runs, built from the rule itself.
 *
 * ## Why generated and not written
 *
 * There are 84 of them, and the reference page that stood in for all of them was one table. Written
 * by hand they would be 84 things that can go stale — and this site has already proved that happens:
 * the table was NINE rows out of date the day the rules landed beside it, which is why
 * `build-rule-tables.mjs` exists at all. A rule cannot now be added without its page appearing.
 *
 * ## Why the ADVICE and not the docstring
 *
 * The docstrings are the better prose — 8,751 lines of it, the best-argued writing in the
 * repository. They are also the wrong text for a page, and not by a little: a docstring argues with
 * the PAST. It says which shape was rejected, what a measurement disproved, why the obvious fix is
 * wrong. That is exactly right beside the code, where it stops somebody undoing a decision, and
 * exactly wrong for a reader meeting the rule cold — who does not care what was, only how it works
 * now.
 *
 * `advice` is already the reader's text: it is what the command prints to a person under a report.
 * So the page and the terminal say ONE thing, and neither can drift from the other.
 *
 * ## Why a page each, rather than the table
 *
 * The table is still there and still generated. What it cannot do is be FOUND: a search engine
 * ranks a page, and eighty-four rules sharing one URL is one result for eighty-four questions.
 * Somebody whose build just printed `row-without-a-key` types that, and it should land on the rule.
 */
function rulePages() {
  const rules = ruleCatalogue();
  const index = [
    "---",
    "title: Rules",
    `description: Every check \`ramonda-check\` runs — ${rules.length} of them, each one able to fail a build.`,
    "section: Reference",
    "order: 111",
    "---",
    "",
    "# Rules",
    "",
    `\`ramonda-check\` runs **${rules.length} rules**. Each has its own page: what it reports, why that`,
    "is a fault, and what to write instead. The page and the terminal say the same thing, because both",
    "come from the rule.",
    "",
    "**Every one of them fails the run.** There is no warning level: a warning that never fails",
    "anything is read once and then not read at all. Where a rule is wrong about your code, the",
    "answer is `// ramonda-check-ignore <reason>` on the line — which records the decision rather",
    "than hiding it, and is printed back on every run. See",
    '[how to say "not here"](/reference/check#every-rule-fails-the-run-and-how-to-say-not-here).',
    "",
    "Looking for a rule by the trouble it explains rather than by its name?",
    "[Something is wrong](/symptoms) is indexed by what you can see, and",
    "[Accessibility](/accessibility) groups the thirty-five that are about it.",
    "",
    // Split only when there is something to split. Every rule fails the run today, so two headings
    // would be one list and a heading over nothing — and a "Warnings" heading with no rules under
    // it reads as a list that failed to render rather than as a fact.
    ...(rules.some((rule) => rule.severity === "warn")
      ? [
          ...section(
            rules.filter((rule) => rule.severity === "error"),
            "Errors",
          ),
          ...section(
            rules.filter((rule) => rule.severity === "warn"),
            "Warnings",
          ),
        ]
      : section(rules, "Every rule")),
    "## Next",
    "",
    "- [Checking your app](/reference/check) — how to run it, and what it proves that a running page cannot.",
    "- [Diagnostics](/reference/diagnostics) — what the framework reports at runtime.",
  ].join("\n");

  return [
    { source: index, path: "/rules", label: "rules/index (generated)" },
    ...rules.map((rule, at) => ({
      source: pageFor(rule, at),
      path: `/rules/${rule.id}`,
      label: `rules/${rule.id} (generated)`,
    })),
  ];
}

/** One heading and its list, for the index. */
function section(rules, heading) {
  return [
    `## ${heading}`,
    "",
    ...rules.map((rule) => `- [\`${rule.id}\`](/rules/${rule.id}) — ${rule.reportedWhen}`),
    "",
  ];
}

/**
 * One rule's page.
 *
 * `order` runs from 301 so the whole set sorts after the reference, in the catalogue's own order —
 * which is the order the COMMAND prints its reports in, and therefore the order a reader has
 * already met them in.
 */
/**
 * The `<meta name="description">` a search result shows under the title.
 *
 * A `reportedWhen` is one clause and eight of them run past 250 characters, where a search engine
 * shows about 155 and cuts the rest mid-word — so the sentence a reader is offered ends nowhere.
 * Cut at the last CLAUSE boundary that fits instead: these clauses are built with em dashes and
 * commas, so there is almost always one, and what is left is a whole thought rather than a stump.
 *
 * The page itself still carries the full sentence under **Reported when**; only the summary is
 * shortened, which is the difference between a description and a truncation.
 */
function describe(rule) {
  const full = `${rule.severity === "error" ? "Fails the run" : "Warns"} when ${rule.reportedWhen}`;
  if (full.length <= 155) return full;

  const cut = full.slice(0, 155);
  const at = Math.max(cut.lastIndexOf(" — "), cut.lastIndexOf(", "), cut.lastIndexOf(" so "));
  return at > 80 ? `${cut.slice(0, at)}…` : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

function pageFor(rule, at) {
  const codes = rule.alsoReportedAs ?? [];
  return [
    "---",
    `title: ${rule.id}`,
    `description: ${describe(rule)}`,
    "section: Rules",
    "nav: false",
    `order: ${301 + at}`,
    "---",
    "",
    `# \`${rule.id}\``,
    "",
    rule.severity === "error"
      ? "**This fails the run.** Where it is wrong about your code, `// ramonda-check-ignore <reason>` on the line says so, and the reason is printed on every run."
      : "**This is a warning.** It prints and lets the build through.",
    "",
    `**Reported when** ${rule.reportedWhen}.`,
    "",
    codes.length > 0
      ? `The framework reports the same fault while running, as ${codes
          .map((code) => `[\`${code}\`](/reference/diagnostics/${code.toLowerCase()})`)
          .join(
            " and ",
          )} — but only once the line actually runs. This is the same fault proved from the source instead.\n`
      : "",
    rule.advice,
    "",
    "## Next",
    "",
    "- [All rules](/rules) — the other checks this one runs beside.",
    "- [Checking your app](/reference/check) — how to run it, and what it proves.",
  ].join("\n");
}

/**
 * One page, from its markdown — the SAME pipeline for a file on disk and for a generated page.
 *
 * A second renderer beside this one is the shape this repository has been bitten by repeatedly: two
 * things answering one question, drifting apart quietly. So the rule pages below are markdown
 * handed to this function, not markup built another way.
 */
function pageOf(source, routePath, label) {
  {
    const file = label;
    const { data, body } = splitFrontmatter(source);
    const dom = new JSDOM(`<body>${md.render(body)}</body>`);
    addHeadingIds(dom.window.document);
    const tree = Array.from(dom.window.document.body.childNodes)
      .map(toTree)
      .filter((node) => node !== null);

    if (!data.title) {
      throw new Error(
        `[docs] ${file} has no \`title\` in its frontmatter. ` +
          `Every page needs one: it is the <title>, the search result, and the sidebar label.`,
      );
    }

    // Prove the check can fail before trusting that it passes.
    const rawHtml = findRawHtml(process.env.DOCS_SELFTEST === "rawhtml" ? [...tree, "<kbd>Alt</kbd>"] : tree);
    if (rawHtml) {
      throw new Error(
        `[docs] ${file} contains raw HTML in prose: ${rawHtml}\n\n` +
          `        Markdown here is rendered with html: false, so that tag reaches the reader as those\n` +
          `        exact characters. Put it in backticks if you meant to show it, or use markdown\n` +
          `        (**bold**, *italic*) if you meant to format.`,
      );
    }

    return {
      path: routePath,
      title: data.title,
      description: data.description ?? "",
      section: data.section ?? "",
      order: Number(data.order ?? 0),
      // Frontmatter is text, so the flag is compared as text — the same shape as `order` above,
      // which is `Number(...)` for the same reason.
      ...(String(data.nav) === "false" ? { nav: false } : {}),
      tree,
    };
  }
}

/**
 * `diagnostics.md` is the one file that is not one page.
 *
 * It carried 74 codes in 1,845 lines — one URL for 74 questions, which is one search result for 74
 * of them. Split here rather than on disk so the file stays a single readable source, and so
 * `check-api-coverage.mjs` keeps checking the same thing it always has.
 */
const diagnosticsFile = join(contentDir, "reference", "diagnostics.md");
const split = diagnosticPages(readFileSync(diagnosticsFile, "utf8"));

const pages = [
  ...walkFiles(contentDir)
    .filter((file) => file !== diagnosticsFile)
    .map((file) => pageOf(readFileSync(file, "utf8"), toRoutePath(file), relative(root, file))),
  pageOf(split.index.source, split.index.path, "reference/diagnostics (index)"),
  ...split.pages.map((made) => pageOf(made.source, made.path, made.label)),
  ...rulePages().map((made) => pageOf(made.source, made.path, made.label)),
].sort((a, b) => a.order - b.order || a.path.localeCompare(b.path));

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
