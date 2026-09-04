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
    expect(mayHoldABlock("<div css=@( display: flex; )>x</div>")).toBe(true);
  });

  test("a decorator makes it say maybe, which is what the second pass is for", () => {
    // The point of two passes: this one is allowed to be wrong in the cheap direction only.
    expect(mayHoldABlock("class C { @(dec) m() {} }")).toBe(true);
    expect(findBlocks("class C { @(dec) m() {} }")).toEqual([]);
  });
});

describe("what the walk steps over", () => {
  test("an escaped quote does not end the string it is in", () => {
    expect(findBlocks(`const s = "a \\" css=@( display: flex; )";\n`)).toEqual([]);
  });

  test("an unterminated string ends at the newline, so the rest of the file is still read", () => {
    // Running an unterminated string to the end of the module would hide every block below it.
    expect(names(`const s = "oops;\nconst a = <div css=@( display: flex; )>x</div>;\n`)).toEqual(["css"]);
  });

  test("a substitution is code, and a block inside one is still not an attribute", () => {
    expect(findBlocks("const s = `a ${ { x: `css=@( display: flex; )` } } b`;\n")).toEqual([]);
  });

  test("a template nested in a substitution closes at its own backtick", () => {
    expect(names("const s = `${ `${ `inner` }` }`;\nconst a = <div css=@( color: red; )>x</div>;\n")).toEqual(["css"]);
  });

  test("an escaped backtick does not end the template", () => {
    expect(findBlocks("const s = `a \\` css=@( color: red; )`;\n")).toEqual([]);
  });

  test("a comment that is never closed ends the walk rather than the file", () => {
    expect(findBlocks("/* css=@( color: red; )\n")).toEqual([]);
  });

  test("a line comment that runs to the end of the file ends the walk", () => {
    expect(findBlocks("// css=@( color: red; )")).toEqual([]);
  });

  test("a string that runs to the end of the file ends there", () => {
    expect(findBlocks(`const s = "css=@( color: red; )`)).toEqual([]);
  });

  test("a template that runs to the end of the file ends there", () => {
    expect(findBlocks("const s = `css=@( color: red; )")).toEqual([]);
  });

  test("a substitution that runs to the end of the file ends there", () => {
    expect(findBlocks("const s = `${ css=@( color: red; )")).toEqual([]);
  });

  test("a string inside a substitution is still a string", () => {
    expect(findBlocks('const s = `${ "css=@( color: red; )" }`;\n')).toEqual([]);
  });

  test("a shebang is not JavaScript, so nothing in it is a block", () => {
    // Nothing in the language skips a shebang line — not the parser, not a comment rule — so the
    // walk has to, or `@(` written in one is read as code the engine never sees.
    expect(findBlocks(`#!/usr/bin/env node css=@( color: red; )\nconst a = 1;\n`)).toEqual([]);
  });

  test("and a block below a shebang is still found", () => {
    expect(names(`#!/usr/bin/env node\nconst a = <div css=@( color: red; )/>;\n`)).toEqual(["css"]);
  });
});

describe("what counts as the attribute", () => {
  test("whitespace is allowed around the equals, because JSX allows it", () => {
    expect(names(`<div css = @( display: flex; )>x</div>`)).toEqual(["css"]);
  });

  test("a newline between attributes is whitespace like any other", () => {
    expect(names(`<div\n  className="lead"\n  css=@( display: flex; )\n>x</div>`)).toEqual(["css"]);
  });

  test("the name is taken verbatim, so a host may call the prop what it likes", () => {
    expect(names(`<div sx=@( display: flex; )>x</div>`)).toEqual(["sx"]);
  });

  test("a namespaced name is one name", () => {
    expect(names(`<div my:css=@( display: flex; )>x</div>`)).toEqual(["my:css"]);
  });

  test("an equals with nothing before it is not an attribute", () => {
    expect(findBlocks(`=@(x)`)).toEqual([]);
  });

  test("two blocks in one file are both found, in source order", () => {
    expect(names(`<div css=@( color: red; )/>\n<p sx=@( color: blue; )/>`)).toEqual(["css", "sx"]);
  });
});
