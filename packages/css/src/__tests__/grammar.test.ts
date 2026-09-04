import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHighlighter } from "shiki";
import { beforeAll, describe, expect, test } from "vitest";

/**
 * The syntax colours, asserted as SCOPES rather than looked at.
 *
 * ## The fault this exists for
 *
 * A third category of tool neither works nor refuses: a highlighter renders the wrong colours and
 * says nothing. Measured before the grammar existed, on the tsx grammar alone, every token of a
 * block came back with the theme's INVALID colour — and so did every line BELOW it, to the end of
 * the file. A block on line 243 made `const after = 1;` on line 259 look broken.
 *
 * ## Why this is testable at all
 *
 * TextMate grammars are usually judged by screenshot. They do not have to be: a grammar is a function
 * from text to scopes, and shiki carries the same engine an editor uses. So every claim below is the
 * scope a token really got.
 *
 * The first three readings of this were WRONG, and the reason is worth keeping: `codeToTokensBase`
 * merges adjacent tokens that share a colour, and reading `explanation[0]` of a merged run reports
 * one scope for all of them. Every explanation has to be walked, or a grammar that works looks
 * broken — which is exactly what happened, twice.
 */

const GRAMMAR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "vscode", "grammar");

const load = (name: string) => JSON.parse(readFileSync(join(GRAMMAR, `${name}.tmLanguage.json`), "utf8"));

/** Every token's own scope, in order — never a merged colour run. */
type Scoped = { text: string; scope: string };

let scopesOf: (code: string) => Scoped[];

beforeAll(async () => {
  const highlighter = await createHighlighter({
    themes: ["github-dark"],
    langs: [
      "tsx",
      "css",
      { ...load("ramonda-css"), name: "ramonda-css", injectTo: ["source.tsx"] },
      // Into `source.css` as well: the hole sits inside a CSS declaration's value, and by then the
      // CSS grammar is the one tokenising.
      { ...load("ramonda-css-hole"), name: "ramonda-css-hole", injectTo: ["source.tsx", "source.css"] },
    ],
  });

  scopesOf = (code) =>
    highlighter
      .codeToTokensBase(code, { lang: "tsx", theme: "github-dark", includeExplanation: true })
      .flat()
      .flatMap((token) => token.explanation ?? [])
      .filter((part) => part.content.trim() !== "")
      .map((part) => ({ text: part.content, scope: part.scopes.at(-1)?.scopeName ?? "" }));
});

/** The scope one piece of text got, or nothing when the grammar never produced it as a token. */
const scopeOf = (code: string, text: string) => scopesOf(code).find((token) => token.text === text)?.scope;

describe("a block on one line", () => {
  const CODE = `const a = <div css=@( display: flex; )>x</div>;\n`;

  test.each([
    ["the attribute name", "css", "entity.other.attribute-name"],
    ["the block's opening", "@(", "punctuation.section.embedded.begin.ramonda"],
    ["a property name", "display", "support.type.property-name.css"],
    ["a value", "flex", "support.constant.property-value.css"],
    ["the semicolon", ";", "punctuation.terminator.rule.css"],
    ["the block's closing", ")", "punctuation.section.embedded.end.ramonda"],
  ])("%s", (_what, text, scope) => {
    expect(scopeOf(CODE, text)).toBe(scope);
  });

  /**
   * The half that matters as much as the colours inside: the tag has to close where it really
   * closes. Before the grammar, the block ran to the end of the file and took everything with it.
   */
  test("the tag closes after the block, and the JSX carries on", () => {
    const after = scopesOf(CODE);
    const end = after.findIndex((token) => token.scope.endsWith(".end.ramonda"));

    expect(after[end + 1]).toEqual({ text: ">", scope: "punctuation.definition.tag.end.tsx" });
    expect(after[end + 2]).toEqual({ text: "x", scope: "meta.jsx.children.tsx" });
  });
});

