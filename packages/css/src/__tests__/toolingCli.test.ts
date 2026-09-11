import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterEach, describe, expect, test } from "vitest";
import { biomeFormatter, oxlintLinter } from "../tools";
import { builtFromThisSource } from "./built";

/** This file runs the BUILD, so a stale `dist` would measure a previous version — see `built.ts`. */
beforeAll(builtFromThisSource);

/**
 * The format and lint wrappers, driving the REAL tools.
 *
 * `tooling.test.ts` covers the placeholder in isolation and is fast. This is the half that can be
 * wrong in a way no unit test sees: whether biome and oxlint actually accept what they are handed,
 * and whether they still apply the PROJECT's own configuration when they do.
 *
 * That second question is the one that decides whether a wrapper is worth having. A wrapper that
 * quietly lost a project's rules would look like a clean run.
 */

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO = resolve(PACKAGE, "..", "..");
const BIN = join(PACKAGE, "bin.mjs");

const projects: string[] = [];
afterEach(() => {
  for (const each of projects.splice(0)) rmSync(each, { recursive: true, force: true });
});

/**
 * A project with its own biome and oxlint settings, linked to the ones in the store.
 *
 * Its own settings on purpose: a run that happened to agree with this repository's would prove
 * nothing about whether the project's were read.
 */
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ramonda-css-tooling-"));
  projects.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, "src", name), text);

  /**
   * The whole of `node_modules`, not the two `.bin` shims.
   *
   * Found by linking the shims alone: each is a small script that resolves its own package RELATIVE
   * TO ITSELF, so a symlink somewhere else cannot find it. A real project has the tree, and so does
   * this one.
   */
  execFileSync("ln", ["-s", join(REPO, "node_modules"), join(root, "node_modules")]);

  // Four spaces and a narrow line, so a run that used this repository's two-space settings is
  // visibly wrong rather than accidentally right.
  writeFileSync(
    join(root, "biome.json"),
    JSON.stringify({
      $schema: "https://biomejs.dev/schemas/2.4.5/schema.json",
      formatter: { enabled: true, indentStyle: "space", indentWidth: 4, lineWidth: 60 },
      linter: { enabled: false },
    }),
  );
  writeFileSync(join(root, ".oxlintrc.json"), JSON.stringify({ rules: { "no-debugger": "error" } }));

  return root;
}

function run(root: string, args: string[]): { output: string; status: number } {
  try {
    const output = execFileSync(process.execPath, [BIN, ...args], { cwd: root, encoding: "utf8" });
    return { output, status: 0 };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; status?: number };
    return { output: `${failed.stdout ?? ""}${failed.stderr ?? ""}`, status: failed.status ?? -1 };
  }
}

const STYLED = `export const Card = (props: { id: string }) => {
  return (
    <div css=@@(
      display: flex;
      border-left: {props.id};
    )>
      <span>{props.id}</span>
    </div>
  );
};
`;

