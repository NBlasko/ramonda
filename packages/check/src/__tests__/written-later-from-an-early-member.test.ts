import { describe, expect, test } from "vitest";
import ts from "typescript";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject, createProgram } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "written-later-from-an-early-member", "tsconfig.json");

/**
 * The constructor, `@created` and `render()` write before or at the first render, so their own writes
 * leave no cached reader stale. A function written inside one runs later — a handler `render()` hands
 * an element, a timer `@created` starts, a listener the constructor adds — and its writes do.
 */
describe("a field written later by a function an early member writes", () => {
  test("is reported, named for the member; the members' own writes are not", () => {
    const found = analyzeProject(fixture).findings["cached-read-of-a-plain-field"];
    expect(found.map((one) => `${one.named}:${one.field}:${one.writtenBy}`).sort()).toEqual([
      "total:rate:render",
      "total:speed:start",
      "total:width:constructor",
    ]);
  });

  test("the fixture is a program TypeScript accepts, as the analyzer builds it", () => {
    const { program, notes } = createProgram(fixture);
    expect(
      program.getRootFileNames().filter((name) => name.includes("/written-later-from-an-early-member/")).length,
    ).toBe(1);
    expect(notes).toEqual([]);
    expect(
      ts.getPreEmitDiagnostics(program).map((one) => ts.flattenDiagnosticMessageText(one.messageText, "\n")),
    ).toEqual([]);
  });
});
