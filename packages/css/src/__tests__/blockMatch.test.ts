import { describe, expect, test } from "vitest";
import { mergeClassNames, pick } from "../merge";
import { readBlock } from "../compiler/read";
import { checkSource } from "../compiler/source";
import { transform } from "../compiler/transform";

/**
 * `match $(x) { key => ( declarations ); … }` — a match whose arms are whole groups of declarations.
 *
 * The outer `{ }` holds the arms and each arm's body is `( … )`, the shape of a JavaScript arrow
 * returning a value. Every arm ends with `;`. It compiles exactly as a value `match` does: every
 * declaration in every arm is its own class, and the render picks one arm's classes by the subject —
 * one lookup, with the subject written once.
 */

/** The block compiled and RUN, with the names its expressions read. */
const classes = (block: string, names: Record<string, unknown> = {}): string[] => {
  const out = transform(`const __out = @@(\n${block}\n);\n`, { filename: "App.tsx" });
  const code = (out?.code ?? "")
    .split("\n")
    .filter((line) => !line.startsWith("import "))
    .join("\n");
  const keys = Object.keys(names);
  const value = new Function("_merge", "_pick", ...keys, `${code}\nreturn __out;`)(
    mergeClassNames,
    pick,
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

const TONES = [
  "  match $(tone) {",
  "    hot => ( color: red; padding: 4px; );",
  "    cold => ( color: blue; );",
  "    _ => ( color: gray; );",
  "  }",
].join("\n");

describe("an arm applies its whole group", () => {
  test("the arm the subject names, all of it", () => {
    const got = classes(TONES, { tone: "hot" });

    expect(got).toContain("r-c-red");
    expect(got.some((one) => one.includes("4px"))).toBe(true);
    expect(got).not.toContain("r-c-blue");
  });

  test("another arm, and only that one", () => {
    expect(classes(TONES, { tone: "cold" })).toEqual(["r-c-blue"]);
  });

  test("`_` answers for everything the keys do not name", () => {
    expect(classes(TONES, { tone: "lukewarm" })).toEqual(["r-c-gray"]);
    expect(classes(TONES, { tone: undefined })).toEqual(["r-c-gray"]);
  });

  test("with no `_`, a subject no arm names applies nothing", () => {
    const block = "  color: black;\n  match $(tone) {\n    hot => ( color: red; );\n  }";

    expect(classes(block, { tone: "cold" })).toEqual(["r-c-black"]);
  });

  test("a declaration after the match still wins, as everywhere else", () => {
    expect(classes(`${TONES}\n  color: black;`, { tone: "hot" })).toContain("r-c-black");
    expect(classes(`${TONES}\n  color: black;`, { tone: "hot" })).not.toContain("r-c-red");
  });

  test("the subject is written once", () => {
    const out = transform(`const __out = (tone: string) => @@(\n${TONES}\n);\n`, { filename: "App.tsx" })?.code ?? "";

    expect(out.match(/_pick\(tone,/g)).toHaveLength(1);
  });

  test("an arm may hold a nested rule, which lands with it", () => {
    const block =
      "  match $(tone) {\n    hot => ( color: red; &:hover { color: darkred; } );\n    cold => ( color: blue; );\n  }";

    expect(classes(block, { tone: "hot" })).toHaveLength(2);
    expect(classes(block, { tone: "cold" })).toEqual(["r-c-blue"]);
  });

  test("a quoted key, for what is not a name", () => {
    const block = '  match $(size) {\n    "x-large" => ( padding: 8px; );\n    _ => ( padding: 2px; );\n  }';

    expect(classes(block, { size: "x-large" }).some((one) => one.includes("8px"))).toBe(true);
  });

  test("an empty arm applies nothing", () => {
    const block = "  match $(tone) {\n    hot => ( );\n    _ => ( color: gray; );\n  }";

    expect(classes(block, { tone: "hot" })).toEqual([]);
  });

  test("beside a condition, each is its own choice", () => {
    const block = `  when $(on) { opacity: 0.5; }\n${TONES}`;

    expect(classes(block, { on: false, tone: "cold" })).toEqual(["r-c-blue"]);
  });
});

describe("how a block match must be written", () => {
  test.each([
    ["an arm with no parens", "  match $(t) {\n    hot => color: red;;\n  }"],
    ["an arm in braces", "  match $(t) {\n    hot => { color: red; };\n  }"],
  ])("%s is refused, naming the shape", (_what, block) => {
    expect(refusal(block)).toContain("`key => ( … );`");
  });

  test("an arm with no `;` after it is refused", () => {
    expect(refusal("  match $(t) {\n    hot => ( color: red; )\n    cold => ( color: blue; );\n  }")).toContain(
      "ends with `;`",
    );
  });

  test.each([
    ["a condition", "  match $(t) {\n    hot => ( when $(on) { color: red; } );\n  }"],
    ["a spread", "  match $(t) {\n    hot => ( ...$(base); );\n  }"],
    ["another match", "  match $(t) {\n    hot => ( match $(u) { a => ( color: red; ); } );\n  }"],
    ["a value match", "  match $(t) {\n    hot => ( color: match $(u) { a => red; }; );\n  }"],
    // Found in round 8: it compiled into an internal error — the condition had nowhere to be written.
    ["a choice", "  match $(t) {\n    hot => ( color: $(u) ? red : blue; );\n  }"],
  ])("%s inside an arm is refused", (_what, block) => {
    expect(refusal(block)).toContain("an arm holds declarations");
  });

  test("a subject that is not code is refused", () => {
    expect(refusal("  match tone {\n    hot => ( color: red; );\n  }")).toContain("`match $( … ) {");
  });

  test("the old spelling names the new one", () => {
    expect(refusal("  match({tone}) {\n    hot => ( color: red; );\n  }")).toContain("`match $( … ) {");
  });

  test("a forgiving read keeps it, for an editor", () => {
    const source = "@@(\n  match $(t) {\n    hot => ( color: red; );\n    _ => ( color: gray; );\n  }\n)";
    const [item] = readBlock(source, 2, "C.tsx", { tolerant: true }).block.items;

    expect(item.kind).toBe("match");
    expect(item.kind === "match" && item.arms.map((arm) => arm.key)).toEqual(["hot", "_"]);
  });
});

describe("what the checker makes of a block match", () => {
  const rulesOf = (source: string) => checkSource(source, "/App.tsx").map((one) => one.rule);
  const file = (block: string) => `declare const t: string;\nconst x = @@(\n${block}\n);\nexport default x;\n`;

  test("a correct one is quiet", () => {
    expect(rulesOf(file("  match $(t) {\n    hot => ( color: red; );\n    _ => ( color: gray; );\n  }"))).toEqual([]);
  });

  test("a property typo inside an arm is reported", () => {
    expect(rulesOf(file("  match $(t) {\n    hot => ( colr: red; );\n  }"))).toContain("unknown-property");
  });

  test("two arms with one key are reported, because the second can never be reached", () => {
    expect(rulesOf(file("  match $(t) {\n    hot => ( color: red; );\n    hot => ( color: blue; );\n  }"))).toContain(
      "match-arm-repeated",
    );
  });

  test("an arm below `_` is reported, because `_` already answered", () => {
    expect(rulesOf(file("  match $(t) {\n    _ => ( color: gray; );\n    hot => ( color: red; );\n  }"))).toContain(
      "match-arm-repeated",
    );
  });

  test("inside a named block it is composition, and reported as such", () => {
    const source =
      "declare const t: string;\nconst k = @@keyframes(\n  match $(t) {\n    a => ( from { opacity: 0; } );\n  }\n);\nexport default k;\n";

    expect(rulesOf(source)).toContain("composition-in-a-named-block");
  });
});
