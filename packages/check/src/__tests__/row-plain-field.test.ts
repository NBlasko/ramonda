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
  test("the direct read, the local hop and the sibling method are all reported", () => {
    const found = run().findings["row-reads-a-plain-field"];
    const fields = found.filter((i) => i.kind === "plain-field");
    expect(fields.map((i) => `${i.component}.${i.through}:${i.name}`)).toEqual([
      "Reported.row:label",
      "ThroughALocal.row:label",
      "ThroughAMethod.cell:label",
      // `@persist` carries a value across hydration without tracking it, so it is as stale as a plain
      // field. This list said otherwise until the judgement was shared with the `@compute` rule.
      "PersistRead.row:seen",
      // A class-field arrow is a stable reference too, so its rows are reused just the same.
      "ArrowCallback.row:label",
    ]);
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
