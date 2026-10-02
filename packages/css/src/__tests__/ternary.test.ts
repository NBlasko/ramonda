import { describe, expect, test } from "vitest";
import { mergeClassNames } from "../merge";
import { readBlock } from "../compiler/read";
import { transform } from "../compiler/transform";

/**
 * `border: $(this.error) ? 2px solid red : 1px solid #ccc;` — a choice between two values.
 *
 * Every branch is a value known when the block compiles, so every branch is a class, and the render
 * only chooses — the same bargain a value `match` makes, for the case with two answers. The `:` is
 * mandatory, as in the language it is borrowed from. A chain, `$(a) ? x : $(b) ? y : z`, writes each
 * condition once and in order. CSS has no `?` in a value and no `:` at the top level of one, which is
 * what makes the reading unambiguous.
 */

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
  return String(value ?? "")
    .split(" ")
    .filter((one) => one !== "");
};

const refusal = (block: string): string => {
  try {
    transform(`const __out = @@(\n${block}\n);\n`, { filename: "App.tsx" });
    return "compiled";
  } catch (error) {
    return (error as Error).message;
  }
};

describe("a choice picks one value", () => {
  test("the first when the condition holds, the second when it does not", () => {
    expect(classes("  color: $(on) ? red : blue;", { on: true })).toEqual(["r-c-red"]);
    expect(classes("  color: $(on) ? red : blue;", { on: false })).toEqual(["r-c-blue"]);
  });

  /** Truthiness, as JavaScript means it — not a lookup of the value's string. */
  test("a condition that is not a boolean is read as JavaScript reads it", () => {
    expect(classes("  color: $(name) ? red : blue;", { name: "anything" })).toEqual(["r-c-red"]);
    expect(classes("  color: $(name) ? red : blue;", { name: "" })).toEqual(["r-c-blue"]);
  });

  test("a branch holds a whole value, spaces and all", () => {
    const on = classes("  border: $(on) ? 2px solid red : 1px solid #ccc;", { on: true });
    const off = classes("  border: $(on) ? 2px solid red : 1px solid #ccc;", { on: false });

    expect(on.join(" ")).toContain("red");
    expect(off.join(" ")).toContain("ccc");
    expect(on.join(" ")).not.toContain("ccc");
  });

  test("a function is one branch, commas and spaces inside it", () => {
    expect(classes("  color: $(on) ? rgb(1 2 3) : blue;", { on: true }).join(" ")).toContain("rgb");
    expect(classes("  font-family: $(on) ? a, b : c;", { on: true }).join(" ")).toContain("a");
  });

  test("parens around a branch are the same value — the formatter takes them off", () => {
    const bare = classes("  border: $(on) ? 2px solid red : 1px solid #ccc;", { on: true });

    expect(classes("  border: $(on) ? (2px solid red) : (1px solid #ccc);", { on: true })).toEqual(bare);
  });

  test("a chain picks the first condition that holds", () => {
    const chain = "  color: $(a) ? red : $(b) ? green : blue;";

    expect(classes(chain, { a: true, b: true })).toEqual(["r-c-red"]);
    expect(classes(chain, { a: false, b: true })).toEqual(["r-c-green"]);
    expect(classes(chain, { a: false, b: false })).toEqual(["r-c-blue"]);
  });

  test("each condition is written once, in source order", () => {
    const out =
      transform("const __out = (a: boolean, b: boolean) => @@(\n  color: $(a) ? red : $(b) ? green : blue;\n);\n", {
        filename: "App.tsx",
      })?.code ?? "";

    expect(out.match(/\ba \?/g)).toHaveLength(1);
    expect(out.match(/\bb \?/g)).toHaveLength(1);
    expect(out.indexOf("a ?")).toBeLessThan(out.indexOf("b ?"));
  });

  test("a condition holding a ternary of its own is one condition", () => {
    expect(classes("  color: $(p ? q : r) ? red : blue;", { p: true, q: false, r: true })).toEqual(["r-c-blue"]);
  });

  test("a later declaration still wins over a choice", () => {
    expect(classes("  color: $(on) ? red : blue;\n  color: black;", { on: true })).toEqual(["r-c-black"]);
  });

  test("under a `when`, it is under it", () => {
    expect(classes("  when $(go) { color: $(on) ? red : blue; }", { go: false, on: true })).toEqual([]);
    expect(classes("  when $(go) { color: $(on) ? red : blue; }", { go: true, on: false })).toEqual(["r-c-blue"]);
  });
});

describe("how a choice must be written", () => {
  test("with no `:`, it is refused, naming the shape", () => {
    expect(refusal("  color: $(on) ? red;")).toContain("`$( … ) ? a : b`");
  });

  test("an empty branch is refused", () => {
    expect(refusal("  color: $(on) ? : blue;")).toContain("`$( … ) ? a : b`");
    expect(refusal("  color: $(on) ? red : ;")).toContain("`$( … ) ? a : b`");
  });

  test("a runtime value in a branch is refused, as in a match arm", () => {
    expect(refusal("  color: $(on) ? $(tint) : blue;")).toContain("hole-in-a-match-arm");
    expect(refusal("  color: $(on) ? blue : $(tint);")).toContain("hole-in-a-match-arm");
  });

  test("a forgiving read keeps it, for an editor", () => {
    const source = "@@(\n  color: $(on) ? red : blue;\n)";
    const [item] = readBlock(source, 2, "C.tsx", { tolerant: true }).block.items;

    expect(item.kind === "declaration" && item.value.map((part) => part.kind)).toEqual(["choice"]);
  });
});
