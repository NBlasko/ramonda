import { describe, expect, test } from "vitest";
import { placehold } from "../compiler/tooling";

/**
 * What a formatter can be given, and what comes back.
 *
 * ## Why a placeholder rather than a map
 *
 * The linter gets the virtual file and its diagnostics are mapped home, exactly as `tsc`'s are. A
 * formatter cannot work that way: it **rewrites text** rather than reporting positions in it, so
 * there is nothing to map. The block is replaced by something that parses, the file is formatted
 * normally, and the block is put back where the placeholder was.
 *
 * ## And a suppression comment cannot substitute for either
 *
 * `biome-ignore` and `oxlint-disable` are read BY the parser, which has already failed. Measured:
 * biome answers *"Code formatting aborted due to parsing errors"* with the comments in place. That
 * is also what makes the comparison with a CSS-in-a-backtick library misleading — a tagged template
 * is already valid TypeScript, so the tool parses the file, sees a string and looks no further.
 * Here there is no region to ignore, because there is no region at all.
 */

const SOURCE = `export const Card = (props: { id: string }) => {
  const accent = "#10b981";
  return (
    <div css=@(
      display: flex;
      border-left: {{accent}};
    )>
      <span>{props.id}</span>
    </div>
  );
};
`;

describe("what the formatter is given", () => {
  test("parses, which is the whole requirement", () => {
    const held = placehold(SOURCE);

    expect(held?.text).not.toContain("@(");
    expect(held?.text).toContain("css={");
  });

  test("a file with no block is left entirely alone", () => {
    expect(placehold(`const a = <div>x</div>;\n`)).toBeUndefined();
  });

  test("a decorator is not a block, so that file is left alone too", () => {
    expect(placehold(`class C {\n  @(dec) m() {}\n}\n`)).toBeUndefined();
  });

  test("everything outside the block is untouched, byte for byte", () => {
    const held = placehold(SOURCE);
    const [before] = SOURCE.split("<div css=@(");

    expect(held?.text.startsWith(before)).toBe(true);
    expect(held?.text.endsWith("</div>\n  );\n};\n")).toBe(true);
  });
});

describe("what comes back", () => {
  /** A formatter that does something visible, so "unchanged" cannot pass by accident. */
  const reindent = (text: string) => text.replace(/^ {2}/gm, "    ");

  test("the block is put back, and its own text is unchanged", () => {
    const held = placehold(SOURCE);
    const out = held?.restore(reindent(held.text));

    expect(out).toContain("display: flex;");
    expect(out).toContain("border-left: {{accent}};");
  });

  test("and the formatter's own work outside the block survives", () => {
    const held = placehold(SOURCE);
    const out = held?.restore(reindent(held.text)) ?? "";

    expect(out).toContain(`    const accent = "#10b981";`);
  });

  /**
   * **The formatter's own indentation is copied, never counted.** A formatter may have chosen tabs,
   * and a block re-laid with spaces inside a tabbed file is a file the formatter will disagree with
   * on the next run — an edit that never settles.
   */
  test("the block takes the indentation the formatter chose, tabs included", () => {
    const held = placehold(SOURCE);
    const tabbed = (held?.text ?? "").replace(/^ +/gm, (spaces) => "\t".repeat(spaces.length / 2));
    const out = held?.restore(tabbed) ?? "";

    const block = out.slice(out.indexOf("<div css=@("));
    expect(block).toContain("\t\t\tdisplay: flex;");
    expect(block).not.toContain("  display: flex;");
  });

  test("two blocks each go back to their own place", () => {
    const source = `const a = <div css=@( display: flex; )>x</div>;\nconst b = <p css=@( color: red; )>y</p>;\n`;
    const held = placehold(source);

    expect(held?.restore(held.text)).toBe(source);
  });

  test("a formatter that changed nothing gives the file back exactly", () => {
    const held = placehold(SOURCE);

    expect(held?.restore(held.text)).toBe(SOURCE);
  });

  /**
   * A block that is half written is placeheld too. A formatter is the tool most likely to be run on
   * a file mid-edit — save on keystroke — and refusing there would be refusing whenever it matters.
   */
  test("a block that is not closed yet is still placeheld", () => {
    const held = placehold(`const a = <div css=@( display: flex;\n`);

    expect(held?.text).not.toContain("@(");
    expect(held?.restore(held.text)).toBe(`const a = <div css=@( display: flex;\n`);
  });
});

describe("what it steps over", () => {
  test("a block found inside another is not placeheld twice", () => {
    const held = placehold(`const a = <div css=@( color: {{ <b css=@( color: red; )/> }}; )>x</div>;\n`);

    expect(held?.text.match(/\/\*@ramonda-css:/g)).toHaveLength(1);
  });

  test("a file that already contains the marker gets a different one", () => {
    // It goes into the text the FORMATTER sees, so an author who happened to write it would get
    // somebody else's block back where theirs was.
    const source = `const m = "@ramonda-css:0";\nconst a = <div css=@( display: flex; )>x</div>;\n`;
    const held = placehold(source);

    expect(held?.text).toContain(`"@ramonda-css:0"`);
    expect(held?.restore(held.text)).toBe(source);
  });
});

describe("the placeholder itself", () => {
  test("cannot collide with anything the author wrote", () => {
    // It goes into the file the FORMATTER sees, so an author who happened to write the same text
    // would get somebody else's block back. The name is built from what the file does not contain.
    const source = `const marker = "__ramondaCss0";\nconst a = <div css=@( display: flex; )>x</div>;\n`;
    const held = placehold(source);

    expect(held?.restore(held.text)).toBe(source);
  });

  test("and is a valid expression, so no rule reports the file for holding it", () => {
    const held = placehold(SOURCE);
    const inside = (held?.text ?? "").match(/css=\{([^}]*)\}/)?.[1] ?? "";

    // A number, not an identifier: an identifier would be an unresolved name and the linter would
    // report the file for something this put there.
    expect(inside).toMatch(/\d/);
  });
});

/**
 * The two spellings that are a value, through the placeholder.
 *
 * The placeholder has to own exactly what the transform owns, and this is where getting it wrong is
 * loudest: a placeholder that swallowed the author's own `}` in `css={@( … )}` left an extra one
 * behind, and biome refused the file for the very parse error the placeholder exists to avoid —
 * *"Code formatting aborted due to parsing errors"*, on a file that was correct.
 */
describe("a block written as a value", () => {
  test("the braced form leaves the author's braces where they are", () => {
    const held = placehold(`const a = <div id="x" css={@( display: flex; )}>y</div>;\n`);

    expect(held?.text).toContain(`css={/*`);
    expect(held?.text).toContain(`}>y</div>`);
    expect(held?.text).not.toContain("}}");
  });

  test("and a block outside JSX keeps its own assignment", () => {
    const held = placehold(`const panel = @( display: flex; );\n`);

    expect(held?.text).toMatch(/^const panel = \/\*@ramonda-css:0\*\/ 0;\n$/);
  });

  test.each([
    ["braced", `const a = <div id="x" css={@( display: flex; )}>y</div>;\n`],
    ["outside JSX", `const panel = @(\n  display: flex;\n);\n`],
    ["a bare attribute", `const a = <div css=@( display: flex; )>y</div>;\n`],
  ])("%s comes back exactly as it went in", (_what, source) => {
    const held = placehold(source);

    expect(held?.restore(held.text)).toBe(source);
  });
});
