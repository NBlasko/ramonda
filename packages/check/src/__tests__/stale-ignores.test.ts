import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";
import { GRAPH_REPORTS } from "../graphReports";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "stale-ignores", "tsconfig.json"));

/**
 * A `ramonda-check-ignore` that silences nothing.
 *
 * An ignore is for a fault being fixed — ours, or the app's own until it fixes it — and never the way
 * to a valid design. So it has to go when the fault does. Left behind, it silences nothing today and
 * whatever is written on that line next, and it was never listed: the run prints only the ignores
 * that matched a report. The docs taught one over an empty backdrop, which no rule reports — the
 * lesson was an ignore for a design that is already supported.
 */
describe("an ignore that silences nothing", () => {
  test("is reported, in every comment form, with the reason it gives", () => {
    expect(run().staleIgnores.map((stale) => `${stale.line} ${stale.reason}`)).toEqual([
      "14 a backdrop, which is not reported in the first place",
      "18 left behind after the fix",
      "30 a line comment over nothing",
      "33 a block comment over nothing",
    ]);
  });

  test("one that silences a rule's report or an unresolved tag is not", () => {
    const { annotated, staleIgnores } = run();
    expect(annotated.map((site) => site.line)).toEqual([12, 21]);
    expect(staleIgnores.map((stale) => stale.line)).not.toContain(11);
    expect(staleIgnores.map((stale) => stale.line)).not.toContain(20);
  });

  test("the words inside a string or a template are not a directive", () => {
    const lines = run().staleIgnores.map((stale) => stale.line);
    expect(lines).not.toContain(23);
    expect(lines).not.toContain(24);
  });

  test("it fails the run, as a graph report", () => {
    expect(GRAPH_REPORTS.map((report) => report.id)).toContain("ignore-that-silences-nothing");
  });
});
