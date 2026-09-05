import { describe, expect, test } from "vitest";
import { CssBlockError } from "../compiler/errors";
import { readBlock } from "../compiler/read";
import { findBlocks } from "../compiler/scan";
import { virtualFile } from "../compiler/virtual";

/**
 * Reading a block that is **half written**, which is the only state an editor ever sees.
 *
 * Measured before this existed, on the keystroke states a person actually passes through:
 *
 * | typing | strict |
 * |---|---|
 * | `display: flex;` | fine |
 * | `disp` | **refused** — not a declaration |
 * | `display:` | fine, empty value |
 * | `&:hover { col }` | **refused** |
 * | `css=@@( display: flex;` — no `)` yet | **refused** |
 *
 * So the two states you are in most while typing a property name both refuse, and a refusal means no
 * virtual file, which means no completions exactly when they are wanted. The build must still refuse
 * — a block it cannot read has no correct compilation — so this is a second MODE of the same parser
 * rather than a change to it.
 */

const read = (source: string, tolerant: boolean) => {
  const [site] = findBlocks(source);
  return readBlock(source, site.open, "Card.tsx", { tolerant });
};

describe("what tolerance recovers", () => {
  test("a property with no colon yet becomes that property, with no value", () => {
    const source = `<div css=@@( disp )>x</div>`;
    const { block } = read(source, true);

    // `at` is where `disp` starts; `valueAt` is where a value would begin, which with nothing typed
    // is wherever reading stopped.
    expect(block.items).toEqual([
      {
        kind: "declaration",
        at: source.indexOf("disp"),
        valueAt: source.indexOf(")"),
        end: source.indexOf(")"),
        property: "disp",
        value: [],
      },
    ]);
  });

  test("the same inside a nested rule", () => {
    const { block } = read(`<div css=@@( &:hover { col } )>x</div>`, true);
    const [rule] = block.items;

    expect(rule.kind).toBe("rule");
    expect(rule.kind === "rule" && rule.items[0]).toMatchObject({ kind: "declaration", property: "col", value: [] });
  });

  test("a block with no closing paren ends at the end of what there is", () => {
    const source = `<div css=@@( display: flex;\n`;
    const { block, end } = read(source, true);

    expect(block.items).toMatchObject([{ property: "display" }]);
    // The last character, standing in for the `)` that is not there yet.
    expect(end).toBe(source.length - 1);
  });

  test("a hole with no closing braces ends there too", () => {
    const { block, holes } = read(`<div css=@@( color: {{accent`, true);

    expect(holes).toHaveLength(1);
    expect(block.items).toMatchObject([{ property: "color" }]);
  });

  test("and a hole in a position a custom property cannot occupy is kept as text", () => {
    // Refusing is right for a build and useless for an editor: the author is mid-thought, and taking
    // the whole file's completions away is not a way to tell them so. The CSS checker says it.
    const { block } = read(`<div css=@@( {{name}}: 24px; )>x</div>`, true);

    expect(block.items).toMatchObject([{ kind: "declaration" }]);
  });
});

describe("what strict still refuses, because a build has no correct answer", () => {
  test.each([
    ["a property with no colon", `<div css=@@( disp )>x</div>`],
    ["a block with no closing paren", `<div css=@@( display: flex;\n`],
    ["a hole with no closing braces", `<div css=@@( color: {{accent`],
    ["a hole as a property name", `<div css=@@( {{name}}: 24px; )>x</div>`],
  ])("%s", (_what, source) => {
    expect(() => read(source, false)).toThrow(CssBlockError);
  });

  test("and strict is the default, so nothing gets tolerance by forgetting to ask", () => {
    const [site] = findBlocks(`<div css=@@( disp )>x</div>`);

    expect(() => readBlock(`<div css=@@( disp )>x</div>`, site.open, "Card.tsx")).toThrow(CssBlockError);
  });
});

describe("a virtual file for an editor", () => {
  test("exists for a half-written block, which is when it is wanted", () => {
    const file = virtualFile(`const a = <div css=@@( disp )>x</div>;\n`, { tolerant: true });

    expect(file?.code).toContain("__block([{disp:");
  });

  test("and the strict one still refuses, so a build cannot get the tolerant reading by accident", () => {
    expect(() => virtualFile(`const a = <div css=@@( disp )>x</div>;\n`)).toThrow(CssBlockError);
  });
});

/**
 * A tolerant reading that never returns, which is the worst bug this package can have.
 *
 * ## The fault this exists for
 *
 * Tolerant is the mode an EDITOR runs, on every keystroke — so a reading that loops does not report
 * a wrong squiggle, it takes the language server with it and the file stops answering at all.
 *
 * Measured, and both are states you are in while typing: `&:hover { color: red;` with the block's
 * own `)` below it, and a stray `}` at the top of a block. `readHead` stops WITHOUT consuming
 * anything when it meets a `}`, a `)` or a `;` first, so the recovery pushed a declaration made of
 * nothing and went round again from the same character. Forever.
 *
 * The rule this pins is one sentence: **a recovery has to move.**
 */
describe("a reading that has to end", () => {
  test.each([
    ["a nested rule that was never closed", `&:hover { color: red;`],
    ["a stray closing brace", `color: red; }`],
    ["a stray brace and nothing else", `}`],
    ["a colon with no property", `: red;`],
    ["semicolons and nothing else", `;;;`],
    ["a brace that opens and never closes", `&:hover {`],
    ["everything at once", `} : ; &:hover { ) color: red;`],
  ])("%s is read and returns", (_what, css) => {
    const source = `<div css=@@(\n  ${css}\n)>x</div>`;
    const [site] = findBlocks(source);

    // The claim is that this line is reached at all. A loop here does not fail a test, it hangs it.
    expect(() => readBlock(source, site.open, "Card.tsx", { tolerant: true })).not.toThrow();
  });
});
