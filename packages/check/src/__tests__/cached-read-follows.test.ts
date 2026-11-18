import { describe, expect, test } from "vitest";
import ts from "typescript";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "cached-read-follows", "tsconfig.json"));

/**
 * A cached reader is followed wherever it reads — so that writing it any other way is not a way out.
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
      "direct:var lang:setLang",
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
      "returned:rate:bump",
      "passed:rate:bump",
      "boundFunction:rate:bump",
      "builtByField:rate:bump",
      "global:var scriptTheme:any script — it is a global, in a file with no import or export",
      "destructuredArrow:rate:bump",
      "toned:tone:setTone",
      "destructuredMethod:rate:bump",
      "twoHelpers:var fmt:money",
      "nestedLazy:fmt2:prices",
      "methodMemo:_api2:api2",
      "title:var lang:setLang",
      "local:rate:bump",
      "viaFnGetter:rate:bump",
    ]);
  });

  /**
   * The fixture compiles. One that did not proved nothing: `shown` was declared twice, a field and a
   * getter, so `self.shown` was the field at runtime while the rule followed the getter.
   */
  test("the fixture is a program TypeScript accepts", () => {
    const config = ts.readConfigFile(join(here, "fixtures", "cached-read-follows", "tsconfig.json"), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, join(here, "fixtures", "cached-read-follows"));
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const errors = ts
      .getPreEmitDiagnostics(program)
      .map((one) => ts.flattenDiagnosticMessageText(one.messageText, "\n"));
    expect(errors).toEqual([]);
  });
});
