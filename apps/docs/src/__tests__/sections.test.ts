// @vitest-environment node
// Walks `content/` off disk, like `links.test.ts` and `descriptions.test.ts` beside it.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every directory under `content/` is a section, and every section is a page.
 *
 * ## The fault this exists for
 *
 * Nine sections had a landing page and four did not — `/reference` with 22 pages under it,
 * `/concepts` with 11, `/composition` with 6, `/guide` with 2. Those four URLs 404'd, so a reader
 * who trimmed an address back to its section sometimes got a page and sometimes nothing, with no
 * way to tell which kind of section they were on.
 *
 * It is also the shape a search engine ranks: a section index is one page about a whole subject,
 * which is exactly what a broad query matches — and four of them did not exist to be found.
 *
 * Measured off the file tree rather than off the routes, because that is where the asymmetry lives:
 * a directory is created by adding a page to it, and nothing until now asked for the index.
 */
const here = dirname(fileURLToPath(import.meta.url));
const content = join(here, "..", "..", "content");

const sections = readdirSync(content, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe("a section is a page", () => {
  it("finds the sections", () => {
    // The floor the other two tests use: a walk that stopped finding directories would leave the
    // assertion below passing against nothing.
    expect(sections.length).toBeGreaterThan(10);
  });

  it("every directory under content/ has an index.md", () => {
    const missing = sections.filter((section) => {
      const index = join(content, section, "index.md");
      return !(statSync(index, { throwIfNoEntry: false })?.isFile() ?? false);
    });

    expect(missing).toEqual([]);
  });
});

/** Every page under `content/`, with its frontmatter's `section` and `order` and its last heading. */
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith(".md") ? [join(dir, entry.name)] : [],
  );
const pagesOnDisk = walk(content).map((file) => {
  const text = readFileSync(file, "utf8");
  const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const field = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, "m").exec(front)?.[1]?.trim() ?? "";
  return {
    file: file.slice(content.length + 1),
    section: field("section").replace(/^["']|["']$/g, ""),
    order: field("order"),
    nav: field("nav") !== "false",
    lastHeading: [...text.matchAll(/^## (.+)$/gm)].at(-1)?.[1] ?? "",
  };
});

/**
 * Two pages of one section at one `order` are put in place by their PATH, which nobody chose —
 * and the page before or after one is read off that order. Found twice in Reference.
 */
describe("order", () => {
  it("is not shared by two pages of one section", () => {
    const seen = new Map<string, string>();
    const shared: string[] = [];
    for (const page of pagesOnDisk.filter((one) => one.nav)) {
      const key = `${page.section}|${page.order}`;
      const other = seen.get(key);
      if (other !== undefined) shared.push(`${other} and ${page.file}: ${page.section || "(top)"} ${page.order}`);
      seen.set(key, page.file);
    }

    expect(pagesOnDisk.length).toBeGreaterThan(100);
    expect(shared).toEqual([]);
  });
});

/**
 * A page ends by saying where to go — `AUTHORING.md` §6 — and under ONE name, so a reader who has
 * learned to look for it finds it. It was `Next` on 114 pages, and `Where to go next` and `Read
 * next` on three others; one of them had both.
 */
describe("the closing section", () => {
  /** The home page ends on its own "Start here", and the diagnostics file is split into pages. */
  const EXEMPT = ["index.md", join("reference", "diagnostics.md")];

  it("is called Next, and every page has one", () => {
    const otherwise = pagesOnDisk
      .filter((page) => !EXEMPT.includes(page.file) && page.lastHeading !== "Next")
      .map((page) => `${page.file}: ${page.lastHeading || "(no heading)"}`);

    expect(otherwise).toEqual([]);
  });
});

/**
 * A section's first page shows the thing before it asks the reader to install it: what it does,
 * an example — code, a live demo, or a picture of it — then the install. Five of them opened on an install command,
 * which asks for a decision before saying what it is for.
 */
describe("a section's first page", () => {
  const first = new Map<string, (typeof pagesOnDisk)[number]>();
  for (const page of pagesOnDisk.filter((one) => one.nav && one.section !== "")) {
    const held = first.get(page.section);
    if (held === undefined || Number(page.order) < Number(held.order)) first.set(page.section, page);
  }

  it("shows an example before its install", () => {
    const installFirst = [...first.values()]
      .filter((page) => {
        const text = readFileSync(join(content, page.file), "utf8");
        const install = text.search(/^```install$/m);
        // An example is code, a live demo, or a picture of the thing — the devtools panel is one.
        const shown = text.search(/^```(tsx|ts|demo:\S+)( |$)|^!\[/m);
        return install !== -1 && (shown === -1 || shown > install);
      })
      .map((page) => page.file);

    expect(first.size).toBeGreaterThan(10);
    expect(installFirst).toEqual([]);
  });
});
