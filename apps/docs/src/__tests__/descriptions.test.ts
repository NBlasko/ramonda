// @vitest-environment node
// Reads frontmatter off disk and touches no DOM, like `links.test.ts` beside it.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every page's `description`, which is the one line a search engine shows under its title.
 *
 * ## The two ways it goes wrong, and both were here
 *
 * **Missing.** `composition/portal.md` had none, so a result for it showed whatever the engine
 * scraped — the first prose on the page, mid-sentence.
 *
 * **Too long.** Eight generated rule pages ran past 250 characters, where about 155 are shown and
 * the rest is cut mid-word, so the sentence a reader is offered ends nowhere. The generator now
 * trims at a clause boundary; this is what keeps a hand-written one honest too.
 *
 * The ceiling is 160 rather than 155: engines differ, they measure pixels rather than characters,
 * and a test that fails on a description one character over what Google happened to show last week
 * is a test people switch off.
 */
const here = dirname(fileURLToPath(import.meta.url));
const content = join(here, "..", "..", "content");

function pages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) pages(full, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

const files = pages(content);
const described = files.map((file) => ({
  page: relative(content, file),
  description: (/^description:\s*(.*)$/m.exec(readFileSync(file, "utf8"))?.[1] ?? "").trim().replace(/^"|"$/g, ""),
}));

describe("what a search result shows", () => {
  it("finds enough pages to be checking anything", () => {
    // The floor, as in `links.test.ts`: a walk that stopped finding files would leave every
    // assertion below passing against nothing.
    expect(described.length).toBeGreaterThan(60);
  });

  it("every page has one", () => {
    expect(described.filter((page) => page.description === "").map((page) => page.page)).toEqual([]);
  });

  it("and none is long enough to be cut mid-sentence", () => {
    const overlong = described
      .filter((page) => page.description.length > 160)
      .map((page) => `${page.page} (${page.description.length})`);

    expect(overlong).toEqual([]);
  });
});
