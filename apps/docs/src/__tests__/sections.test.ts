// @vitest-environment node
// Walks `content/` off disk, like `links.test.ts` and `descriptions.test.ts` beside it.
import { readdirSync, statSync } from "node:fs";
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
