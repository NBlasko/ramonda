import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const found = () =>
  analyzeProject(join(here, "fixtures", "role-fights-tag", "tsconfig.json")).findings["role-that-fights-the-tag"] ?? [];
const said = () => found().map((issue) => `${issue.line}:${issue.tag}/${issue.loses}`);

/**
 * A `role` that tells a reader the element behaves in a way it does not.
 *
 * `<a href="/pricing" role="button">` and `<button role="link">` are opposite halves of one mistake:
 * the element KEEPS its behaviour and changes only what is announced about it.
 *
 * A link announced as a button loses Space — a button activates on it, and on a link it is the
 * browser's scroll shortcut, so the page jumps and nothing happens — and it leaves the list of LINKS
 * a screen reader offers. A button announced as a link gains an expectation of a destination: a URL
 * in the status bar, a middle click, "copy link address", none of which exist and none of which
 * fail loudly.
 *
 * Both are invisible to anybody using a mouse, and both survive review because the page behaves
 * exactly as intended for the person testing it.
 */
describe("a role that fights what the tag does", () => {
  test("both directions, each saying what the reader loses", () => {
    // 75 has the spread BEFORE the role, so nothing can reach over it.
    expect(said()).toEqual(["13:a/space", "23:button/destination", "75:a/space"]);
  });

  /**
   * The anchor with no real destination is NOT this, and that boundary is the rule's own.
   *
   * `<a role="button">` and `<a href="#" role="button">` are somebody building a button out of an
   * anchor — a different conversation, and `link-without-a-destination`'s. So is an `href` this
   * cannot READ: the first draft of this rule reported that one, on the argument that writing
   * `href={where}` means the author has a destination. Planted, it does not hold — `where` may
   * perfectly well be `"#"` — and the silence contract wins, as it does everywhere else here.
   */
  test("an anchor with no destination, readable or not, belongs to the other rule", () => {
    const lines = found().map((issue) => issue.line);
    for (const quiet of [18, 36, 39]) {
      expect(lines, `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });

  test("a role that agrees, or is neither, stays silent", () => {
    /**
     * 44 and 47 agree with their tags. 52 and 55 are neither of the two — `menuitem` on an anchor
     * is the documented menu pattern, and a `tab` is a tab. 60 has a role this cannot READ and 65 a
     * fallback CHAIN, where which role wins is not asked here. 70 spreads after the role.
     */
    const lines = found().map((issue) => issue.line);
    for (const quiet of [28, 29, 44, 47, 52, 55, 60, 65, 70]) {
      expect(lines, `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });
});
