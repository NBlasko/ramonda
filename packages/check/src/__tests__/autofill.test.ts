import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const found = () =>
  analyzeProject(join(here, "fixtures", "autofill", "tsconfig.json")).findings["autocomplete-that-fills-nothing"] ?? [];
const said = () => found().map((issue) => `${issue.line}:${issue.token}${issue.onlyAModifier ? "*" : ""}`);

/**
 * An `autocomplete` value nothing recognises.
 *
 * A browser matches it against the HTML specification's list of autofill field names and against
 * nothing else. A token that is not on it is not a near miss the browser corrects — the whole value
 * is ignored and the field never fills, with valid markup, the attribute in the DOM, and nothing
 * logged anywhere. The only symptom is a form that does not fill, which reads as the browser being
 * unhelpful rather than as a typo in the source.
 */
describe("an autocomplete value that fills nothing", () => {
  test("the near misses that read as deliberate", () => {
    // `fullname` for `name`, `zip` for `postal-code`, `phone` for `tel` — and each is one edit away
    // from a value that works, which is what makes them survive review.
    expect(said()).toContain("13:fullname");
    expect(said()).toContain("16:zip");
    expect(said()).toContain("17:phone");
  });

  test("a group word alone is named as such, because it is the commonest near miss", () => {
    // `shipping`, `billing` and the contact words say WHICH address or number and are not fields.
    // The report says so in its own sentence rather than printing "nothing recognises `billing`".
    expect(said()).toContain("20:billing*");
  });

  test("a `<select>` and a `<textarea>` fill too, and the value is followed one hop", () => {
    expect(said()).toContain("26:creditcard");
    expect(said()).toContain("27:streetaddress");
    // 23 is `autocomplete={ZIP}` with `const ZIP = "zipcode"`.
    expect(said()).toContain("23:zipcode");
  });

  test("the whole list, so a regression cannot go quiet", () => {
    // 56 has the spread BEFORE the attribute, so nothing can reach over it. 66 is the value written
    // in a `@Host` props bag, which configures a real element.
    expect(said()).toEqual([
      "13:fullname",
      "16:zip",
      "17:phone",
      "20:billing*",
      "23:zipcode",
      "26:creditcard",
      "27:streetaddress",
      "56:fullname",
      "66:fullname",
    ]);
  });

  /**
   * Thirteen silences, and the grammar is most of them.
   *
   * 30–32 are real field names. 35–36 put a group word in FRONT of a field, which is where it
   * belongs. 39 is a `section-` prefix with a group word and a field, and 40 a trailing `webauthn`
   * — both allowed by the specification's grammar and both a value that fills. 43–44 are the two
   * switches, which are the whole value. 47 cannot be read and 50 is empty, so neither is judged.
   * 53 has a spread AFTER the attribute, which may replace it. 59 is a `<div>`, which no browser
   * fills — `autocomplete` there is a different rule's business.
   */
  test("every value that fills, or might, stays silent", () => {
    const lines = found().map((issue) => issue.line);
    for (const quiet of [30, 31, 32, 35, 36, 39, 40, 43, 44, 47, 50, 53, 59]) {
      expect(lines, `line ${quiet} should be silent`).not.toContain(quiet);
    }
  });
});
