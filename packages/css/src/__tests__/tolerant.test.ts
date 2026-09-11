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
    const { block } = read(`<div css=@@( {name}24px; )>x</div>`, true);

    expect(block.items).toMatchObject([{ kind: "declaration" }]);
  });
});

describe("what strict still refuses, because a build has no correct answer", () => {
  test.each([
    ["a property with no colon", `<div css=@@( disp )>x</div>`],
    ["a block with no closing paren", `<div css=@@( display: flex;\n`],
    ["a hole with no closing braces", `<div css=@@( color: {{accent`],
    ["a hole as a property name", `<div css=@@( {name}; )>x</div>`],
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

/**
 * WHERE a refusal points, which was one column further right for every space after the word.
 *
 * `at - property.length` measured the TRIMMED name's length back from a position already past the
 * whitespace after it. A review found it. A diagnostic's column is the character an author has to
 * move to, so being right about it is the rule's whole value.
 */
describe("the column a refusal names", () => {
  const columnOf = (source: string) => {
    try {
      readBlock(source, 2, "C.tsx");
    } catch (error) {
      return (error as { column?: number }).column;
    }
    return undefined;
  };

  test.each([
    ["with nothing after it", `@@( disp)`],
    ["with a space after it", `@@( disp )`],
    ["with several", `@@( disp   )`],
    ["with a space and a semicolon", `@@( disp ;)`],
    ["with a newline after it", `@@( disp\n)`],
  ])("a property that is not a declaration, %s", (_what, source) => {
    // Column 5 in every one of them: `@@( ` is four characters, and 1-based counting puts `disp` at 5.
    expect(columnOf(source)).toBe(5);
  });
});

/**
 * TWO THINGS THE STRICT READ REFUSES AND THE TOLERANT ONE DOES NOT.
 *
 * The split matters more than either: an editor reads on every keystroke, so `color: ` with nothing
 * typed after it is the state it is in most and must stay quiet. A BUILD has the finished text and
 * can say what a browser will do with it.
 */
describe("what only the strict read refuses", () => {
  const strict = (css: string) => {
    const source = `const x = <div css=@@(\n${css}\n)>y</div>;`;
    const [site] = findBlocks(source);
    return () => readBlock(source, site.open, "C.tsx");
  };
  const tolerant = (css: string) => {
    const source = `const x = <div css=@@(\n${css}\n)>y</div>;`;
    const [site] = findBlocks(source);
    return readBlock(source, site.open, "C.tsx", { tolerant: true });
  };
  /** A literal U+0000, written by code point so no source file has to carry one. */
  const NUL = String.fromCharCode(0);

  /**
   * A declaration with a colon and nothing after it. A review found it compiling: it emitted
   * `.r-x { color:; }`, which no browser accepts, on a class still written into the markup — so the
   * element carried a class whose rule did nothing.
   */
  describe("a value that is empty", () => {
    test.each([
      ["nothing after the colon", "  color: ;"],
      ["not even a space", "  color:;"],
      ["only whitespace", "  color:   \t ;"],
      ["inside a nested rule", "  &:hover {\n    color: ;\n  }"],
      ["at the end of a block", "  color: "],
    ])("%s is refused", (_what, css) => {
      expect(strict(css)).toThrow(/has no value/);
    });

    test("and the tolerant read keeps it, because that is a value being typed", () => {
      const [item] = tolerant("  color: ;").block.items;

      expect(item.kind).toBe("declaration");
      expect(item.kind === "declaration" && item.value).toEqual([]);
    });

    test.each([
      ["an ordinary value", "  color: red;"],
      ["a hole", "  color: {accent};"],
      ["a spread, which has no value by design", "  ...{base};"],
      ["a zero", "  opacity: 0;"],
    ])("%s is fine", (_what, css) => {
      expect(strict(css)).not.toThrow();
    });
  });

  /**
   * A literal `U+0000`, which the hole placeholder is made of.
   *
   * `normalise`'s note used to say an author could not write one, because CSS preprocessing turns it
   * into U+FFFD — and a block is read out of a TypeScript file, where nothing preprocesses it as
   * CSS. Measured before this: a block carrying two of them shared an identity, and a class, with a
   * block carrying a real hole.
   *
   * Refused rather than escaped: it is a control character with no meaning in CSS, so there is
   * nothing to preserve, and refusing keeps the placeholder unforgeable by construction.
   */
  describe("a literal NUL", () => {
    test.each([
      ["in a value", `  --x: ${NUL}0${NUL};`],
      ["in a property name", `  co${NUL}lor: red;`],
      ["inside a string", `  content: "a${NUL}b";`],
      ["in a selector", `  &:hov${NUL}er { color: red; }`],
    ])("%s is refused", (_what, css) => {
      expect(strict(css)).toThrow(/NUL/);
    });

    test("and an ordinary block is untouched", () => {
      expect(strict("  color: red;")).not.toThrow();
    });
  });
});
