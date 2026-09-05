import { describe, expect, test } from "vitest";
import { findBlocks, mayHoldABlock } from "../compiler/scan";

/**
 * The scan, on the code it is most likely to be wrong about.
 *
 * `transform.test.ts` covers what a block becomes. This covers the walk that decides what a block IS
 * — the part where an ordinary file can look like one, and where getting it wrong means silently
 * rewriting somebody's source.
 */

const names = (source: string) => findBlocks(source).map((site) => site.name);

describe("the cheap question, asked first", () => {
  test("a file with none of the characters is answered without reading it", () => {
    expect(mayHoldABlock("const a = 1;\n")).toBe(false);
    expect(mayHoldABlock("<div css=@@( display: flex; )>x</div>")).toBe(true);
  });

  /**
   * The cheap pass used to say maybe for every decorator, which is what a second `@` bought.
   *
   * Measured on this repository while the opening was `@(`: the substring matched **41** files and
   * two of them held a block. The other thirty-nine were decorators, each paying a full lexical walk
   * for nothing — on every file of every build. `@@(` is not valid TypeScript anywhere, so the cheap
   * question is now nearly the right one, and the second pass is what settles a string or a comment.
   */
  test("a decorator does not even reach the second pass", () => {
    expect(mayHoldABlock("class C { @(dec) m() {} }")).toBe(false);
    expect(mayHoldABlock("class C { constructor(@(inject()) private x: number) {} }")).toBe(false);
    expect(findBlocks("class C { @(dec) m() {} }")).toEqual([]);
  });
});

describe("what the walk steps over", () => {
  test("an escaped quote does not end the string it is in", () => {
    expect(findBlocks(`const s = "a \\" css=@@( display: flex; )";\n`)).toEqual([]);
  });

  test("an unterminated string ends at the newline, so the rest of the file is still read", () => {
    // Running an unterminated string to the end of the module would hide every block below it.
    expect(names(`const s = "oops;\nconst a = <div css=@@( display: flex; )>x</div>;\n`)).toEqual(["css"]);
  });

  test("a substitution is code, and a block inside one is still not an attribute", () => {
    expect(findBlocks("const s = `a ${ { x: `css=@@( display: flex; )` } } b`;\n")).toEqual([]);
  });

  test("a template nested in a substitution closes at its own backtick", () => {
    expect(names("const s = `${ `${ `inner` }` }`;\nconst a = <div css=@@( color: red; )>x</div>;\n")).toEqual(["css"]);
  });

  test("an escaped backtick does not end the template", () => {
    expect(findBlocks("const s = `a \\` css=@@( color: red; )`;\n")).toEqual([]);
  });

  test("a comment that is never closed ends the walk rather than the file", () => {
    expect(findBlocks("/* css=@@( color: red; )\n")).toEqual([]);
  });

  test("a line comment that runs to the end of the file ends the walk", () => {
    expect(findBlocks("// css=@@( color: red; )")).toEqual([]);
  });

  test("a string that runs to the end of the file ends there", () => {
    expect(findBlocks(`const s = "css=@@( color: red; )`)).toEqual([]);
  });

  test("a template that runs to the end of the file ends there", () => {
    expect(findBlocks("const s = `css=@@( color: red; )")).toEqual([]);
  });

  test("a substitution that runs to the end of the file ends there", () => {
    expect(findBlocks("const s = `${ css=@@( color: red; )")).toEqual([]);
  });

  test("a string inside a substitution is still a string", () => {
    expect(findBlocks('const s = `${ "css=@@( color: red; )" }`;\n')).toEqual([]);
  });

  test("a shebang is not JavaScript, so nothing in it is a block", () => {
    // Nothing in the language skips a shebang line — not the parser, not a comment rule — so the
    // walk has to, or `@(` written in one is read as code the engine never sees.
    expect(findBlocks(`#!/usr/bin/env node css=@@( color: red; )\nconst a = 1;\n`)).toEqual([]);
  });

  test("and a block below a shebang is still found", () => {
    expect(names(`#!/usr/bin/env node\nconst a = <div css=@@( color: red; )/>;\n`)).toEqual(["css"]);
  });
});

