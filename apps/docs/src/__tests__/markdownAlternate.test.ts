import { describe, expect, test } from "vitest";
import { headExtra } from "../entry-server";

/**
 * Every page says where its Markdown is. Found by the second trial: an agent opened the home page as
 * HTML, found no mention of `llms.txt` or the `.md` pages, and read them only after guessing the URL.
 */
describe("the Markdown version of a page", () => {
  test("is linked from the page's head, as an alternate", () => {
    expect(headExtra("/concepts/state", "State — Ramonda")).toContain(
      '<link rel="alternate" type="text/markdown" href="https://ramonda.dev/concepts/state.md">',
    );
    expect(headExtra("/", "Ramonda")).toContain('href="https://ramonda.dev/index.md"');
  });

  test("and the whole site's text is linked from every page", () => {
    expect(headExtra("/concepts/state", "State")).toContain('href="https://ramonda.dev/llms.txt"');
  });

  test("but not from a path that has no page", () => {
    expect(headExtra("/404", "Not found")).not.toContain("text/markdown");
  });
});
