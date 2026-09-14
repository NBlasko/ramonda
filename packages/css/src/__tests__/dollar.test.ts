import { describe, expect, test } from "vitest";
import type { Declaration, ValuePart } from "../compiler/ast";
import { readBlock } from "../compiler/read";
import { findBlocks } from "../compiler/scan";
import { transform } from "../compiler/transform";
import { virtualFile } from "../compiler/virtual";

/**
 * `$.color.primary.main` in a block — the spelling for a variable the project DECLARED.
 *
 * It reaches the AST as its own kind of part rather than as resolved text, and that is the decision
 * the rest of the feature rests on. A `@@property` reference becomes `TextPart` with `resolved: true`
 * because nothing downstream needs the author's spelling of it again. This is the opposite: the
 * virtual file has to emit `$.color.primary.main` as a REAL TypeScript expression, which is where
 * completion and type checking come from, so the path and its span must survive the parse.
 *
 * The parser resolves nothing. A path is text until something that has read the config says what it
 * names — so this file only asks what was read, never what it means.
 */

/** The parts of the first declaration's value, for a block written as one line. */
function parts(css: string): readonly ValuePart[] {
  const source = `<div css={@@(\n${css}\n)}>x</div>`;
  const [site] = findBlocks(source);
  const { block } = readBlock(source, site.open, "Card.tsx", { tolerant: true });
  const [first] = block.items;
  return (first as Declaration).value;
}

const shapes = (css: string) => parts(css).map((one) => (one.kind === "variable" ? `$${one.path}` : one.kind));

describe("reading `$` in a value", () => {
  test("a path on its own is one variable part and nothing else", () => {
    // No leading `text`: the reader skips the trivia after the colon, so the value STARTS here.
    expect(shapes("color: $.color.primary.main;")).toEqual(["$color.primary.main"]);
  });

  test("it keeps the path only — resolving is somebody else's question", () => {
    const [variable] = parts("color: $.color.primary.main;");

    expect(variable).toMatchObject({ kind: "variable", path: "color.primary.main" });
  });

  test("a segment that is not an identifier is allowed, because the block is our grammar", () => {
    expect(shapes("padding: $.space.inline.2xl;")).toEqual(["$space.inline.2xl"]);
    expect(shapes("z-index: $.layer.0;")).toEqual(["$layer.0"]);
  });

  test("it works inside a call, which is where half the real uses are", () => {
    expect(shapes("width: calc($.size.control.md * 2);")).toEqual(["text", "$size.control.md", "text"]);
  });

  test("more than one in a value, each its own part", () => {
    expect(shapes("border: 1px solid $.color.border.strong;")).toEqual(["text", "$color.border.strong"]);
    expect(shapes("margin: $.space.sm $.space.lg;")).toEqual(["$space.sm", "text", "$space.lg"]);
  });

  test("a bare `$` is text, because CSS may hold one and nothing is being named", () => {
    expect(shapes('content: "$";')).toEqual(["text"]);
    expect(shapes("grid-template-areas: $;")).toEqual(["text"]);
  });

  test("`$.` with nothing after it is STILL a variable part, which is what completion needs", () => {
    // Half-typed is the common state in an editor. A part with an empty path is what gives the
    // virtual file somewhere to put the caret; text here would mean no completion after the dot.
    expect(shapes("color: $.;")).toEqual(["$"]);
  });

  test("the span is the author's, so a squiggle lands on the path", () => {
    const source = `<div css={@@(\ncolor: $.color.primary.main;\n)}>x</div>`;
    const [site] = findBlocks(source);
    const { block } = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    const [variable] = (block.items[0] as Declaration).value.filter((one) => one.kind === "variable");

    expect(source.slice(variable.at, (variable.at ?? 0) + (variable.length ?? 0))).toBe("$.color.primary.main");
  });
});

