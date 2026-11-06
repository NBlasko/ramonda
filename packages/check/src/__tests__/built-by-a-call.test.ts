import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "built-by-a-call", "tsconfig.json"));

/**
 * A value a call or a `new` builds during the render.
 *
 * Found by measuring the runtime against the checker, one shape at a time: RMD020 reports
 * `conf={this.items.filter(…)}`, `Object.assign({}, x)`, `new Date(0)` and `this.save.bind(this)` as
 * a new value every render, and RMD022 the same in a hook's props callback. The checker followed
 * only literals and arrows, so every one of them passed.
 */
describe("a value built by a call", () => {
  test("an array method, a global builder and a `new` are each a value rebuilt every render", () => {
    const found = run().findings["fresh-object-in-props"];
    expect(found.filter((issue) => issue.component === "Row").map((issue) => `${issue.written}:${issue.kind}`)).toEqual(
      [
        "this.items.filter((n) => n > 1):array",
        "this.items.map((n) => n * 2):array",
        "this.items.slice():array",
        "this.items.concat([4]):array",
        "Object.assign({}, this.conf):object",
        "Object.keys(this.conf):array",
        "Array.from(this.items):array",
        "structuredClone(this.conf):object",
        "new Date(0):object",
        "new Map():object",
      ],
    );
  });

  test("`.bind` in the markup is a function built every render", () => {
    const found = run().findings["function-built-in-the-markup"];
    expect(found.map((issue) => issue.written)).toContain("this.save.bind(this)");
  });

  test("and in a hook's props callback, read through its parameter", () => {
    const found = run().findings["fresh-object-in-hook-props"];
    expect(found.map((issue) => `${issue.hook}.${issue.prop} <- ${issue.rebuiltBecauseOf}`)).toEqual([
      "Taker.conf <- self.tick",
    ]);
  });

  /**
   * A `@compute` hands back the same array until what it reads changes, `assign` into a held object
   * hands back what is held, children are compared by content, and a file's own `Object` is not the
   * platform's.
   */
  test("is silent where nothing is rebuilt, or the name is not the platform's", () => {
    const found = run().findings["fresh-object-in-props"];
    expect(found.every((issue) => !issue.file.endsWith("shadowed.tsx"))).toBe(true);
    expect(found.map((issue) => issue.written)).not.toContain("this.visible");
    expect(found.map((issue) => issue.written)).not.toContain("Object.assign(this.conf, { dense: false })");
    expect(found).toHaveLength(10);
  });
});

/**
 * A function built in a hook's props callback — RMD022 at runtime, and nothing in the checker looked
 * at one until it was measured.
 */
describe("a function built in a hook's props", () => {
  test("an arrow and a method are reported where the callback runs again, and a handed method is not", () => {
    const found = run().findings["function-built-in-hook-props"];
    expect(found.map((issue) => `${issue.hook}.${issue.prop}: ${issue.written} <- ${issue.rebuiltBecauseOf}`)).toEqual([
      "Fetcher.fetch: () => self.save() <- self.tick",
      "Fetcher.fetch: fetch() { … } <- self.tick",
    ]);
  });
});
