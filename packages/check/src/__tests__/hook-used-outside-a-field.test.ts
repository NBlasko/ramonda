import { describe, expect, test } from "vitest";
import ts from "typescript";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject, createProgram } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "hook-used-outside-a-field", "tsconfig.json"));

/**
 * A hook is made in a field and nowhere else. The runtime refuses a `use()` once construction is over
 * (RMD063); this refuses every shape but `name = this.use(…)`, which is the only one that cannot run a
 * different number of times on two instances.
 */
describe("a hook used outside a field", () => {
  test("every shape but a field's whole initializer is reported, and the fields are not", () => {
    const found = run().findings["hook-used-outside-a-field"];
    expect(found.map((one) => `${one.component}.${one.usedIn}:${one.hook}`)).toEqual([
      "Everywhere.maybe:Counter",
      "Everywhere.many:Counter",
      "Everywhere.pair:Counter",
      "Everywhere.constructor:Counter",
      "Everywhere.open:Timer",
      "Everywhere.made:Counter",
      "Everywhere.ready:Counter",
      "Spelled.viaSuper:Counter",
      "Spelled.viaIndex:Counter",
      "Spelled.viaCall:Counter",
      "Spelled.viaBind:a hook",
      "Spelled.viaAlias:a hook",
      "Spelled.viaCast:Counter",
      "Grows.grow:Counter",
    ]);
  });

  test("the fixture is a program TypeScript accepts, as the analyzer builds it", () => {
    const { program, notes } = createProgram(join(here, "fixtures", "hook-used-outside-a-field", "tsconfig.json"));
    expect(program.getRootFileNames().filter((name) => name.includes("/hook-used-outside-a-field/")).length).toBe(1);
    expect(notes).toEqual([]);
    expect(
      ts.getPreEmitDiagnostics(program).map((one) => ts.flattenDiagnosticMessageText(one.messageText, "\n")),
    ).toEqual([]);
  });
});
