import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "row-plain-field", "tsconfig.json"));

/**
 * A row callback that shows something no rebuild can follow.
 *
 * The runtime cannot catch this: a plain field read is a property access and records nothing, and the
 * double render compares two calls in one tick, where the field holds the same value both times. The
 * declaration is the only evidence, so this is the only place the check can live.
 *
 * Half of these cases are the SILENCES, and each one is a decision rather than a gap — a plain field is
 * the only home for a `WebSocket` or a `Map`, because `@state` must be JSON.
 */
describe("a row reads a plain field", () => {
  /**
   * How `list` is recognised, which had three answers in three rules.
   *
   * This one scanned the file's imports for a binding called `list` and took the FIRST — so a file
   * importing it under an alias as well got the wrong name, and a re-export was invisible. An app
   * wrapping its imports in a `ui` module is ordinary, and the framework's `list` is still the
   * framework's `list`. Resolved through the alias chain now, which also keeps an app's OWN
   * function called `list` out of it — `own-list.ts` in the fixture.
   */
  test("the direct read, the local hop and the sibling method are all reported", () => {
    const found = run().findings["row-reads-a-plain-field"];
    const fields = found.filter((i) => i.kind === "plain-field");
    expect(fields.map((i) => `${i.component}.${i.through}:${i.name}`)).toEqual([
      // The framework's `list` under a local alias, and reached through an app's own `ui` module.
      // Both are the framework's `list`, and the rows it builds are cached the same way.
      "ThroughAnAlias.row:label",
      "ThroughAReExport.row:label",
      "Reported.row:label",
      "ThroughALocal.row:label",
      "ThroughAMethod.cell:label",
      // `@persist` carries a value across hydration without tracking it, so it is as stale as a plain
      // field. This list said otherwise until the judgement was shared with the `@compute` rule.
      "PersistRead.row:seen",
      // A class-field arrow is a stable reference too, so its rows are reused just the same.
      "ArrowCallback.row:label",
      // A base's callback showing a base's field: one instance, one row, one stale value.
      "RowsFromABase.row:label",
      "ArrowFieldCallback.row:label",
    ]);
  });

  /**
   * The callback and the field on a BASE class — planted because the heritage axis had already
   * found five other rules stopping at a single class body, and this was the newest code in the
   * package. It stopped there too.
   *
   * A `ModuleRule` had no way to ask where a name was declared, which is why: `ModuleContext` now
   * carries `resolve`, the same question a class rule asks.
   */
  test("a row callback inherited from a base is judged with the base's fields", () => {
    const found = run().findings["row-reads-a-plain-field"];
    expect(found.map((issue) => issue.component)).toContain("RowsFromABase");
  });

  test("the report names the callback, because that is why rows are reused", () => {
    const found = run().findings["row-reads-a-plain-field"];
    expect(found.find((i) => i.component === "Reported")?.callback).toBe("row");
  });

  test("`this` leaving is reported as unanalysable, not guessed at", () => {
    const found = run().findings["row-reads-a-plain-field"];
    const opaque = found.filter((i) => i.kind === "opaque-call");
    expect(opaque.map((i) => `${i.component}:${i.name}`)).toEqual([
      "HandsThisOut:labelOf",
      // A SIBLING member is no better: it reads through its parameter, and nothing follows a
      // parameter. The message says "through a parameter" for exactly this case, because "outside
      // this declaration" would be false when the callee is in the same class.
      "ThisToASibling:this.fmt",
    ]);
  });

  test.each([
    ["Reactive", "`@state` records the read"],
    ["ComputeRead", "a `@compute` is tracked, so the row wakes with it"],
    ["NeverWritten", "no write, no staleness"],
    ["WrittenInCreated", "decided before the first row exists"],
    ["WrittenInConstructor", "also before the first render"],
    ["MemoInRender", "the memo pattern — advising `@state` there advises a loop"],
    ["WrittenInDestroyed", "after the last render, so nothing is left to be stale"],
    ["InlineCallback", "every row is rebuilt anyway"],
    ["SideEffectOnly", "a plain field that never reaches the markup is the point of one"],
    ["Annotated", "the author wrote down why"],
    ["GetterOverAField", "a getter is not a field — the stated limit of `stale-field.ts`"],
    ["OwnList", "the app's own `list`, found by the specifier rather than the name"],
  ])("%s is silent — %s", (component) => {
    const found = run().findings["row-reads-a-plain-field"];
    expect(found.filter((i) => i.component === component)).toEqual([]);
  });
});
