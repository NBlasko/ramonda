import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "watch-prop", "tsconfig.json"));

/**
 * `@watchProp` naming a prop that is not there.
 *
 * The selector IS the declaration, so a name that is not a prop reads `undefined` on every render
 * and never differs from the `undefined` before it — the method never runs, for the whole life of
 * the component, and nothing says so.
 *
 * `tsc` refuses this too, until somebody writes `(p: any) => …`, a `@ts-ignore`, or widens the
 * props type for an unrelated reason. The silence half below is what makes it safe to ship: every
 * props shape whose members cannot all be enumerated leaves the whole class alone.
 */
describe("a @watchProp on a prop that is not there", () => {
  test("every spelling of the read is checked", () => {
    const found = run().findings["watch-of-a-prop-that-is-not-there"];
    expect(found.map((issue) => `${issue.component}.${issue.member}:${issue.prop}`)).toEqual([
      "Profile.onUser:usrId",
      "Panel.onTitle:titel",
      "Panel.onOpen:opened",
      "Badge.onTotal:total",
    ]);
  });

  /** The report shows the near miss, which is the whole use of it: `usrId` beside `userId`. */
  test("the report lists the props that ARE declared", () => {
    const found = run().findings["watch-of-a-prop-that-is-not-there"];
    expect(found[0]?.declared).toEqual(["theme", "userId"]);
  });

  /**
   * The silence contract, and here it carries most of the rule: naming a real prop as missing is
   * the one failure that would get this switched off. Four shapes, four different reasons.
   */
  test("a props type whose members cannot all be known leaves the class alone", () => {
    const found = run().findings["watch-of-a-prop-that-is-not-there"];
    const classes = found.map((issue) => issue.component);
    // An intersection, an index signature, no type argument, and a selector this cannot read.
    expect(classes).not.toContain("Merged");
    expect(classes).not.toContain("Open");
    expect(classes).not.toContain("Bare");
    expect(classes).not.toContain("Dynamic");
  });

  /** Only the first level is a prop: `p.title.length` is about `title`, which exists. */
  test("a nested read is judged by its first level", () => {
    const found = run().findings["watch-of-a-prop-that-is-not-there"];
    expect(found.some((issue) => issue.member === "onLength")).toBe(false);
  });
});
