import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const found = () =>
  analyzeProject(join(here, "fixtures", "one-main", "tsconfig.json")).findings["more-than-one-main"] ?? [];
const said = () => found().map((issue) => `${issue.line}:${issue.from}/first@${issue.firstAtLine}`);

/**
 * Two `main` landmarks in one render, where HTML allows one.
 *
 * `main` is the one landmark with that constraint, and it has it because it is a DESTINATION rather
 * than a description: "skip to main content" is the first thing a keyboard reader presses, and a
 * screen reader's landmark list is how somebody moves around a page without scrolling through it.
 * With two, that destination is ambiguous, tools resolve it differently, and whichever is picked
 * half the page is somewhere the reader has to find by hand.
 *
 * `ProjectRule`'s own note names this exact case as the reason the project subject may claim only
 * negative existence — "two pages may each have a `main`, and they are never in one document
 * together" — so the bound here is one RENDER, the same one `duplicate-id` takes.
 */
describe("more than one main landmark", () => {
  test("two in one render, and only the SECOND is reported", () => {
    // Reporting both would say the page has two faults where it has one, and the first is the one
    // a reader almost certainly meant. The report names where the first is, so the two can be
    // compared without hunting.
    expect(said()).toContain("14:the tag/first@13");
  });

  test('`role="main"` counts, because the accessibility tree does not care which spelling was used', () => {
    // The commonest shape of it: a layout component owning a `<main>` and a page component adding a
    // role to its own wrapper, neither author seeing the other's.
    expect(said()).toContain("27:role/first@26");
  });

  test("`hidden={false}` says out loud that it is shown, so it excuses nothing", () => {
    // `hidden` is the specification's own escape and is honoured — but written FALSE is the source
    // settling the question the other way, which is the same three answers a written attribute has
    // everywhere here.
    expect(said()).toContain("61:the tag/first@60");
  });

  test("the whole list, so a regression cannot go quiet", () => {
    expect(said()).toEqual(["14:the tag/first@13", "27:role/first@26", "61:the tag/first@60"]);
  });

  /**
   * Six silences, and each is a different reason a page really has one landmark.
   *
   * 37 puts one in each arm of a ternary, which is one on the page — that is what `alwaysPresent`
   * is computed for. 48 is `hidden`, the specification's own escape. 74 spreads, and the spread may
   * be carrying the `hidden` that settles it. 87 has a `role` this cannot read, which may be
   * anything including one that is not a landmark. 100 is a single `main` nested two elements deep.
   * 111 is a SECOND RENDER — a different route view, never on the page at the same time.
   */
  test("every render that really has one landmark stays silent", () => {
    const lines = found().map((issue) => issue.line);
    for (const quiet of [37, 48, 74, 87, 100, 111]) {
      expect(lines, `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });
});
