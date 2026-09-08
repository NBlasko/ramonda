import { describe, expect, test } from "vitest";
import { placehold } from "../compiler/tooling";
import { formatText } from "../tooling";

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
    <div css=@@(
      display: flex;
      border-left: {accent};
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
    const [before] = SOURCE.split("<div css=@@(");

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
    expect(out).toContain("border-left: {accent};");
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

    const block = out.slice(out.indexOf("<div css=@@("));
    expect(block).toContain("\t\t\tdisplay: flex;");
    expect(block).not.toContain("  display: flex;");
  });

  test("two blocks each go back to their own place", () => {
    const source = `const a = <div css=@@( display: flex; )>x</div>;\nconst b = <p css=@@( color: red; )>y</p>;\n`;
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
    const held = placehold(`const a = <div css=@@( display: flex;\n`);

    expect(held?.text).not.toContain("@(");
    expect(held?.restore(held.text)).toBe(`const a = <div css=@@( display: flex;\n`);
  });
});

describe("what it steps over", () => {
  test("a block found inside another is not placeheld twice", () => {
    const held = placehold(`const a = <div css=@@( color: { <b css=@@( color: red; )/> }; )>x</div>;\n`);

    expect(held?.text.match(/\/\*@ramonda-css:/g)).toHaveLength(1);
  });

  test("a file that already contains the marker gets a different one", () => {
    // It goes into the text the FORMATTER sees, so an author who happened to write it would get
    // somebody else's block back where theirs was.
    const source = `const m = "@ramonda-css:0";\nconst a = <div css=@@( display: flex; )>x</div>;\n`;
    const held = placehold(source);

    expect(held?.text).toContain(`"@ramonda-css:0"`);
    expect(held?.restore(held.text)).toBe(source);
  });
});