describe("format", () => {
  test("a file with a block is formatted, and the block comes back", () => {
    const root = project({ "Card.tsx": `const   a =    1;\n${STYLED}` });

    const { status } = run(root, ["format", "src/Card.tsx"]);
    const out = readFileSync(join(root, "src", "Card.tsx"), "utf8");

    expect(status).toBe(0);
    // The formatter did its work…
    expect(out).toContain("const a = 1;");
    // …and the block is still the author's own text, unreformatted.
    expect(out).toContain("display: flex;");
    expect(out).toContain("border-left: {props.id};");
    expect(out).toContain("css=@@(");
  });

  /**
   * The question that decides whether this is worth having. The project asks for four spaces; this
   * repository asks for two. A wrapper that lost the project's settings would answer with two.
   */
  test("with the PROJECT's own settings, not this repository's", () => {
    const root = project({ "Card.tsx": `export function f() {\nreturn 1;\n}\n${STYLED}` });

    run(root, ["format", "src/Card.tsx"]);
    const out = readFileSync(join(root, "src", "Card.tsx"), "utf8");

    // The whole LINE, not a substring of it: `"    return 1;"` contains `"  return 1;"`, so a
    // `not.toContain` on the narrower one can never pass and would assert nothing.
    const line = out.split("\n").find((text) => text.includes("return 1;"));
    expect(line).toBe("    return 1;");
  });

  test("a file with no block goes through the same call and is formatted too", () => {
    const root = project({ "Plain.ts": `export const   a =    1;\n` });

    run(root, ["format", "src/Plain.ts"]);

    expect(readFileSync(join(root, "src", "Plain.ts"), "utf8")).toBe("export const a = 1;\n");
  });

  test("`--check` reports and writes nothing", () => {
    const root = project({ "Card.tsx": `const   a =    1;\n${STYLED}` });
    const before = readFileSync(join(root, "src", "Card.tsx"), "utf8");

    const { output, status } = run(root, ["format", "--check", "src/Card.tsx"]);

    expect(status).toBe(1);
    expect(output).toContain("are not formatted");
    expect(readFileSync(join(root, "src", "Card.tsx"), "utf8")).toBe(before);
  });

  test("and a file already formatted is left exactly as it is", () => {
    const root = project({ "Card.tsx": STYLED });

    run(root, ["format", "src/Card.tsx"]);
    const { status } = run(root, ["format", "--check", "src/Card.tsx"]);

    expect(status).toBe(0);
  });

  /**
   * What it SAYS when there was nothing to do, and the two modes cannot say the same thing.
   *
   * Measured on this repository's own gate: `format:check` printed *2 file(s) formatted* having
   * written to neither. A tool that reports work it did not do is a tool nobody can read a log of.
   */
  test("`--check` with nothing to do does not claim to have formatted anything", () => {
    const root = project({ "Card.tsx": STYLED });
    run(root, ["format", "src/Card.tsx"]);

    const { output } = run(root, ["format", "--check", "src/Card.tsx"]);

    expect(output).toContain("already formatted");
    expect(output).not.toContain("file(s) formatted");
  });

  test("and a write with nothing to do says that instead", () => {
    const root = project({ "Card.tsx": STYLED });
    run(root, ["format", "src/Card.tsx"]);

    const { output } = run(root, ["format", "src/Card.tsx"]);

    expect(output).toContain("nothing to rewrite");
  });

  /**
   * The one that would never settle. A formatter may have chosen tabs, and a block re-laid with
   * spaces inside a tabbed file is a file the formatter disagrees with on the next run.
   */
  test("a tabbed project gets a tabbed block", () => {
    const root = project({ "Card.tsx": STYLED });
    writeFileSync(
      join(root, "biome.json"),
      JSON.stringify({
        $schema: "https://biomejs.dev/schemas/2.4.5/schema.json",
        formatter: { enabled: true, indentStyle: "tab" },
        linter: { enabled: false },
      }),
    );

    run(root, ["format", "src/Card.tsx"]);
    const out = readFileSync(join(root, "src", "Card.tsx"), "utf8");

    expect(out).toContain("\t\t\tdisplay: flex;");
    expect(run(root, ["format", "--check", "src/Card.tsx"]).status).toBe(0);
  });
});

describe("lint", () => {
  test("a fault in a file with a block is reported at the author's own line", () => {
    const root = project({ "Card.tsx": `export function f() {\n  debugger;\n}\n${STYLED}` });

    const { output, status } = run(root, ["lint", "src/Card.tsx"]);

    expect(status).toBe(1);
    expect(output).toContain("src/Card.tsx:2:");
    expect(output).toContain("debugger");
  });

  /**
   * Below the block, which is where a line count goes wrong. The virtual file is line for line with
   * the author's, so a fault after a multi-line block still names its own line.
   */
  test("and one BELOW the block is not shifted by it", () => {
    const root = project({ "Card.tsx": `${STYLED}\nexport function after() {\n  debugger;\n}\n` });
    const source = readFileSync(join(root, "src", "Card.tsx"), "utf8");
    const line = source.split("\n").findIndex((text) => text.includes("debugger")) + 1;

    const { output } = run(root, ["lint", "src/Card.tsx"]);

    expect(line).toBeGreaterThan(10);
    expect(output).toContain(`src/Card.tsx:${line}:`);
  });

  test("a file with a block and nothing wrong is clean", () => {
    const root = project({ "Card.tsx": STYLED });

    const { status, output } = run(root, ["lint", "src/Card.tsx"]);

    expect(status).toBe(0);
    expect(output).toContain("lint clean");
  });

  test("a file with no block is linted as it is", () => {
    const root = project({ "Plain.ts": `export function f() {\n  debugger;\n}\n` });

    const { output, status } = run(root, ["lint", "src/Plain.ts"]);

    expect(status).toBe(1);
    expect(output).toContain("src/Plain.ts:2:");
  });

  /**
   * The scaffolding the virtual file added is not the author's, so nothing about it is shown. The
   * control is the test above: the same run does report a real fault, so silence here is a choice
   * rather than a broken wrapper.
   */
  test("nothing the virtual file put there is reported", () => {
    const root = project({ "Card.tsx": STYLED });
    writeFileSync(join(root, ".oxlintrc.json"), JSON.stringify({ rules: { "no-unused-vars": "error" } }));

    expect(run(root, ["lint", "src/Card.tsx"]).status).toBe(0);
  });
});

