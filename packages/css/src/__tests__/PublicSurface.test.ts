import { describe, expect, test } from "vitest";
import * as compiler from "../compiler/index";
import * as api from "../index";

/**
 * What each entry exports, asserted as a list — the same tripwire the other packages have.
 *
 * There are two entries and they are not the same audience. `@ramonda/css` is loaded by every page
 * that renders a block, so anything added to it is shipped to a browser; `@ramonda/css/compiler`
 * runs in a build and may reach for `node:crypto`. The split is what keeps the second out of the
 * first, and a list per entry is what keeps the split honest.
 */
const RUNTIME = ["block", "toStyleObject"];

const COMPILER = [
  "CssBlockError",
  "Sheet",
  "checkBlock",
  "HASH_LENGTH",
  "HOLE",
  "classNameFor",
  "findBlocks",
  "mayHoldABlock",
  "holeOutOfPlace",
  "normalise",
  "placehold",
  "positionOf",
  "readBlock",
  "substitute",
  "transform",
  "variableNameFor",
  "virtualFile",
];

describe("public API surface", () => {
  test("the runtime entry exports exactly what it means to", () => {
    expect(Object.keys(api).sort()).toEqual([...RUNTIME].sort());
  });

  test("the compiler entry exports exactly what it means to", () => {
    expect(Object.keys(compiler).sort()).toEqual([...COMPILER].sort());
  });

  test("the runtime entry does not re-export the compiler", () => {
    // The class name is decided at build time. A runtime that could hash one would be a runtime that
    // could invent a rule, and no rule is ever created at runtime — see DESIGN.md, decision 7.
    for (const name of COMPILER) expect(api).not.toHaveProperty(name);
  });
});
