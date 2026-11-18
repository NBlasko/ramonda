import { describe, expect, test } from "vitest";
import ts from "typescript";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject, createProgram } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "cached-read-follows", "tsconfig.json"));

/**
 * A cached reader is followed through a closed list of paths — methods, a getter's own body, functions
 * the project declares, named callbacks, variables outside the class — and every one of them is here,
 * with the shapes beside them that are not followed, and why (TODO 184 decides those one by one).
 *
 * A hook whose props callback reads no signal is never called again (and in a production build is
 * not walked at all — see `register` in core's `helpers/common.ts`), so what it read must be something
 * that cannot change without a signal. The field half of that was already this rule. These are the
 * other ways a value reaches a cached reader: a variable outside the class, a function this program
 * declares, a callback declared somewhere else, a method, a getter.
 */
describe("a cached reader, followed", () => {
  test("every path to a stale value is reported, and named", () => {
    const found = run().findings["cached-read-of-a-plain-field"];
    expect(found.map((one) => `${one.named}:${one.variable ? "var " : ""}${one.field}:${one.writtenBy}`)).toEqual([
      "px:var side:makeSized",
      "baseArrow:rate:bump",
      "direct:var lang:setLang",
      "staticInFactory:var made:later",
      "selfInArrow:rate:bump",
      "overloadedFunction:var lang:setLang",
      "throughAFunction:var lang:setLang",
      "named:rate:bump",
      "namedConst:rate:bump",
      "method:rate:bump",
      "getter:rate:bump",
      "pattern:var first:setFirst",
      "objectPattern:var region:setRegion",
      "loop:var unit:cycle",
      "counts:var count:bump",
      "counts:var count:bumpOther",
      "lazy:var fmt:money",
      "lazy:var loaded:config",
      "lazyGetter:_api:api",
      "notDismissed:var dismissed:dismiss",
      "eager:var fmt:money",
      "ofTotal:var created:id",
      "destructured:rate:bump",
      "counted:counter:nextId",
      "passed:rate:bump",
      "global:var scriptTheme:useDark",
      "anyScript:var scriptLang:any script",
      "asyncField:remoteRate:loading",
      "asyncVar:var remote:a function at the top level of app.tsx",
      "overloaded:rate:bump",
      "readsOther:other:iife",
      "toned:tone:setTone",
      "destructuredMethod:rate:bump",
      "twoHelpers:var fmt:money",
      "nestedLazy:fmt2:prices",
      "methodMemo:_api2:api2",
      "title:var lang:setLang",
      "local:rate:bump",
      "viaHelper:rate:bump",
      "viaFnGetter:rate:bump",
    ]);
  });

  /**
   * The fixture compiles. One that did not proved nothing: `shown` was declared twice, a field and a
   * getter, so `self.shown` was the field at runtime while the rule followed the getter.
   */
  test("a script's global no file in view writes is said to be one, not given a writer", () => {
    const found = run().findings["cached-read-of-a-plain-field"];
    expect(found.filter((one) => one.global).map((one) => one.named)).toEqual(["anyScript"]);
  });

  test("the fixture is a program TypeScript accepts, as the analyzer builds it", () => {
    const { program, notes } = createProgram(join(here, "fixtures", "cached-read-follows", "tsconfig.json"));
    // Not an empty program, which would accept anything: the fixture's own files are in it.
    expect(program.getRootFileNames().filter((name) => name.includes("/cached-read-follows/")).length).toBe(3);
    expect(notes).toEqual([]);
    expect(
      ts.getPreEmitDiagnostics(program).map((one) => ts.flattenDiagnosticMessageText(one.messageText, "\n")),
    ).toEqual([]);
  });
});
