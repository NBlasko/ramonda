import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const found = () =>
  analyzeProject(join(here, "fixtures", "property-only-name", "tsconfig.json")).findings[
    "misspelled-element-property"
  ] ?? [];
const said = () => found().map((issue) => `${issue.line}:${issue.written}→${issue.meant}`);

/**
 * A name one capital away from the only spelling it has.
 *
 * A few pieces of element state live in a PROPERTY and have no attribute of that name at all. There
 * is no `playbackrate` content attribute for `playbackRate` to be the lowercase form OF, so the
 * name has exactly one spelling and anything else is a different name — which `putAttribute` then
 * writes into the document as an attribute nothing reads.
 *
 * The trap is that the types accept both. `RamondaArgs` has an arm keyed on `Lowercase<string>` so
 * that any real lowercase HTML attribute passes without being enumerated, and the wrong spelling
 * goes straight through it.
 */
describe("a property name written in a case the element does not have", () => {
  test("all three, each with the one spelling that works", () => {
    expect(said()).toEqual([
      "8:playbackrate→playbackRate",
      "10:currenttime→currentTime",
      "11:playbackrate→playbackRate",
    ]);
  });

  /**
   * Five silences, and the first three are the CORRECT spelling.
   *
   * 16, 17 and 18 are what core matches and sets, so reporting any of them would be reporting the
   * fix. 20 is a checkbox's third state, which core sets as a property too — it used to write a
   * dead attribute and no longer does, which is why the note about it in
   * `attribute-that-does-nothing` was withdrawn rather than turned into a rule.
   *
   * 23 is the case there is no wrong spelling of: `volume` is already lower case, so the name a
   * hurried author would type IS the name. 27 is `width`, a real attribute that only looks like
   * these — it is not in the table, and the table is the whole of what this rule knows.
   */
  test("the right spelling, and a name that is not one of these, stay silent", () => {
    const lines = found().map((issue) => issue.line);
    for (const quiet of [16, 17, 18, 20, 23, 27]) {
      expect(lines, `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });

  /**
   * The names come from the table core matches against, not from a copy.
   *
   * `@ramonda/dom-facts` says why in its own note — a list two packages consult is one list from
   * the beginning or it is two lists later — and this rule reads `propertyOnlyNames` from it. If
   * core ever gains a property-only name, this reports its misspelling the same day.
   */
  test("and it knows both media tags, not just the one the fixture leads with", () => {
    expect(found().map((issue) => issue.tag)).toContain("video");
    expect(found().map((issue) => issue.tag)).toContain("audio");
  });
});
