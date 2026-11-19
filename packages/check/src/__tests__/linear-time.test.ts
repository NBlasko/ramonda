// @vitest-environment node
// Writes a project to a temp directory and builds a real program over it, so it needs `node:fs`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { analyzeProject, arrangementsVisitedSoFar } from "../analyze";
import { cpuTime } from "./cpuTime";

/**
 * What a project's source holds, read in LINEAR time.
 *
 * Each case is the input a ReDoS checker (`recheck`) produced for one pattern here, grown to 40,000
 * characters, and each was MEASURED slow before its fix — two parts of a pattern that can both take
 * the same character try every way of sharing it. Asked as the DIFFERENCE from the same project with
 * a short value, because building the program is most of a run and is not what is being measured —
 * and as CPU, the fewest of three, each on a project of its own (see `cpuTime`).
 */
const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
const N = 40_000;

const projects: string[] = [];
afterEach(() => {
  for (const each of projects.splice(0)) rmSync(each, { recursive: true, force: true });
});

/** A project with one component rendering `markup`, against the framework stub the fixtures use. */
function project(markup: string): string {
  return projectOf(
    `import { Component } from "@ramonda/core";\n\nexport class Card extends Component {\n  go() {}\n  render() {\n    return (\n      <div>\n${markup}\n      </div>\n    );\n  }\n}\n`,
  );
}

/** A project whose one source file is `source`. */
function projectOf(source: string): string {
  const root = mkdtempSync(join(tmpdir(), "ramonda-check-linear-"));
  projects.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.tsx"), source);
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        jsxImportSource: FIXTURES,
        strict: false,
        skipLibCheck: true,
        noEmit: true,
        paths: { "@ramonda/core": [join(FIXTURES, "framework.ts")] },
      },
      include: ["src", join(FIXTURES, "framework.ts"), join(FIXTURES, "jsx-runtime.ts")],
    }),
  );
  return join(root, "tsconfig.json");
}

/**
 * The CPU the analyzer spends on a project rendering `markup`, the fewest of three — each round a
 * project of its own, written before the clock starts, so neither the disk nor a cached answer is in
 * what is timed.
 *
 * Measured on his Linux laptop (Ryzen 5 2500U), long minus short: at most 296 ms with both patterns as
 * they are, under coverage with four cores busy; with each pattern's quadratic form planted back, alone
 * and without coverage, 5,925 ms for the number and 2,459 ms for the directive. The 1,500 ms bound sits
 * between, and coverage only widens the planted side.
 */
const took = (markup: string) =>
  cpuTime(
    (round) => project(`${markup}\n        {/* round ${round} */}`),
    (tsconfig) => analyzeProject(tsconfig),
  );

describe("read in linear time", () => {
  test.each<[string, (long: boolean) => string]>([
    // `rules/aria-value.ts`: a number whose two runs of digits shared every digit.
    [
      "a number that never ends",
      (long) =>
        `        <div role="slider" aria-valuenow="0${long ? "00".repeat(N / 2) : "0"}!" aria-valuemin={0} aria-valuemax={9}>x</div>`,
    ],
    // `analyze.ts`: an ignore directive's reason, with spaces between its `*/` and a `}` both pattern
    // halves could take.
    [
      "a directive's reason with a long run of spaces",
      (long) =>
        `        {/* ramonda-check-ignore: why */${long ? " ".repeat(N) : " "}x}\n        <div onclick={this.go} role="button" tabindex={5}>x</div>`,
    ],
  ])("%s", (_what, markup) => {
    const short = took(markup(false));
    const long = took(markup(true));
    expect(long - short).toBeLessThan(1500);
  });
});

/**
 * The component tree walked in time that grows with its ARRANGEMENTS, not with its paths.
 *
 * A ladder: every rung mounts both components of the next, so `depth` rungs are 2^depth paths to the
 * bottom and only 2·depth arrangements. The context walk followed every path, and `apps/docs` — 368
 * components — took 9.5 s to check, 6.2 of them in that walk; in August, at 149 components, the whole
 * run was 0.68 s. Found measuring the MCP server's warm check. A build runs `ramonda-check` first, so
 * every build paid it.
 */
describe("the component tree, walked once per arrangement", () => {
  const ladder = (depth: number) => {
    const rung = (at: number) => (at === depth ? "<p />" : `<div><R${at + 1}a /><R${at + 1}b /></div>`);
    const classes = Array.from({ length: depth + 1 }, (_, at) =>
      ["a", "b"]
        .map(
          (side) => `export class R${at}${side} extends Component {\n  render() {\n    return ${rung(at)};\n  }\n}\n`,
        )
        .join(""),
    ).join("");
    return `import { Component, bootstrap } from "@ramonda/core";\n\n${classes}\nclass App extends Component {\n  render() {\n    return <div><R0a /><R0b /></div>;\n  }\n}\nbootstrap(<App />, null);\n`;
  };
  /**
   * Counted, not timed: the arrangements the walk visits. Timed, as the difference of two runs, it
   * failed under a loaded gate and passed alone. Measured: 2 rungs visit 7 arrangements and 22 visit
   * 47; walking every path instead of every arrangement, 15 and 16,777,215.
   */
  const visits = (depth: number) => {
    const tsconfig = projectOf(ladder(depth));
    const before = arrangementsVisitedSoFar();
    analyzeProject(tsconfig);
    return arrangementsVisitedSoFar() - before;
  };

  test("a ladder with 2^22 paths to its bottom costs about what one of two rungs does", () => {
    expect(visits(22) - visits(2)).toBeLessThan(100);
  });
});
