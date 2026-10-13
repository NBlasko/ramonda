import { pages } from "./routes";

/**
 * Sidebar entries grouped by their frontmatter `section`.
 *
 * A page may opt out with `nav: false`, and 158 of them do — the generated rules and diagnostics.
 * They are reached from their index, from a report that named one, or from search; nobody scrolls a
 * list of 158 names looking for `RMD047`. Measured while they were still listed: the sidebar was
 * **83% of every page's HTML**, repeated across all 252 pages.
 */
export const grouped = (() => {
  const groups = new Map<string, (typeof pages)[number][]>();
  for (const page of pages) {
    // `in` rather than a property read: `pages` is `as const`, so the union's members only carry
    // the keys they were written with, and most were written without this one.
    if ("nav" in page && page.nav === false) continue;
    const key = page.section || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(page);
  }
  return [...groups.entries()];
})();

/** Every page the sidebar lists, in the order it lists them. */
const inOrder = grouped.flatMap(([, items]) => items);

/**
 * The pages either side of this one, read off the sidebar — the same list, so "next" at the foot
 * of a page is the entry below it on the left. A page the sidebar does not list has neither: it is
 * reached from an index, and the index is where a reader goes back to.
 */
export function neighbours(path: string): { previous?: (typeof pages)[number]; next?: (typeof pages)[number] } {
  const at = inOrder.findIndex((page) => page.path === path);
  if (at === -1) return {};
  return {
    ...(at > 0 ? { previous: inOrder[at - 1] } : {}),
    ...(at < inOrder.length - 1 ? { next: inOrder[at + 1] } : {}),
  };
}

/** Where a page's source is edited, in front of its path from the repository root. */
export const EDIT_BASE = "https://github.com/NBlasko/ramonda/edit/main/";
