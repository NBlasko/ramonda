import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "lens-gap");
const app = join(fixture, "app.ts");

const found = () => analyzeProject(join(fixture, "tsconfig.json")).findings["lens-path-through-a-gap"];

/**
 * Every function in the fixture, with the verdict its doc comment claims and the lines it spans.
 *
 * The fixture marks each case `✗` (must be reported) or `✓` (must be silent), and this reads those
 * marks rather than a list kept beside them. A case added to the fixture is therefore a case this
 * suite already asserts — which is the opposite of the arrangement where a fixture grows and the
 * test keeps checking the four shapes somebody wrote down once.
 */
function cases(): { name: string; reported: boolean; from: number; to: number }[] {
  const lines = readFileSync(app, "utf8").split("\n");
  const starts: { name: string; reported: boolean; from: number }[] = [];

  lines.forEach((line, index) => {
    const declaration = /^export function (\w+)/.exec(line);
    if (declaration === null) return;
    // The verdict is on the doc comment above, which may be one line or several.
    const above = lines.slice(Math.max(0, index - 14), index).join("\n");
    const lastMark = Math.max(above.lastIndexOf("✗"), above.lastIndexOf("✓"));
    starts.push({ name: declaration[1]!, reported: above[lastMark] === "✗", from: index + 1 });
  });

  return starts.map((each, index) => ({
    ...each,
    to: index + 1 < starts.length ? starts[index + 1]!.from - 1 : lines.length,
  }));
}

const caseAt = (line: number) => cases().find((each) => line >= each.from && line <= each.to)?.name;

describe("a lens path that walks through a value that may be missing", () => {
  /**
   * Only the LAST hop of a path creates what it names. Everything before it is walked, and the lens
   * refuses to invent an intermediate object — `RML001`, which now throws in development. So the
   * fault is a hop that may be `null` or `undefined` with more path after it.
   */
  test("what it reports: the path, how the annotation admits a gap, and what is past it", () => {
    expect(found().map((issue) => `${issue.path} | ${issue.admits} | .${issue.beyond}`)).toEqual([
      "state.profile | optional | .name",
      "state.settings | null | .theme",
      "state.account.owner.address | optional | .city",
      "state.settings | null | .layout",
      "state.profile | optional | .name",
      "state.profile.address | optional | .city",
      "state.settings.layout | optional | .columns",
      "state.profile | optional | .name",
    ]);
  });

  /**
   * The fixture's own marks are the expectation. This is the assertion that makes the fixture worth
   * having: a shape added there is judged here without a line being added to this file, in either
   * direction.
   */
  test("every case marked ✗ is reported, and every case marked ✓ is silent", () => {
    const reported = new Set(found().map((issue) => caseAt(issue.line)));
    const marked = cases();

    expect(marked.length).toBeGreaterThan(15);
    expect(marked.filter((each) => each.reported).map((each) => each.name)).toEqual(
      marked.filter((each) => reported.has(each.name)).map((each) => each.name),
    );
  });

  test("it points at the hop that may be missing, not at the chain or at the write", () => {
    const issue = found().find((each) => caseAt(each.line) === "renameThroughAnOptional");
    expect(issue?.file).toBe(app);
    const line = readFileSync(app, "utf8").split("\n")[issue!.line - 1]!;
    // The column is 1-based and lands on the `get` of the hop, whose argument is the key it names.
    expect(line.slice(issue!.column - 1)).toMatch(/^get\("profile"\)/);
  });

  /**
   * Two gaps on one path report once. There is one path and one fix; the second report would name
   * a hop that cannot be reached until the first is dealt with.
   */
  test("one path reports once, at the first gap along it", () => {
    const onTwoGaps = found().filter((issue) => caseAt(issue.line) === "columnsThroughTwoGaps");
    expect(onTwoGaps.map((issue) => issue.path)).toEqual(["state.settings"]);
  });

  /**
   * The four narrowing shapes `guard-walk` knows, each of which makes the write correct — and the
   * one that looks like a guard and is not.
   */
  test("a guard on the path silences it; a guard on another path does not", () => {
    const names = new Set(found().map((issue) => caseAt(issue.line)));
    for (const guarded of [
      "guardedByAnIf",
      "guardedByNotNull",
      "guardedByLooseNotNull",
      "guardedByAnEarlyReturn",
      "guardedByAnAnd",
      "guardedByATernary",
      "guardedByAnElse",
    ]) {
      expect(names).not.toContain(guarded);
    }
    expect(names).toContain("guardedByTheWrongPath");
  });

  /**
   * What it cannot read, it does not judge. This package's standing bar, and the reason this rule is
   * narrow: an array index, a computed key, a root with no written annotation, and a `focusOn` that
   * belongs to somebody else.
   */
  test("an unreadable path is silent rather than guessed at", () => {
    const names = new Set(found().map((issue) => caseAt(issue.line)));
    for (const quiet of [
      "throughAnArray",
      "throughAComputedKey",
      "throughAnInferredRoot",
      "throughOurOwnFocusOn",
      "throughPresentValues",
      "writeTheWholeProfile",
      "mergeTheWholeProfile",
    ]) {
      expect(names).not.toContain(quiet);
    }
  });
});
