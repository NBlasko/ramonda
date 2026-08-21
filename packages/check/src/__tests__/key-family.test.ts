import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "key-family", "tsconfig.json"));

const linesOf = (issues: readonly { line: number }[]) => issues.map((issue) => issue.line);

/**
 * The three key rules, walked through `.claude/skills/writing-a-static-rule`.
 *
 * All three read the callback and the key where they are WRITTEN, and a list stops being written
 * that way the moment the row gets long enough to extract — which is the list most likely to have
 * the fault in it.
 */
describe("a key, and the callback around it, one name away", () => {
  /**
   * `rows.map(renderRow)` is the same list `rows.map((row) => …)` is, and the row inside the
   * extracted callback is the same row.
   *
   * Reported where the ROW is written, which is inside `renderRow` — so one report however many
   * lists hand it over, and the reader is sent to the `<tr>` that needs the key rather than to a
   * call site with no element on it.
   */
  test("a row callback kept in a `const` is still a row callback", () => {
    const found = run().findings["row-without-a-key"];

    // `renderRow` itself, then the two inline callbacks. `renderRow` is handed to a `.map` and to a
    // `list()`; the first call found decides which advice the one report gives.
    expect(linesOf(found)).toEqual([13, 24, 30]);
    expect(found.map((issue) => issue.via)).toEqual(["map", "map", "list"]);
  });

  /** The index reaches the key through a local as easily as it reaches it directly. */
  test("`index-as-key` reads the key through a local and through an extracted callback", () => {
    const found = run().findings["index-as-key"];

    // `renderIndexed` itself, then the three inline ones — the last through a local one line up.
    expect(linesOf(found)).toEqual([14, 44, 49, 55]);
    // The key AS WRITTEN, so the reader finds it on the line — never the local's own value.
    expect(found.map((issue) => issue.written)).toEqual(["i", "i", "`row-${i}`", "rowKey"]);
  });

  /** Two siblings claiming one key claim it whether the key is spelled out or named. */
  test("`duplicate-key-among-siblings` compares a key held in a `const`", () => {
    expect(linesOf(run().findings["duplicate-key-among-siblings"])).toEqual([69, 73]);
  });

  /** What must stay silent — a key that carries an identity, and a row that has one. */
  test("a key built from the row is not a position, and a row with a key is not reported", () => {
    const findings = run().findings;

    expect(linesOf(findings["index-as-key"])).not.toContain(62);
    expect(linesOf(findings["row-without-a-key"])).not.toContain(37);
  });
});
