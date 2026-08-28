import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";
import { RULES } from "../rules/index";

const here = dirname(fileURLToPath(import.meta.url));
const found = () =>
  analyzeProject(join(here, "fixtures", "removed-elements", "tsconfig.json")).findings["element-html-removed"] ?? [];

/**
 * Tags HTML removed, which every browser still renders.
 *
 * They are not typos. Each was a real element once, each still parses, and most still paint
 * something — which is why they survive in a codebase: nothing breaks, so nothing draws attention.
 * What they no longer have is a specification saying what they MEAN, so an accessibility tree has
 * nothing to map them to.
 */
describe("a tag HTML no longer has", () => {
  test("every one in the table, and nothing that replaced them", () => {
    expect(found().map((issue) => issue.tag)).toEqual([
      "marquee",
      "blink",
      "center",
      "font",
      "big",
      "strike",
      "tt",
      "acronym",
      "nobr",
      // No spread makes a removed tag into a current one, so the guard is not taken.
      "marquee",
    ]);
  });

  /**
   * Two of them are worse than obsolete, and the report has to say which.
   *
   * `<marquee>` and `<blink>` MOVE, and moving content that cannot be paused fails WCAG 2.2.2
   * outright — a reader who needs time on a line cannot get it, and for some people motion is a
   * vestibular trigger. That is a different sentence from "this was tidied out of the standard".
   */
  test("the two that move are named as a failure, not as tidying", () => {
    const rule = RULES.find((r) => r.id === "element-html-removed");
    const printed = found().map((issue) => (rule?.report.lines(issue as never) ?? []).join(" "));

    expect(printed.filter((line) => line.includes("WCAG 2.2.2"))).toHaveLength(3);
    expect(printed.some((line) => line.includes("<blink> moves"))).toBe(true);
    expect(printed.some((line) => line.includes("<center> was removed from HTML"))).toBe(true);
  });

  /** Each carries a replacement rather than a correction, because each WAS the right name once. */
  test("and each says what to write instead", () => {
    expect(found().every((issue) => issue.instead.length > 0)).toBe(true);
    expect(found().find((issue) => issue.tag === "acronym")?.instead).toContain("`<abbr>`");
  });
});