describe("a block across several lines", () => {
  const CODE = `const a = (
  <div css=@(
    display: flex;
    color: {{accent}};
    &:hover { color: red; }
  )>x</div>
);
const after = 1;
`;

  test("the CSS inside is CSS", () => {
    expect(scopeOf(CODE, "display")).toBe("support.type.property-name.css");
    expect(scopeOf(CODE, "flex")).toBe("support.constant.property-value.css");
  });

  /** A hole is TypeScript, and the point of scoping it is that it reads as code rather than as CSS. */
  test("a hole is the expression it holds", () => {
    expect(scopeOf(CODE, "{{")).toBe("punctuation.section.embedded.begin.ramonda");
    expect(scopeOf(CODE, "accent")).toBe("variable.other.readwrite.tsx");
    expect(scopeOf(CODE, "}}")).toBe("punctuation.section.embedded.end.ramonda");
  });

  /**
   * The line that made this worth building. Before the grammar, everything below a block was the
   * theme's invalid colour to the end of the file — measured, `const` came back as a variable and
   * `1;` as an error.
   */
  test("nothing below the block is touched", () => {
    const tokens = scopesOf(CODE);
    // From the LAST `const`, which is the one below the block — the first opens the file.
    const below = tokens.slice(tokens.map((token) => token.text).lastIndexOf("const"));

    expect(below).toEqual([
      { text: "const", scope: "storage.type.tsx" },
      { text: "after", scope: "variable.other.constant.tsx" },
      { text: "=", scope: "keyword.operator.assignment.tsx" },
      { text: "1", scope: "constant.numeric.decimal.tsx" },
      { text: ";", scope: "punctuation.terminator.statement.tsx" },
    ]);
  });
});

describe("what it must not claim", () => {
  /**
   * `{{` is ordinary JSX — `style={{ color: "red" }}` is an object literal in an expression
   * container. That is why the hole is a SEPARATE injection, aimed at the CSS a block scopes, rather
   * than a pattern in the one aimed at a tag.
   */
  test("an object literal in a JSX attribute is left alone", () => {
    const code = `const a = <div style={{ color: "red" }}>x</div>;\n`;

    expect(scopeOf(code, "{{")).toBeUndefined();
    expect(scopeOf(code, "color")).not.toBe("support.type.property-name.css");
  });

  test("a decorator is not a block", () => {
    const code = `class C {\n  @(dec) m() {}\n}\n`;

    expect(scopesOf(code).some((token) => token.scope.endsWith(".ramonda"))).toBe(false);
  });

  test("and a file with no block at all is untouched", () => {
    const code = `const a = <div className="lead">x</div>;\n`;

    expect(scopesOf(code).some((token) => token.scope.endsWith(".ramonda"))).toBe(false);
    expect(scopeOf(code, "className")).toBe("entity.other.attribute-name.tsx");
  });
});

/**
 * The manifest that carries the two grammars into an editor.
 *
 * ## The fault this exists for
 *
 * A grammar is reached by its `scopeName`, twice: once as the name the file declares, and once as the
 * name the manifest registers it under. They are written in two places and nothing compares them — a
 * typo in either leaves the extension installing cleanly, activating cleanly, and colouring nothing.
 * The tests above would still pass, because they load the grammar files directly.
 */
describe("the VS Code extension", () => {
  const EXTENSION = resolve(GRAMMAR, "..");
  const manifest = JSON.parse(readFileSync(join(EXTENSION, "package.json"), "utf8"));

  /** What VS Code is told to load, and where. */
  const contributed: { scopeName: string; path: string; injectTo: string[] }[] = manifest.contributes.grammars;

  for (const grammar of contributed) {
    /** `source.tsx` is where a block lives; a grammar not injected there is one an author never sees. */
    test(`${grammar.scopeName} is registered under the name its own file declares`, () => {
      const file = JSON.parse(readFileSync(join(EXTENSION, grammar.path), "utf8"));

      expect(file.scopeName).toBe(grammar.scopeName);
      expect(grammar.injectTo).toContain("source.tsx");
    });
  }

  /** Both directions: a grammar file nobody contributes is dead, and a contribution with no file is worse. */
  test("the manifest contributes exactly the grammars that exist", () => {
    expect(contributed.map((grammar) => basename(grammar.path)).sort()).toEqual(readdirSync(GRAMMAR).sort());
  });
});
