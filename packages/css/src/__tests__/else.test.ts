import { describe, expect, test } from "vitest";
import { mergeClassNames } from "../runtime/merge";
import { readBlock } from "../compiler/read";
import { checkSource } from "../compiler/source";
import { transform } from "../compiler/transform";

/**
 * `else when $(…) { … }` and `else { … }` — the branches of a `when`.
 *
 * A chain compiles to ONE conditional expression, `a ? A : b ? B : C`, so each condition is written
 * once and in the order the author wrote it — the rule the whole emission rests on, because an
 * expression is copied where it was written and never twice.
 */

/** The block compiled and RUN, with the names its expressions read. */
const classes = (block: string, names: Record<string, unknown> = {}): string[] => {
  const out = transform(`const __out = @@(\n${block}\n);\n`, { filename: "App.tsx" });
  const code = (out?.code ?? "")
    .split("\n")
    .filter((line) => !line.startsWith("import "))
    .join("\n");
  const keys = Object.keys(names);
  const value = new Function("_merge", ...keys, `${code}\nreturn __out;`)(
    mergeClassNames,
    ...keys.map((key) => names[key]),
  );
  return String(value)
    .split(" ")
    .filter((one) => one !== "");
};

const refusal = (block: string): string => {
  try {
    transform(`const a = @@(\n${block}\n);\n`, { filename: "App.tsx" });
    return "compiled";
  } catch (error) {
    return (error as Error).message;
  }
};

describe("a chain picks exactly one branch", () => {
  const CHAIN = [
    "  color: black;",
    "  when $(a) { color: red; }",
    "  else when $(b) { color: green; }",
    "  else { color: blue; }",
  ].join("\n");

  test.each([
    ["the first holds", { a: true, b: true }, "r-c-red"],
    ["only the second holds", { a: false, b: true }, "r-c-green"],
    ["neither holds", { a: false, b: false }, "r-c-blue"],
  ])("%s", (_what, names, expected) => {
    const got = classes(CHAIN, names);

    expect(got).toContain(expected);
    expect(got.filter((one) => /^r-c-(red|green|blue)$/.test(one))).toEqual([expected]);
  });

  test("with no final `else`, nothing applies when nothing holds", () => {
    const block = "  color: black;\n  when $(a) { color: red; }\n  else when $(b) { color: green; }";

    expect(classes(block, { a: false, b: false })).toEqual(["r-c-black"]);
    expect(classes(block, { a: false, b: true })).toContain("r-c-green");
  });

  test("a bare `else` after one `when`", () => {
    const block = "  when $(a) { color: red; }\n  else { color: blue; }";

    expect(classes(block, { a: true })).toEqual(["r-c-red"]);
    expect(classes(block, { a: false })).toEqual(["r-c-blue"]);
  });

  test("each condition is written once, in source order", () => {
    const out = transform(
      "const a = (a: boolean, b: boolean) => @@(\n  when $(a) { color: red; }\n  else when $(b) { color: green; }\n  else { color: blue; }\n);\n",
      { filename: "App.tsx" },
    )?.code;

    expect(out?.match(/\ba\b(?= \?)/g)).toHaveLength(1);
    expect(out?.match(/\bb\b(?= \?)/g)).toHaveLength(1);
    expect(out?.indexOf("a ?")).toBeLessThan(out?.indexOf("b ?") ?? -1);
  });

  test("a branch holding several declarations applies all of them", () => {
    const block = "  when $(a) { color: red; }\n  else { color: blue; padding: 4px; }";

    expect(classes(block, { a: false })).toEqual(expect.arrayContaining(["r-c-blue"]));
    expect(classes(block, { a: false }).length).toBeGreaterThan(1);
  });

  test("an empty branch applies nothing, and the chain still compiles", () => {
    expect(classes("  when $(a) { }\n  else { color: blue; }", { a: true })).toEqual([]);
    expect(classes("  when $(a) { }\n  else { color: blue; }", { a: false })).toEqual(["r-c-blue"]);
  });

  test("a chain inside a `when` is under it", () => {
    const block = "  when $(on) {\n    when $(a) { color: red; }\n    else { color: blue; }\n  }";

    expect(classes(block, { on: false, a: true })).toEqual([]);
    expect(classes(block, { on: true, a: false })).toEqual(["r-c-blue"]);
  });

  test("a `when` inside a branch is under the branch", () => {
    const block = "  when $(a) { color: red; }\n  else {\n    color: blue;\n    when $(b) { padding: 4px; }\n  }";

    expect(classes(block, { a: true, b: true })).toEqual(["r-c-red"]);
    expect(classes(block, { a: false, b: true }).length).toBeGreaterThan(1);
  });

  test("two chains one after the other are two choices", () => {
    const block =
      "  when $(a) { color: red; }\n  else { color: blue; }\n  when $(b) { padding: 4px; }\n  else { padding: 8px; }";

    const got = classes(block, { a: true, b: false });
    expect(got).toContain("r-c-red");
    expect(got.some((one) => one.includes("8px"))).toBe(true);
  });

  test("a condition holding a ternary is one condition", () => {
    const block = "  when $(p ? q : r) { color: red; }\n  else { color: blue; }";

    expect(classes(block, { p: true, q: false, r: true })).toEqual(["r-c-blue"]);
  });

  test("a later declaration still wins over a branch, as everywhere else", () => {
    expect(classes("  when $(a) { color: red; }\n  else { color: blue; }\n  color: black;", { a: true })).toEqual([
      "r-c-black",
    ]);
  });
});

