import { describe, expect, test } from "vitest";
import ts from "typescript";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProgram, analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));

/** The same fixture as a program WITH TypeScript's lib — as an editor, or the docs' example check, builds one. */
function withALib(fixture: string): ts.Program {
  const path = join(here, "fixtures", fixture, "tsconfig.json");
  const parsed = ts.getParsedCommandLineOfConfigFile(
    path,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  if (parsed === undefined) throw new Error(`no tsconfig at ${path}`);
  return ts.createProgram(parsed.fileNames, { ...parsed.options, lib: ["lib.esnext.d.ts", "lib.dom.d.ts"] });
}

const lines = (found: { line: number; kind: string }[] | undefined) => (found ?? []).map((i) => [i.line, i.kind]);

/**
 * The analyzer builds its own program with no lib, and a caller of `analyzeProgram` may hand it one
 * with a lib, where `RegExp.prototype.test`, `Math` and `HTMLFormElement.reset` resolve to TypeScript's
 * declarations instead of to nothing. A rule that asks whether a name is the platform's answers the
 * same in both.
 */
describe("a rule reads the platform the same with a lib or without", () => {
  for (const [fixture, rule] of [
    ["transform-pure", "transform-that-is-not-pure"],
    ["reset-heard", "reset-the-model-does-not-hear"],
  ] as const) {
    test(rule, () => {
      const without = analyzeProject(join(here, "fixtures", fixture, "tsconfig.json")).findings[rule];
      const withLib = analyzeProgram(withALib(fixture)).findings[rule];
      expect(lines(withLib)).toEqual(lines(without));
      expect(lines(without).length).toBeGreaterThan(0);
    });
  }
});
