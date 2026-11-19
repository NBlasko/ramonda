import { describe, expect, test } from "vitest";
import ts from "typescript";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject, createProgram } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "owner-by-binding", "tsconfig.json");

/**
 * Every rule that reads a props callback or a cached reader names the owner the same way — by what a
 * name resolves to, and with `this` the root's only where no `function` stands between (`callbackOwner`
 * in `syntax.ts`). Each rule reports its one read here, and none of the shadowed or `function` ones.
 */
describe("a callback's owner, by binding", () => {
  const findings = analyzeProject(fixture).findings;

  test("fresh-object-in-hook-props: the owner's `tick`, not an inner parameter's, nor a function's `this`", () => {
    expect(findings["fresh-object-in-hook-props"].map((one) => `${one.prop}<-${one.rebuiltBecauseOf}`)).toEqual([
      "conf<-tick",
    ]);
  });

  test("field-read-before-it-is-declared: the component's `later`, not a function's `this.later`", () => {
    expect(findings["field-read-before-it-is-declared"].map((one) => `${one.member}:${one.field}`)).toEqual([
      "first:later",
    ]);
  });

  test("cached-read-of-a-plain-field: an arrow's `this.rate`, not a function's", () => {
    expect(findings["cached-read-of-a-plain-field"].map((one) => `${one.named}:${one.field}:${one.writtenBy}`)).toEqual(
      ["arrow:rate:bump"],
    );
  });

  test("the fixture is a program TypeScript accepts, as the analyzer builds it", () => {
    const { program, notes } = createProgram(fixture);
    expect(program.getRootFileNames().filter((name) => name.includes("/owner-by-binding/")).length).toBe(1);
    expect(notes).toEqual([]);
    expect(
      ts.getPreEmitDiagnostics(program).map((one) => ts.flattenDiagnosticMessageText(one.messageText, "\n")),
    ).toEqual([]);
  });
});