describe("where an `else` may stand", () => {
  test.each([
    ["first in a block", "  else { color: blue; }"],
    ["after a declaration", "  color: red;\n  else { color: blue; }"],
    ["after a selector", "  &:hover { color: red; }\n  else { color: blue; }"],
    ["after a final `else`", "  when $(a) { color: red; }\n  else { color: blue; }\n  else { color: green; }"],
    ["an `else when` after a final `else`", "  when $(a) { }\n  else { }\n  else when $(b) { }"],
  ])("%s is refused", (_what, block) => {
    expect(refusal(block)).toContain("`else` belongs right after a `when $( … ) { … }`");
  });

  test.each([
    ["no condition", "  when $(a) { }\n  else when { color: red; }"],
    ["a condition that is not code", "  when $(a) { }\n  else when ready { color: red; }"],
    ["two of them", "  when $(a) { }\n  else when $(b) $(c) { color: red; }"],
  ])("`else when` with %s is refused", (_what, block) => {
    expect(refusal(block)).toContain("takes one `$( … )`");
  });

  test("`else` takes no condition of its own", () => {
    expect(refusal("  when $(a) { }\n  else $(b) { color: red; }")).toContain("`else when $( … ) { … }`");
  });

  test("a comment between the branches is allowed", () => {
    expect(refusal("  when $(a) { }\n  /* otherwise */\n  else { color: blue; }")).toBe("compiled");
  });

  /** `else` cannot be an element — a custom element's name needs a hyphen — so nothing is lost. */
  test("an element named `else` is still reachable through its parent", () => {
    expect(refusal("  & else { color: red; }")).toBe("compiled");
  });

  test("a forgiving read keeps the chain, for an editor", () => {
    const source = "@@(\n  when $(a) { color: red; }\n  else { color: blue; }\n)";
    const { block } = readBlock(source, 2, "C.tsx", { tolerant: true });

    expect(
      block.items.map((item) =>
        item.kind === "rule" ? item.prelude : item.kind === "declaration" ? item.property : "match",
      ),
    ).toEqual(["when \u00000\u0000", "else"]);
  });
});

describe("what the checker makes of a branch", () => {
  const rulesOf = (source: string) => checkSource(source, "/App.tsx").map((one) => one.rule);

  /** A guard is not a scope, and a branch is a guard: it decides whether a map lands, nothing else. */
  test("a spread inside a branch is not out of place", () => {
    const source =
      "declare const a: boolean;\ndeclare const base: string;\nconst x = @@(\n  when $(a) { color: red; }\n  else { ...$(base); }\n);\nexport default x;\n";

    expect(rulesOf(source)).not.toContain("spread-out-of-place");
  });

  // Once per block, as for a `when` alone: the rule stops at the first, and the frame rule says nothing.
  test("a branch inside a named block is composition, and reported as such", () => {
    const source =
      "declare const on: boolean;\nconst k = @@keyframes(\n  when $(on) { from { opacity: 0; } }\n  else { to { opacity: 1; } }\n);\nexport default k;\n";

    expect(rulesOf(source).filter((one) => one === "composition-in-a-named-block")).toHaveLength(1);
    expect(rulesOf(source)).not.toContain("unknown-frame");
  });
});
