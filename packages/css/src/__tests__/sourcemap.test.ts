import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { transformSync } from "esbuild";
import { describe, expect, test } from "vitest";
import { transform } from "../compiler/transform";

/**
 * Do the maps COMPOSE, and does the output still parse?
 *
 * Two maps sit between the browser and the author: ours, from the author's file to the transformed
 * one, and the bundler's, from there to the emitted JavaScript. A stack trace is only worth anything
 * if walking both lands on the line somebody wrote.
 *
 * **The risky part is not the block, it is everything after it.** The transform deletes a lot of text
 * and inserts a little, so every position downstream moves. A map that is right at the block and
 * drifts below it looks correct in a first test — which is why the checks below straddle it.
 */

const FILE = "Card.tsx";

const SOURCE = `import { Component } from "@ramonda/core";

export class Card extends Component<{ id: string }> {
  accent = "#10b981";

  render() {
    return (
      <div css=@@(
        display: flex;
        flex-direction: column;
        padding: 24px;
        background-color: #0f172a;
        border-left: {{this.accent}};
      )>
        <span>{this.id}</span>
      </div>
    );
  }

  afterTheBlock() {
    return this.accent.toUpperCase();
  }
}
`;

const result = transform(SOURCE, { filename: FILE });
if (result === undefined) throw new Error("the transform found no block");

const emitted = transformSync(result.code, {
  loader: "tsx",
  jsx: "automatic",
  jsxImportSource: "@ramonda/core",
  target: "es2022",
  sourcemap: true,
  sourcefile: "Card.intermediate.tsx",
});

const theirs = new TraceMap(JSON.parse(emitted.map));
const ours = new TraceMap(result.map as never);

/** Where a piece of emitted JavaScript came from, walked back through both maps. */
function home(needle: string): number | null {
  const lines = emitted.code.split("\n");
  const line = lines.findIndex((text) => text.includes(needle));
  if (line === -1) return null;

  const middle = originalPositionFor(theirs, { line: line + 1, column: lines[line].indexOf(needle) });
  if (middle.line === null) return null;

  return originalPositionFor(ours, { line: middle.line, column: middle.column ?? 0 }).line;
}

describe("a position in the emitted JavaScript walks home to the author's own line", () => {
  test.each([
    ["the class declaration", "class Card", 3],
    ["a field above the block", '"#10b981"', 4],
    ["the hole's expression", "this.accent", 13],
    ["a method BELOW the block", "afterTheBlock", 20],
    ["code below that again", "toUpperCase", 21],
  ])("%s", (_what, needle, line) => {
    expect(home(needle)).toBe(line);
  });

  /**
   * The hole is the one that fails if the block is overwritten in a single span, and it fails
   * quietly: measured while writing this, an expression on line 13 reported line 8, the block's
   * opening. Replacing only the gaps BETWEEN expressions is what fixes it, and this is what keeps it
   * fixed.
   */
  test("and the hole in particular is not reported at the block's opening line", () => {
    expect(home("this.accent")).not.toBe(8);
  });
});

describe("a column on a line the transform never touched", () => {
  /**
   * The check that decides the map's resolution, and the only one that separates the settings.
   *
   * Measured: every setting gets the LINE right, including inside an expression spanning four of
   * them — magic-string emits a mapping at each line start whatever it is told. `hires: false`
   * collapses every COLUMN to the start of its line, for the whole file rather than only near a
   * block, because this map sits above the bundler's. That is what this test refuses.
   */
  const SOURCE_WITH_CALLS = `export class Card {
  render() {
    const a = one(two(three()), four());
    return (<div css=@@( display: flex; )>x</div>);
  }
  after() { return alpha(beta(), gamma()); }
}
`;

  const only = transform(SOURCE_WITH_CALLS, { filename: FILE });
  if (only === undefined) throw new Error("the transform found no block");
  const map = new TraceMap(only.map as never);
  const outLines = only.code.split("\n");
  const sourceLines = SOURCE_WITH_CALLS.split("\n");

  test.each(["two(", "four(", "beta(", "gamma("])("%s lands on its own column", (needle) => {
    const generated = outLines.findIndex((text) => text.includes(needle));
    const home = originalPositionFor(map, { line: generated + 1, column: outLines[generated].indexOf(needle) });

    const line = sourceLines.findIndex((text) => text.includes(needle)) + 1;
    expect({ line: home.line, column: home.column }).toEqual({ line, column: sourceLines[line - 1].indexOf(needle) });
  });
});

describe("the transformed file", () => {
  test("is valid TSX, which is the only reason the second map exists at all", () => {
    expect(emitted.code).toContain("afterTheBlock");
    expect(emitted.code).toContain("_s0");
  });

  test("still contains the author's expression, unmoved and unquoted", () => {
    expect(result?.code).toContain("_s0(this.accent)");
  });
});