describe("the placeholder itself", () => {
  test("cannot collide with anything the author wrote", () => {
    // It goes into the file the FORMATTER sees, so an author who happened to write the same text
    // would get somebody else's block back. The name is built from what the file does not contain.
    const source = `const marker = "__ramondaCss0";\nconst a = <div css=@@( display: flex; )>x</div>;\n`;
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
 * loudest: a placeholder that swallowed the author's own `}` in `css={@@( … )}` left an extra one
 * behind, and biome refused the file for the very parse error the placeholder exists to avoid —
 * *"Code formatting aborted due to parsing errors"*, on a file that was correct.
 */
describe("a block written as a value", () => {
  test("the braced form leaves the author's braces where they are", () => {
    const held = placehold(`const a = <div id="x" css={@@( display: flex; )}>y</div>;\n`);

    expect(held?.text).toContain(`css={/*`);
    expect(held?.text).toContain(`}>y</div>`);
    expect(held?.text).not.toContain("}}");
  });

  test("and a block outside JSX keeps its own assignment", () => {
    const held = placehold(`const panel = @@( display: flex; );\n`);

    expect(held?.text).toMatch(/^const panel = \/\*@ramonda-css:0\*\/ 0;\n$/);
  });

  test.each([
    ["braced", `const a = <div id="x" css={@@( display: flex; )}>y</div>;\n`],
    ["outside JSX", `const panel = @@(\n  display: flex;\n);\n`],
    ["a bare attribute", `const a = <div css=@@( display: flex; )>y</div>;\n`],
  ])("%s comes back exactly as it went in", (_what, source) => {
    const held = placehold(source);

    expect(held?.restore(held.text)).toBe(source);
  });
});

/**
 * The CSS inside a block, laid out.
 *
 * ## What changed and why
 *
 * For a long time the answer was "the block's inside is the author's and is not re-laid at all",
 * which was defensible while nothing could parse it. It stopped being defensible once a formatter
 * ran on save: `&:hover { color: red; gap: 8px; }` stayed on one line however long it grew, and a
 * blank line came back with the block's indentation on it — trailing whitespace, which is the one
 * thing every formatter removes.
 *
 * ## The two rules
 *
 * **A one-line block stays one line.** `css=@@( display: flex; )` is a deliberate shape and breaking
 * it would be the formatter having an opinion about the markup.
 *
 * **A block already written across lines is laid out fully:** one declaration per line, a nested
 * rule's body one step in, and its `}` back out.
 *
 * ## What it must not touch
 *
 * A comment, because the PARSER drops them — measured, a block comment is not in the AST at all — so a
 * layout built from the parse would delete the author's own notes. This works on the text.
 *
 * And anything inside a hole, a string, `url( … )` or a function: a `;` or a `{` in one of those is
 * not structure, and treating it as structure is how a formatter breaks working code.
 */
describe("the CSS inside a block", () => {
  const laid = (source: string) => {
    const held = placehold(source);
    // The formatter is not run: what is asserted is the LAYOUT, which is `restore`'s half.
    return held?.restore(held.text);
  };

  test("a nested rule's body goes to its own line, one step in", () => {
    const out = laid(`const a = <div css={@@(\n  color: red;\n  &:hover { color: blue; gap: 8px; }\n)}>x</div>;\n`);

    expect(out).toBe(
      `const a = <div css={@@(\n  color: red;\n  &:hover {\n    color: blue;\n    gap: 8px;\n  }\n)}>x</div>;\n`,
    );
  });

  test("and a rule inside a rule goes two steps in", () => {
    const out = laid(`const a = <div css={@@(\n  &:hover { & .title { color: red; } }\n)}>x</div>;\n`);

    expect(out).toBe(
      `const a = <div css={@@(\n  &:hover {\n    & .title {\n      color: red;\n    }\n  }\n)}>x</div>;\n`,
    );
  });

  test("a blank line is kept and carries no whitespace", () => {
    const out = laid(`const a = <div css={@@(\n  color: red;\n\n\n  gap: 8px;\n)}>x</div>;\n`);

    expect(out).toBe(`const a = <div css={@@(\n  color: red;\n\n  gap: 8px;\n)}>x</div>;\n`);
  });

  test("a one-line block is left alone", () => {
    const source = `const a = <div css={@@( display: flex; )}>x</div>;\n`;

    expect(laid(source)).toBe(source);
  });

  test.each([
    ["a hole", `  color: {a ? "red" : "blue"};`],
    ["a hole holding braces", `  color: { {a: 1}.a };`],
    ["a url with a semicolon", `  background: url("a;b.png");`],
    ["a quoted brace", `  content: "}";`],
    ["a function", `  width: calc(100% - 8px);`],
  ])("%s is not structure", (_what, declaration) => {
    const out = laid(`const a = <div css={@@(\n${declaration}\n)}>x</div>;\n`);

    expect(out).toBe(`const a = <div css={@@(\n${declaration}\n)}>x</div>;\n`);
  });

  /**
   * Whitespace inside a value, which is the other half of laying one out. `4px     0   ;` is one
   * declaration written loosely, and a formatter that fixed the indentation and left that alone
   * would be doing half the job.
   *
   * Runs are COLLAPSED, never added: removing whitespace is safe and adding it is an opinion —
   * `rgb(1,2,3)` is the author's spacing to keep, not this one's to improve.
   */
  test.each([
    ["a run between values", `  padding: 4px     0;`, `  padding: 4px 0;`],
    ["a run before the semicolon", `  padding: 4px 0   ;`, `  padding: 4px 0;`],
    ["a tab", `  padding:\t4px\t0;`, `  padding: 4px 0;`],
    [
      "a value wrapped over two lines",
      `  transition: color 150ms,\n    background 150ms;`,
      `  transition: color 150ms, background 150ms;`,
    ],
  ])("%s is collapsed", (_what, written, expected) => {
    expect(laid(`const a = <div css={@@(\n${written}\n)}>x</div>;\n`)).toBe(
      `const a = <div css={@@(\n${expected}\n)}>x</div>;\n`,
    );
  });

  test.each([
    ["a string", `  grid-template-areas: "a   a" "b   b";`],
    ["a hole holding an object", `  color: { {a: {b: 1}}.a.b };`],
    ["a hole whose expression ends in a brace", `  color: {{ x["}"] }};`],
    ["a comment", `  /* two  spaces */`],
  ])("%s keeps its own spacing", (_what, written) => {
    expect(laid(`const a = <div css={@@(\n${written}\n)}>x</div>;\n`)).toBe(
      `const a = <div css={@@(\n${written}\n)}>x</div>;\n`,
    );
  });

  /**
   * A hole's own spacing is its expression's, and the BRACES are not part of the expression.
   *
   * The whitespace inside `a  ?  "red"` is the author's and stays; the whitespace between `{` and
   * `a` is a delimiter's and is closed up, because a hole is the escape JSX already uses in the same
   * place and JSX writes it tight. See `tightened`, and the one shape that keeps its space above.
   */
  test("a hole keeps the spacing inside its expression, and loses it at the braces", () => {
    expect(laid(`const a = <div css={@@(\n  color: { a  ?  "red"  :  "blue" };\n)}>x</div>;\n`)).toBe(
      `const a = <div css={@@(\n  color: {a  ?  "red"  :  "blue"};\n)}>x</div>;\n`,
    );
  });

  /**
   * A comment survives — the parser drops them, so a layout built from the parse would delete the
   * author's notes — and it survives WHERE IT WAS. Measured before this was fixed: a block comment on
   * its own line came back glued to the declaration below it, which is the one thing a note above a
   * declaration must not become.
   */
  test.each([
    [
      "on its own line, stays on its own line",
      `const a = <div css={@@(\n  /* why */\n  color: red;\n)}>x</div>;\n`,
      `const a = <div css={@@(\n  /* why */\n  color: red;\n)}>x</div>;\n`,
    ],
    [
      "at the end of a declaration, stays there",
      `const a = <div css={@@(\n  color: red; /* the brand */\n)}>x</div>;\n`,
      `const a = <div css={@@(\n  color: red; /* the brand */\n)}>x</div>;\n`,
    ],
    [
      "above a nested rule, stays above it",
      `const a = <div css={@@(\n  /* why */\n  &:hover { color: red; }\n)}>x</div>;\n`,
      `const a = <div css={@@(\n  /* why */\n  &:hover {\n    color: red;\n  }\n)}>x</div>;\n`,
    ],
    [
      "inside a nested rule, one step in",
      `const a = <div css={@@(\n  &:hover {\n    /* why */\n    color: red;\n  }\n)}>x</div>;\n`,
      `const a = <div css={@@(\n  &:hover {\n    /* why */\n    color: red;\n  }\n)}>x</div>;\n`,
    ],
  ])("a comment %s", (_what, written, expected) => {
    expect(laid(written)).toBe(expected);
  });

  /** The property nobody notices until it is missing: running it twice changes nothing. */
  test("laying out what is already laid out changes nothing", () => {
    const once = laid(`const a = <div css={@@(\n  &:hover { color: red; }\n)}>x</div>;\n`) as string;

    expect(laid(once)).toBe(once);
  });
});

/**
 * A named site — `@@keyframes( … )` and its two siblings — through the same machinery.
 *
 * The opening is longer than `@@(` and that is the whole of what could go wrong here: everything
 * downstream is told where the block's TEXT starts, and an opening measured as a fixed width lands
 * in the middle of the at-rule's name. Measured before this was written: it did.
 */
describe("a named site", () => {
  const NAMED = `const slide = @@keyframes(\n  from { opacity: 0; }\n  to { opacity: 1; }\n);\n`;

  test("the block handed to the formatter starts at the opening, name and all", () => {
    const held = placehold(NAMED);

    expect(held?.blocks).toHaveLength(1);
    expect(held?.blocks[0].startsWith("@@keyframes(")).toBe(true);
    expect(held?.blocks[0]).toContain("from { opacity: 0; }");
  });

  /**
   * Restoring LAYS OUT — that is the whole job — so a frame written on one line comes back opened
   * up, exactly as a nested rule does. What has to hold is that the second pass changes nothing:
   * a formatter that keeps moving text on every save is one nobody leaves switched on.
   */
  test("and what it stands in for comes back laid out, and stays put on the next pass", () => {
    const once = placehold(NAMED)!;
    const formatted = once.restore(once.text);

    expect(formatted).toContain("@@keyframes(");
    expect(formatted).toContain("opacity: 0;");

    const twice = placehold(formatted)!;
    expect(twice.restore(twice.text)).toBe(formatted);
  });

  test("a named site and an ordinary one in the same file each keep their own opening", () => {
    const both = `const slide = @@keyframes( from { opacity: 0; } );\nconst panel = @@( display: flex; );\n`;
    const held = placehold(both);

    expect(held?.blocks[0].startsWith("@@keyframes(")).toBe(true);
    expect(held?.blocks[1].startsWith("@@(")).toBe(true);

    const formatted = held!.restore(held!.text);
    expect(formatted).toContain("const slide = @@keyframes(");
    expect(formatted).toContain("const panel = @@(");
  });
});

/**
 * A file whose lines end `\r\n`, which is what a Windows checkout gives every tool that opens it.
 *
 * Restoring LAYS OUT, and laying out means splitting a block into lines and putting them back. The
 * first version split on `\n` and joined on `\n`, so every line of every block body lost its `\r` —
 * measured with an identity formatter, which is the way to see this at all: whatever biome does to
 * the rest of the file, a block coming back with different line endings than it went in with is
 * ours. The file then has mixed endings inside each block, which is a diff on every line and a lint
 * failure in most setups.
 */
describe("line endings the author's checkout uses", () => {
  /** The formatter that changes nothing, so anything that changed is this package's doing. */
  const identity = (text: string) => text;

  test("a block in a CRLF file comes back CRLF", () => {
    const source = "const a = 1;\r\nconst p = @@(\r\n  display: flex;\r\n  gap: 8px;\r\n);\r\n";

    expect(formatText(source, "X.tsx", identity)).toBe(source);
  });

  test("and a block in an LF file is left alone too", () => {
    const source = "const a = 1;\nconst p = @@(\n  display: flex;\n  gap: 8px;\n);\n";

    expect(formatText(source, "X.tsx", identity)).toBe(source);
  });

  test("a CRLF block that needs laying out keeps the endings it had", () => {
    const source = "const p = @@(\r\n      display:flex;\r\n  gap:8px;\r\n);\r\n";
    const formatted = formatText(source, "X.tsx", identity);

    expect(formatted).not.toBe(source);
    // Every newline is still a CRLF, and the over-indented line was brought back into line.
    expect(formatted).not.toMatch(/[^\r]\n/);
    expect(formatted).toContain("\r\n  display:flex;\r\n");
  });
});

/**
 * A hole's braces sit against its expression, whatever was typed.
 *
 * **Reported by a user**: the formatter left `@@if ({ this.roomy})` exactly as written, so the same
 * condition appeared four ways in one file. Measured, all four survived a format unchanged.
 *
 * ## Why against, and not `{ … }`
 *
 * A hole is the escape JSX already uses in the same place — `css={@@( … )}`, `{this.tone}` — and
 * JSX writes it against the braces. An object literal's spacing is a different convention for a
 * different thing; this is a delimiter, not a literal.
 *
 * The whitespace immediately inside the braces is not part of the expression, so trimming it changes
 * nothing about what runs. **Except in one shape, which is why the rule has a condition**: an
 * expression that itself begins with `{` — `{ {a: 1}.a }` — would become `{{a: 1}.a}`, and a reader
 * meeting `{{` in a language that spelled holes `{{ }}` until this morning deserves better. The
 * space stays there.
 */
describe("the space inside a hole's braces", () => {
  /** The block's own lines, without the `const s = @@(` around them. */
  const formatted = (block: string) => {
    const out = formatText(`const s = @@(\n${block}\n);\n`, "C.tsx", (text) => text);
    const lines = out.split("\n");
    return lines.slice(1, lines.indexOf(");")).join("\n");
  };

  test.each([
    ["a condition", "  @@if ({ this.roomy }) {\n    color: red;\n  }", "  @@if ({this.roomy}) {\n    color: red;\n  }"],
    [
      "one space, on the left only",
      "  @@if ({ this.roomy }) {\n    color: red;\n  }",
      "  @@if ({this.roomy}) {\n    color: red;\n  }",
    ],
    ["a value", "  color: { this.accent };", "  color: {this.accent};"],
    ["a spread", "  ...{ base };", "  ...{base};"],
    ["a property name", "  { accent }: red;", "  {accent}: red;"],
    ["already tight, left alone", "  color: {this.accent};", "  color: {this.accent};"],
  ])("%s", (_what, written, expected) => {
    expect(formatted(written)).toBe(expected);
  });

  test("an expression that starts with a brace keeps its space", () => {
    expect(formatted("  color: { {a: 1}.a };")).toBe("  color: { {a: 1}.a };");
  });

  test("and a template literal inside is untouched", () => {
    expect(formatted("  padding: { `${n}px` };")).toBe("  padding: {`${n}px`};");
  });

  /** Formatting is idempotent, which is the property a formatter is only ever trusted for once. */
  test("running it twice changes nothing more", () => {
    const once = formatted("  @@if ({ this.roomy }) {\n    color: red;\n  }");
    const twice = formatted(once);

    expect(twice).toBe(once);
  });
});

/**
 * How far one level in is, which was a constant two spaces whatever the file did.
 *
 * The config had a `format: { indent }` for this and NOBODY READ IT — accepted, validated,
 * documented in its own type, and wired to nothing. A review found it. Removing it is the fix
 * rather than wiring it up, because this page's promise is that a block comes back "at the
 * indentation the tool chose": the project already tells biome or prettier how wide a level is, and
 * a second place to say it can only ever disagree with the first.
 *
 * So the step is read off the formatter's own output — the narrowest indentation in the file it
 * just laid out — instead of being either guessed at or asked for twice.
 */
describe("how wide a level inside a block is", () => {
  const identity = (text: string) => text;

  test("four, in a file the formatter indents by four", () => {
    const source =
      "function a() {\n    const p = @@(\n    display: flex;\n    &:hover {\n    color: red;\n    }\n    );\n}\n";

    expect(formatText(source, "X.tsx", identity)).toBe(
      "function a() {\n    const p = @@(\n        display: flex;\n        &:hover {\n            color: red;\n        }\n    );\n}\n",
    );
  });

  test("two, in a file it indents by two", () => {
    const source = "function a() {\n  const p = @@(\n  display: flex;\n  &:hover {\n  color: red;\n  }\n  );\n}\n";

    expect(formatText(source, "X.tsx", identity)).toBe(
      "function a() {\n  const p = @@(\n    display: flex;\n    &:hover {\n      color: red;\n    }\n  );\n}\n",
    );
  });

  /** A tabbed file keeps tabs — a block re-laid with spaces inside one is an edit that never settles. */
  test("a tab, in a tabbed file", () => {
    const source = "function a() {\n\tconst p = @@(\n\tdisplay: flex;\n\t);\n}\n";

    expect(formatText(source, "X.tsx", identity)).toBe(
      "function a() {\n\tconst p = @@(\n\t\tdisplay: flex;\n\t);\n}\n",
    );
  });

  /** Nothing to read it off — a block at the left margin in a file with no indentation at all. */
  test("two, when the file says nothing either way", () => {
    const source = "const p = @@(\ndisplay: flex;\n);\n";

    expect(formatText(source, "X.tsx", identity)).toBe("const p = @@(\n  display: flex;\n);\n");
  });
});
