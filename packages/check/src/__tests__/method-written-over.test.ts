import { describe, expect, test } from "vitest";
import ts from "typescript";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject, createProgram } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "method-written-over", "tsconfig.json"));

/**
 * A method written over. A hook's props callback that hands one over reads no signal, so it runs
 * once — and in a production build the hook is not walked at all — so the write reaches nobody.
 */
describe("a method written over", () => {
  test("every write to a method is reported, the base's included, and nothing else", () => {
    const found = run().findings["method-written-over"];
    expect(found.map((one) => `${one.component}.${one.writtenIn}:${one.method}`)).toEqual([
      "Editor.constructor:submit",
      "Editor.swap:submit",
      "Editor.swap:save",
      "Editor.swap:submit",
      "Editor.swap:submit",
      "Editor.swap:submit",
    ]);
  });

  test("the fixture is a program TypeScript accepts, as the analyzer builds it", () => {
    const { program, notes } = createProgram(join(here, "fixtures", "method-written-over", "tsconfig.json"));
    expect(program.getRootFileNames().filter((name) => name.includes("/method-written-over/")).length).toBe(1);
    expect(notes).toEqual([]);
    expect(
      ts.getPreEmitDiagnostics(program).map((one) => ts.flattenDiagnosticMessageText(one.messageText, "\n")),
    ).toEqual([]);
  });
});
