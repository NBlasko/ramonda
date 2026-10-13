// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const generated = (name: string) => readFileSync(join(here, "..", "generated", "pages", `${name}.ts`), "utf8");

/**
 * `diagnostics.md` is one file and many pages: an index, and a page per code. Everything that is
 * not a code — the introduction, "Capturing them" — belongs on the index.
 *
 * It was not there. The page's own title, `# Diagnostics`, was read as the first FAMILY heading,
 * and the text under a family heading goes nowhere — so the index was a title and lists of codes, and the
 * section that documents the record a collector receives was on no page at all. Two pages link to
 * it by anchor; both links landed on nothing.
 */
describe("the diagnostics index", () => {
  const index = generated("reference-diagnostics");

  it("carries the introduction and how to capture a diagnostic", () => {
    expect(index).toContain("Capturing them");
    expect(index).toContain('"id":"capturing-them"');
    expect(index).toContain("A code is stable forever and never reused.");
  });

  /**
   * In the one file, a code links to another by its heading's anchor — `#rmd048-…` — which is the
   * natural thing to write and which stopped working when each code became a page: forty-odd links
   * pointed at an anchor on the page they were already on. A same-page anchor is moved to where its
   * heading went.
   */
  it("leaves no link pointing at an anchor that stayed in the one file", () => {
    const pages = readdirSync(join(here, "..", "generated", "pages")).filter((name) =>
      name.startsWith("reference-diagnostics"),
    );
    const sameFile = pages.filter((name) => generated(name.replace(/\.ts$/, "")).includes('"href":"#'));

    expect(pages.length).toBeGreaterThan(50);
    expect(sameFile).toEqual([]);
  });
});
