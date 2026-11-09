import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "declared-below", "tsconfig.json"));

/**
 * A hook's props callback reading a field declared BELOW it.
 *
 * Found by an agent building an app from the docs alone, which writes fields in the order it thinks
 * of them: `this.use` calls the callback while the class's fields are still being set, top to bottom,
 * so a field below is not there yet. A hook there is a bare `TypeError` at mount, naming nothing; a
 * plain field is worse — measured, it reads `undefined`, and since a plain field is not a signal the
 * callback never runs again. TypeScript does not see it: the read is inside a function.
 */
describe("a props callback reading a field declared below it", () => {
  test("is reported for a hook, a plain field and @state, through `this`, the parameter or a destructure", () => {
    const found = run().findings["field-read-before-it-is-declared"];
    expect(found.map((issue) => `${issue.member}<-${issue.field}`)).toEqual([
      "a<-browser",
      "b<-limit",
      "c<-count",
      "d<-limit",
      "e<-total",
    ]);
  });

  test("is silent for a field above, a method, a getter, a base class's field, and a read in a handed-over function", () => {
    const found = run().findings["field-read-before-it-is-declared"];
    expect(found.every((issue) => issue.component === "Reported")).toBe(true);
  });
});
