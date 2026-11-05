import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import ts from "typescript";
import { analyzeProgram, analyzeProject } from "../analyze";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "reset-follows");
/** Each line the fixture's files mark `// ✗ kind`, as `[file, line, kind]`. */
const marked = readdirSync(fixture)
  .filter((file) => /\.tsx?$/.test(file) && file !== "form.ts")
  .sort()
  .flatMap((file) =>
    readFileSync(join(fixture, file), "utf8")
      .split("\n")
      .flatMap((line, at) => {
        const kind = /\/\/ ✗ ([\w-]+)/.exec(line)?.[1];
        return kind === undefined ? [] : [[file, at + 1, kind] as const];
      }),
  );

/**
 * The browser's form reset, followed by what it IS and not by what it is called: a type alias, another
 * name, the method taken out or destructured, a key — and a form put where its reset can no longer be
 * followed, cast to a type that is not a form or handed to one with a `reset` of its own.
 */
const asMarked = (found: readonly { file: string; line: number; kind: string }[]) =>
  found
    .map((issue) => [basename(issue.file), issue.line, issue.kind] as const)
    .sort(([a, x], [b, y]) => a.localeCompare(b) || x - y);

describe("a form's reset under any name", () => {
  test("every line marked ✗ is reported as its kind, and nothing else is", () => {
    const found = analyzeProject(join(fixture, "tsconfig.json")).findings["reset-the-model-does-not-hear"] ?? [];
    expect(asMarked(found)).toEqual(marked);
  });

  /**
   * `analyzeProgram` takes a program its caller built — `scripts/check-examples.mjs` builds one with
   * the real DOM lib, where the form is TypeScript's own `HTMLFormElement` and has every member.
   */
  test("the same over a program with the real DOM lib", () => {
    const config = ts.getParsedCommandLineOfConfigFile(
      join(fixture, "tsconfig.json"),
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => {},
      },
    );
    if (config === undefined) throw new Error("the fixture's tsconfig did not parse");
    const program = ts.createProgram(config.fileNames, {
      ...config.options,
      lib: ["lib.esnext.d.ts", "lib.dom.d.ts"],
      types: [],
    });
    const found = analyzeProgram(program).findings["reset-the-model-does-not-hear"] ?? [];
    expect(asMarked(found)).toEqual(marked);
  });
});