describe("when the tool itself says no", () => {
  /**
   * A formatter can fail for reasons that have nothing to do with a style block — a version that is
   * not installed, a platform binary that will not run. What a reader needs then is the tool's own
   * sentence, and a wrapper answering with its own call stack has hidden it.
   *
   * **A broken `biome.json` is NOT such a reason, which had to be measured.** Biome reads its config
   * only where it can and formats with its defaults otherwise — the same text came back and the run
   * exited 0. So the claim is asked of a tool that really does refuse, in the place a project keeps
   * its binaries.
   */
  test("its own words come out, not a stack trace of ours", () => {
    const root = project({ "Card.tsx": STYLED });

    // `toolIn` looks in `node_modules/.bin`, and this project's is a link to the repository's tree.
    // A directory of its own, swapped in, is how a stub gets there without touching that.
    const own = join(root, "stub", ".bin");
    mkdirSync(own, { recursive: true });
    writeFileSync(join(own, "biome"), `#!/bin/sh\necho "the formatter's own sentence" >&2\nexit 2\n`, {
      mode: 0o755,
    });
    execFileSync("rm", [join(root, "node_modules")]);
    execFileSync("mv", [join(root, "stub"), join(root, "node_modules")]);

    const { output, status } = run(root, ["format", "src/Card.tsx"]);

    expect(status).toBe(1);
    expect(output).toContain("refused");
    expect(output).toContain("the formatter's own sentence");
    expect(output).not.toContain("at formatFile");
  });

  /**
   * **AND THE LINTER SAID THE FILE WAS CLEAN.**
   *
   * `oxlintLinter` reads its report off the failure, because oxlint exits non-zero when it finds
   * something — an exit code is the answer there, not an error. But the catch reads `stdout` and
   * hands whatever it finds to `readReport`, which answers `[]` for anything it cannot parse. So a
   * linter that crashed, that printed why it could not run, or that was not there at all came back
   * as no findings, and `ramonda-css lint` printed *N file(s) lint clean* and exited 0.
   *
   * The file's own note already names this shape — it is the reason `maxBuffer` was raised: "a
   * truncated report is unparsable JSON, which is no findings, which is a file that lints CLEAN".
   * The buffer was fixed and the error path was not, and the two halves of one command disagreed
   * about it: the formatter throws on the same binary.
   *
   * A report is evidence; the absence of one is not evidence of a clean file.
   */
  test("a linter that fails is not a file that lints clean", () => {
    const root = project({ "Card.tsx": STYLED });

    const own = join(root, "stub", ".bin");
    mkdirSync(own, { recursive: true });
    writeFileSync(join(own, "oxlint"), `#!/bin/sh\necho "oxlint: cannot read .oxlintrc.json" >&2\nexit 1\n`, {
      mode: 0o755,
    });
    execFileSync("rm", [join(root, "node_modules")]);
    execFileSync("mv", [join(root, "stub"), join(root, "node_modules")]);

    const { output, status } = run(root, ["lint", "src/Card.tsx"]);

    expect(status).toBe(1);
    expect(output).not.toContain("lint clean");
    expect(output).toContain("cannot read .oxlintrc.json");
  });

  /** And one that says nothing at all is still not a pass. */
  test("nor is one that fails silently", () => {
    const root = project({ "Card.tsx": STYLED });

    const own = join(root, "stub", ".bin");
    mkdirSync(own, { recursive: true });
    writeFileSync(join(own, "oxlint"), `#!/bin/sh\nexit 101\n`, { mode: 0o755 });
    execFileSync("rm", [join(root, "node_modules")]);
    execFileSync("mv", [join(root, "stub"), join(root, "node_modules")]);

    const { output, status } = run(root, ["lint", "src/Card.tsx"]);

    expect(status).toBe(1);
    expect(output).not.toContain("lint clean");
  });
});

describe("what the wrapper refuses to guess", () => {
  test("a tool that is not installed is said plainly, not worked around", () => {
    const root = mkdtempSync(join(tmpdir(), "ramonda-css-tooling-"));
    projects.push(root);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");

    const { output, status } = run(root, ["format", "src/a.ts"]);

    expect(status).toBe(1);
    expect(output).toContain("is not installed here");
  });
});

/**
 * Output bigger than a pipe's default buffer, which is a megabyte.
 *
 * `execFileSync` stops at `maxBuffer` and throws, and both tools can pass it: biome answers with the
 * whole FORMATTED FILE on stdout, so a large generated source is enough on its own, and a long
 * enough lint report is JSON of the same order. Measured with the real biome before this was fixed —
 * a 1.87 MB file (60,000 lines) failed, and the "error" printed was a megabyte of the author's own
 * source, truncated mid-line.
 *
 * The linter's shape is worse and is why this is not merely a message problem: it reads its report
 * off the failure, so a truncated one is unparsable JSON, which is no findings, which is **a file
 * that lints clean**.
 *
 * A stand-in binary rather than a two-million-line fixture: what is under test is the buffer, and a
 * program that prints is the cheapest way to fill one.
 */