describe("what `$` compiles to", () => {
  /** Every emitted rule's body, joined — the stylesheet this block produced. */
  const css = (block: string) => {
    const result = transform(`const a = <div css={@@( ${block} )}>x</div>;\n`, { filename: "Card.tsx" });
    if (result === undefined) throw new Error("the transform found no block");
    return result.blocks.map((one) => one.css).join("\n");
  };

  /** The class names, which is what "two blocks share a class" is actually asking about. */
  const classes = (block: string) => {
    const result = transform(`const a = <div css={@@( ${block} )}>x</div>;\n`, { filename: "Card.tsx" });
    return (result?.blocks ?? []).map((one) => one.className);
  };

  /**
   * **A plain `var()`, with no fallback, and no config read to compile it.**
   *
   * This corrects what `DESIGN.md` first said. An inline fallback looked like the thing that made
   * the value certain, and the measurement says the REGISTRATION is stronger: a variable registered
   * with `@property { initial-value }` and set by nothing at all still resolves.
   *
   *     registered, never set anywhere      `height: var(--x)`   ->  "30px"
   *     unregistered, never set             `height: var(--x)`   ->  "0px"   silently wrong
   *
   * So the guarantee lives in the stylesheet codegen writes, once, rather than in every use — and
   * the compiler needs no config to emit a `$`, which is why the CLI, the bundler and the editor
   * cannot disagree about it. What still needs the config is the CHECKER, which is where a path
   * that names nothing is reported.
   */
  test("a path becomes the custom property it names", () => {
    expect(css("color: $.color.primary.main;")).toContain("var(--color-primary-main)");
  });

  test("a segment that is not an identifier survives into the name", () => {
    expect(css("padding: $.space.inline.2xl;")).toContain("var(--space-inline-2xl)");
  });

  test("inside a call, and beside other text", () => {
    expect(css("width: calc($.size.control.md * 2);")).toContain("calc(var(--size-control-md) * 2)");
  });

  test("it is NOT a hole — nothing lands on the element", () => {
    const result = transform(`const a = <div css={@@( color: $.color.primary.main; )}>x</div>;\n`, {
      filename: "Card.tsx",
    });

    // A hole compiles to a value carried beside the class. A variable compiles to text in the
    // stylesheet, so the element carries a class and nothing else.
    expect(result?.code).not.toContain("--r-");
  });

  test("two blocks writing one variable share a class; two different ones do not", () => {
    expect(classes("color: $.color.primary.main;")).toEqual(classes("color: $.color.primary.main;"));
    expect(classes("color: $.color.primary.main;")).not.toEqual(classes("color: $.color.primary.light;"));
  });
});

describe("what the virtual file makes of it", () => {
  const code = (block: string) => {
    const built = virtualFile(`const a = <div css={@@( ${block} )}>x</div>;\n`, { properties: "./properties" });
    if (built === undefined) throw new Error("the virtual file found no block");
    return built.code;
  };

  /**
   * The point of the whole spelling. A path becomes a REAL member expression, so the language
   * service answers completion, the kind, go-to-definition and rename without any of it being
   * implemented here.
   */
  test("a path alone is written BARE, so the property's own type judges it", () => {
    // Wrapped in a template literal it would be a `string` and `color` would have nothing left to
    // check. Bare, the kind check comes for free — the same reason one hole is written bare.
    expect(code("color: $.color.primary.main;")).toContain("{color:$.color.primary.main}");
  });

  test("`$` is ordinary scope — nothing is declared for it", () => {
    // A project that has not imported `$` is told `Cannot find name '$'`, which is a sentence
    // anybody can act on. Inventing a binding here would be one no other tool agrees about.
    expect(code("color: $.color.primary.main;")).not.toContain("declare const $");
  });

  test("a segment that is not an identifier is bracketed, because THIS half must parse", () => {
    expect(code("padding: $.space.inline.2xl;")).toContain('$.space.inline["2xl"]');
    expect(code("z-index: $.layer.0;")).toContain('$.layer["0"]');
  });

  test("a half-typed path is still an expression, which is what completion needs", () => {
    expect(code("color: $.;")).toContain("{color:$}");
  });

  test("mixed with text it is one template literal, exactly as a hole is", () => {
    // The space before the expression is folded away, which is what happens to a hole in the same
    // position — `1px solid${__val((accent))}` — so this matches the existing behaviour rather than
    // asserting a nicer one. The EMITTED CSS keeps the space; only the virtual file folds it.
    expect(code("border: 1px solid $.color.border.strong;")).toContain("`1px solid${$.color.border.strong}`");
  });
});
