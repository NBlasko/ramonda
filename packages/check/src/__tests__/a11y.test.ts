import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "a11y", "tsconfig.json"));

/**
 * The rules that read one JSX ELEMENT — the third family, and the one accessibility needs.
 *
 * They are asserted against one fixture that writes every shape they have an opinion about beside
 * every shape they must not, because that pairing is the whole test: a rule that reports the
 * missing `alt` and also reports `alt=""` has not found a fault, it has found images.
 */
describe("accessibility rules over JSX elements", () => {
  test("an image with nothing to announce it is reported, and a described one is not", () => {
    const found = run().findings["unnamed-image"];
    // `img`, the image `input`, the empty `object`, and `area`. Everything else in the fixture
    // answers the question one way or another.
    expect(found.map((issue) => issue.tag)).toEqual(["img", "input", "object", "area"]);
  });

  /**
   * The silence contract, which for this family is one flag rather than forty checks.
   *
   * `<img {...rest} />` may carry the `alt` — nothing static can say whether it does — so a
   * spreading element is handed to no rule at all. Asserted here rather than trusted, because it
   * is the difference between a checker people run and one they switch off.
   */
  test("an element that spreads props is left alone", () => {
    // The fixture writes SEVEN `img` tags and exactly one of them is reported. A leaked spread
    // would make it two, which is what counting says and a line number would not.
    const found = run().findings["unnamed-image"];
    expect(found.filter((issue) => issue.tag === "img")).toHaveLength(1);
  });

  test("an empty heading and an empty link are reported, and a named one is not", () => {
    const found = run().findings["empty-heading-or-link"];
    expect(found.map((issue) => `${issue.kind}:${issue.tag}`)).toEqual(["heading:h2", "link:a"]);
  });

  /**
   * `<h4>{title}</h4>` might well have text, and nothing here can prove it does not. Reporting it
   * would be reporting the commonest correct line in any app.
   */
  test("content this cannot read is not called empty", () => {
    const found = run().findings["empty-heading-or-link"];
    expect(found.some((issue) => issue.tag === "h4")).toBe(false);
  });

  test("a frame with no name is reported", () => {
    expect(run().findings["unnamed-frame"]).toHaveLength(1);
  });

  test("only a POSITIVE tabIndex is reported", () => {
    const found = run().findings["positive-tabindex"];
    expect(found.map((issue) => issue.value)).toEqual([1]);
  });

  /**
   * None of the four fails a build yet — the repository's rule for a new rule, and the README's
   * argument: one version that says so, the next that refuses.
   */
  test("none of them fails the run", () => {
    const result = run();
    for (const id of ["unnamed-image", "empty-heading-or-link", "unnamed-frame", "positive-tabindex"] as const) {
      expect(result.findings[id].length, id).toBeGreaterThan(0);
    }
    expect(result.issues).toEqual([]);
  });
});