describe("a tool that says more than a megabyte", () => {
  /** An executable that ignores its arguments and prints `bytes` of output. */
  function printer(bytes: number, out: "stdout" | "stderr" = "stdout"): string {
    const root = mkdtempSync(join(tmpdir(), "ramonda-css-big-"));
    projects.push(root);
    const path = join(root, "printer.mjs");
    writeFileSync(path, `#!/usr/bin/env node\nprocess.${out}.write("x".repeat(${bytes}));\n`);
    execFileSync("chmod", ["+x", path]);
    return path;
  }

  test("the formatter reads all of it", () => {
    const format = biomeFormatter(printer(2_000_000), REPO);

    expect(format("const a = 1;\n", join(REPO, "Probe.tsx"))).toHaveLength(2_000_000);
  });

  test("and the linter does not come back clean because the report was cut off", () => {
    const report = JSON.stringify({
      diagnostics: Array.from({ length: 6000 }, (_, index) => ({
        message: `finding ${index} ${"x".repeat(200)}`,
        code: "probe",
        labels: [{ span: { offset: 0 } }],
      })),
    });
    const root = mkdtempSync(join(tmpdir(), "ramonda-css-big-"));
    projects.push(root);
    const path = join(root, "printer.mjs");
    writeFileSync(path, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(report)});\n`);
    execFileSync("chmod", ["+x", path]);

    expect(report.length).toBeGreaterThan(1024 * 1024);
    expect(oxlintLinter(path, REPO)(join(REPO, "Probe.tsx"))).toHaveLength(6000);
  });
});

/**
 * TWO attributes, one of them a block, kept one per line.
 *
 * **Reported by a user:**
 *
 * > "className="panel" css={@@( — ne mogu nikako dva propa da formatiram jedan ispod drugog, kao da
 * > nas eteti tera ostale da idu inline."
 *
 * They were right, and it is ours rather than biome's. The formatter never sees the block: it sees
 * a PLACEHOLDER, and the placeholder was a comment and a zero — about fourteen characters. So the
 * opening element measured as fitting on one line, biome joined the attributes exactly as it should
 * have, and the block was expanded again afterwards, past a width nobody re-measured.
 *
 * An element carrying a block and any other attribute is the ordinary case, so this bit everybody.
 *
 * The repair is to make the placeholder tell the truth about the block's shape: a multi-line block
 * is placeheld by something multi-line, so the element cannot fit on one line and biome breaks the
 * attributes itself. A ONE-LINE block keeps the short placeholder, because `css=@@( display: flex; )`
 * beside another attribute is a line the author chose and the formatter should be free to keep.
 */
describe("a block beside another attribute", () => {
  const TWO = `export const Card = () => (
  <div
    className="panel"
    css={@@(
      display: flex;
      gap: 8px;
    )}
  >
    <span>x</span>
  </div>
);
`;

  const lineWith = (text: string, needle: string) => text.split("\n").find((line) => line.includes(needle));

  test("stays one per line, and the block is still the author's", () => {
    const root = project({ "Card.tsx": TWO });

    const { status } = run(root, ["format", "src/Card.tsx"]);
    const out = readFileSync(join(root, "src", "Card.tsx"), "utf8");

    expect(status).toBe(0);
    expect(lineWith(out, "className=")).not.toContain("css=");
    expect(out).toContain("display: flex;");
    expect(out).toContain("gap: 8px;");
  });

  test("and formatting it twice changes nothing the second time", () => {
    const root = project({ "Card.tsx": TWO });

    run(root, ["format", "src/Card.tsx"]);
    const once = readFileSync(join(root, "src", "Card.tsx"), "utf8");
    run(root, ["format", "src/Card.tsx"]);

    expect(readFileSync(join(root, "src", "Card.tsx"), "utf8")).toBe(once);
  });

  /** A one-line block is a shape the author chose, and joining those attributes is biome's call. */
  test("a one-line block is left to the formatter's own judgement", () => {
    const root = project({
      "Card.tsx": `export const Card = () => (\n  <div\n    id="x"\n    css={@@( display: flex; )}\n  >\n    y\n  </div>\n);\n`,
    });

    run(root, ["format", "src/Card.tsx"]);
    const out = readFileSync(join(root, "src", "Card.tsx"), "utf8");

    expect(lineWith(out, "id=")).toContain("css=");
  });
});