describe("what counts as the attribute", () => {
  test("whitespace is allowed around the equals, because JSX allows it", () => {
    expect(names(`<div css = @@( display: flex; )>x</div>`)).toEqual(["css"]);
  });

  test("a newline between attributes is whitespace like any other", () => {
    expect(names(`<div\n  className="lead"\n  css=@@( display: flex; )\n>x</div>`)).toEqual(["css"]);
  });

  test("the name is taken verbatim, so a host may call the prop what it likes", () => {
    expect(names(`<div sx=@@( display: flex; )>x</div>`)).toEqual(["sx"]);
  });

  test("a namespaced name is one name", () => {
    expect(names(`<div my:css=@@( display: flex; )>x</div>`)).toEqual(["my:css"]);
  });

  /**
   * An `=` with no name before it is not an attribute, and it is not nothing either: a block is a
   * VALUE, so it is found and written where it stands. `wrap` is what says the difference — only a
   * bare JSX attribute gets the braces it did not write.
   */
  test("an equals with nothing before it is a value, not an attribute", () => {
    const [only, ...rest] = findBlocks(`=@@(x)`);

    expect(rest).toEqual([]);
    expect({ name: only.name, wrap: only.wrap }).toEqual({ name: "", wrap: false });
  });

  test("two blocks in one file are both found, in source order", () => {
    expect(names(`<div css=@@( color: red; )/>\n<p sx=@@( color: blue; )/>`)).toEqual(["css", "sx"]);
  });
});

/**
 * The two spellings that are not a JSX attribute.
 *
 * ## Why they exist
 *
 * `DESIGN.md` promised one of them from the start — "because the compiled form is a value, `@@( … )`
 * outside JSX is the same feature with no special case" — and the code did not do it: it wrote the
 * attribute form everywhere, so `const panel = @@( … )` compiled to `const panel={_s0}`, an object
 * literal rather than the value.
 *
 * The other, `css={@@( … )}`, came out of a limit nothing here can lift. An editor stops consulting
 * syntax injections the moment it enters a tag's attribute list, so a bare block gets no colours
 * unless it is the first attribute on the tag name's own line — which is not how anyone writes a tag
 * with several props. Inside the braces JSX already has for an expression, every editor question
 * works, at any position and on any line. Measured with a grammar that matches one word: it is asked
 * about a braced attribute on the fourth line of a tag, and never about a bare one on the second.
 *
 * Both are the same case to everything downstream: replace the block with the value, and touch
 * nothing to its left.
 */
describe("a block that is not an attribute", () => {
  test.each([
    ["a value, outside JSX", `const panel = @@( display: flex; );\n`, "panel"],
    ["a value, exported", `export const panel = @@( display: flex; );\n`, "panel"],
    ["a braced attribute", `const a = <div css={@@( display: flex; )}>x</div>;\n`, "css"],
    [
      "a braced attribute, four lines into the tag",
      `const a = (\n  <div\n    id="x"\n    onclick={f}\n    css={@@( display: flex; )}\n  >x</div>\n);\n`,
      "css",
    ],
  ])("%s is found, and is not wrapped", (_what, source, name) => {
    const [site, ...rest] = findBlocks(source);

    expect(rest).toEqual([]);
    expect(site.name).toBe(name);
    expect(site.wrap).toBe(false);
  });

  /**
   * The other side, and the one that has to keep working: an attribute is still an attribute however
   * many attributes were written before it, and whatever shape their values had.
   */
  test.each([
    ["the only attribute", `const a = <div css=@@( display: flex; )>x</div>;\n`],
    ["after a quoted one", `const a = <div className="lead" css=@@( display: flex; )>x</div>;\n`],
    ["after a braced one", `const a = <div onclick={f} css=@@( display: flex; )>x</div>;\n`],
    ["after a bare one", `const a = <input disabled css=@@( display: flex; )>;\n`],
    ["after a spread", `const a = <div {...rest} css=@@( display: flex; )>x</div>;\n`],
    ["on a namespaced tag", `const a = <Foo.Bar css=@@( display: flex; )>x</Foo.Bar>;\n`],
    ["on a line of its own", `const a = (\n  <div\n    id="x"\n    css=@@( display: flex; )\n  >x</div>\n);\n`],
  ])("%s is wrapped", (_what, source) => {
    expect(findBlocks(source)[0]?.wrap).toBe(true);
  });

  /**
   * Which way an unprovable case falls, and it is deliberate. An attribute mistaken for a value
   * emits `css=_s0`, which is a syntax error the build reports at once; a value mistaken for an
   * attribute emits an object literal, which is valid code that means the wrong thing.
   */
  test("a reassignment is a value, not an attribute", () => {
    expect(findBlocks(`let panel;\npanel = @@( display: flex; );\n`)[0]?.wrap).toBe(false);
  });

  /** A brace that opens nothing leaves the walk before the start of the file, which is not a tag. */
  test("and so is one written after a stray closing brace", () => {
    expect(findBlocks(`} panel = @@( display: flex; );\n`)[0]?.wrap).toBe(false);
  });
});
