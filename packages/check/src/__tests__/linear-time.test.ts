// @vitest-environment node
// Writes a project to a temp directory and builds a real program over it, so it needs `node:fs`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { analyzeProject } from "../analyze";

/**
 * What a project's source holds, read in LINEAR time.
 *
 * Each case is the input a ReDoS checker (`recheck`) produced for one pattern here, grown to 40,000
 * characters, and each was MEASURED slow before its fix — two parts of a pattern that can both take
 * the same character try every way of sharing it. Asked as the DIFFERENCE from the same project with
 * a short value, because building the program is most of a run and is not what is being measured.
 */
const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
const N = 40_000;

const projects: string[] = [];
afterEach(() => {
  for (const each of projects.splice(0)) rmSync(each, { recursive: true, force: true });
});

/** A project with one component rendering `markup`, against the framework stub the fixtures use. */
function project(markup: string): string {
  const root = mkdtempSync(join(tmpdir(), "ramonda-check-linear-"));
  projects.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "src", "app.tsx"),
    `import { Component } from "@ramonda/core";\n\nexport class Card extends Component {\n  go() {}\n  render() {\n    return (\n      <div>\n${markup}\n      </div>\n    );\n  }\n}\n`,
  );
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

const took = (markup: string) => {
  const tsconfig = project(markup);
  const started = performance.now();
  analyzeProject(tsconfig);
  return performance.now() - started;
};

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
    expect(long - short).toBeLessThan(500);
  });
});
