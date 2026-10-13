// @vitest-environment node
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pages } from "../generated/content";
import { EDIT_BASE, grouped, neighbours } from "../navigation";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/**
 * The page before and after this one, which is the sidebar read in order — the same list, so the
 * two cannot disagree about what comes next.
 */
describe("the pages either side", () => {
  const order = grouped.flatMap(([, items]) => items);

  it("are the sidebar's own order, end to end", () => {
    expect(order.length).toBeGreaterThan(100);
    for (const [index, page] of order.entries()) {
      const { previous, next } = neighbours(page.path);
      expect(previous?.path).toBe(order[index - 1]?.path);
      expect(next?.path).toBe(order[index + 1]?.path);
    }
  });

  it("are nothing for a page the sidebar does not list", () => {
    const hidden = pages.find((page) => "nav" in page && page.nav === false);

    expect(hidden).toBeDefined();
    expect(neighbours(hidden?.path ?? "")).toEqual({});
  });
});

/** "Edit this page" names a file, and a file that is not there is a link that 404s on GitHub. */
describe("editing a page", () => {
  it("points every page written in a file at that file", () => {
    const withSource = pages.filter((page) => "source" in page);
    const missing = withSource.filter((page) => !existsSync(join(repo, page.source))).map((page) => page.path);

    expect(withSource.length).toBeGreaterThan(100);
    expect(missing).toEqual([]);
    expect(EDIT_BASE).toBe("https://github.com/NBlasko/ramonda/edit/main/");
  });

  it("is offered on every page the sidebar lists, but the one generated from the rules", () => {
    const without = pages
      .filter((page) => !("nav" in page && page.nav === false) && !("source" in page))
      .map((page) => page.path);

    expect(without).toEqual(["/rules"]);
  });
});
