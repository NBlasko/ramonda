import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHighlighter, type LanguageRegistration } from "shiki";
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

/** The same reading with NO injection at all — the control for every claim about what is untouched. */
let plainScopesOf: (code: string) => Scoped[];

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

  const plain = await createHighlighter({ themes: ["github-dark"], langs: ["tsx"] });

  const reading = (from: typeof highlighter) => (code: string) =>
    from
      .codeToTokensBase(code, { lang: "tsx", theme: "github-dark", includeExplanation: true })
      .flat()
      .flatMap((token) => token.explanation ?? [])
      .filter((part) => part.content.trim() !== "")
      .map((part) => ({ text: part.content, scope: part.scopes.at(-1)?.scopeName ?? "" }));

  scopesOf = reading(highlighter);
  plainScopesOf = reading(plain);
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

describe("shapes a first sample did not have", () => {
  /**
   * The one that shipped broken. A `<p>` explaining the syntax puts `css=@( … )` in JSX TEXT, the
   * injection fired there, and the block it opened never closed — so the rest of the file was CSS.
   * Measured in `apps/playground-core`: everything from the prose to the end of the file.
   */
  test("prose in JSX children that mentions a block is not a block", () => {
    const code = `const a = <p>a \`css=@( … )\` block</p>;\nconst after = 1;\n`;

    expect(scopesOf(code).some((token) => token.scope.endsWith(".ramonda"))).toBe(false);
    expect(scopeOf(code, "after")).toBe("variable.other.constant.tsx");
  });

  /**
   * The block does not have to be the last attribute, and the first `end` pattern assumed it was: it
   * required the closing paren to be followed by `>` or `/`, so a block with an attribute after it
   * never closed. A bare `)` is right because a paren inside the block is always inside something —
   * `calc(…)`, `url(…)`, a hole's own call — and a child construct is consumed before an end is tried.
   */
  test.each([
    ["an attribute after the block", `const a = <div css=@( color: red; ) id="x">y</div>;\nconst after = 1;\n`],
    ["calc() in a value", `const a = <div css=@( width: calc(100% - 8px); )>y</div>;\nconst after = 1;\n`],
    ["url() in a value", `const a = <div css=@( background: url(a.png); )>y</div>;\nconst after = 1;\n`],
    ["a call inside a hole", `const a = <div css=@( color: {{pick(1)}}; )>y</div>;\nconst after = 1;\n`],
    ["a self-closing tag", `const a = <img css=@( color: red; ) />;\nconst after = 1;\n`],
  ])("%s", (_what, code) => {
    expect(scopeOf(code, "after")).toBe("variable.other.constant.tsx");
  });
});

/**
 * The limit, measured rather than assumed — and it is the ENGINE's, not this grammar's.
 *
 * An injection is only consulted while the tsx grammar is still in the tag itself. The moment it
 * enters `meta.tag.attributes.tsx` — which a second attribute does, and so does a newline after the
 * tag name — no injection fires at all. Proved with a grammar that does nothing but match one word:
 * it colours a first attribute and is never asked about a second.
 *
 * So a block is coloured when it is the FIRST attribute, on the tag name's own line. The tests below
 * pin what really happens outside that, which is worth having both ways: the damage is contained to
 * the tag rather than running down the file, and if an editor engine ever stops behaving this way,
 * these are what say so.
 */
/**
 * A nested rule, which is the block's whole reason for having braces.
 *
 * ## The fault this exists for
 *
 * The CSS grammar bundled with editors does not understand CSS nesting. Measured on a plain `.css`
 * file, `a { &:hover { color: red; } }` comes back with `&` as a PROPERTY, `hover {` as its VALUE,
 * and `color` inside coloured as a value rather than a property — the opening brace swallowed into a
 * value token while its closing brace is scoped as a bracket. Two halves of one construct in two
 * different colours is exactly what a reader calls noise, and it is inside every block that hovers.
 *
 * So the block grammar handles nesting itself rather than inheriting the gap.
 */
describe("a nested rule", () => {
  const CODE = `const a = <div css=@(\n  color: red;\n  &:hover { color: blue; }\n)>x</div>;\nconst after = 1;\n`;

  test("the selector is a selector", () => {
    expect(scopeOf(CODE, "&")).toBe("entity.other.attribute-name.parent-selector.css");
    expect(scopeOf(CODE, "hover")).toBe("entity.other.attribute-name.pseudo-class.css");
  });

  test("its braces are braces", () => {
    const tokens = scopesOf(CODE);

    expect(tokens.find((token) => token.text === "{")?.scope).toBe(
      "punctuation.section.property-list.begin.bracket.curly.css",
    );
    expect(tokens.find((token) => token.text === "}")?.scope).toBe(
      "punctuation.section.property-list.end.bracket.curly.css",
    );
  });

  /** The one a reader actually sees: the same property is the same colour in both places. */
  test("a property inside is the same as a property outside", () => {
    const inside = scopesOf(CODE).filter((token) => token.text === "color");

    expect(inside).toHaveLength(2);
    expect(inside[1].scope).toBe(inside[0].scope);
  });

  /** A hole inside a nested rule — the two constructs meet, and neither may eat the other. */
  test("a hole inside one is still code", () => {
    const code = `const a = <div css=@(\n  &:hover { color: {{accent}}; }\n)>x</div>;\nconst after = 1;\n`;

    expect(scopeOf(code, "hover")).toBe("entity.other.attribute-name.pseudo-class.css");
    expect(scopeOf(code, "{{")).toBe("punctuation.section.embedded.begin.ramonda");
    expect(scopeOf(code, "accent")).toBe("variable.other.readwrite.tsx");
    expect(scopeOf(code, "after")).toBe("variable.other.constant.tsx");
  });

  test("and the block still closes where it closes", () => {
    expect(scopeOf(CODE, "after")).toBe("variable.other.constant.tsx");
  });
});

describe("where an injection cannot reach", () => {
  const SECOND = `const a = <div id="x" css=@( color: red; )>y</div>;\nconst after = 1;\n`;
  const NEXT_LINE = `const a = (\n  <div\n    css=@( color: red; )\n  >y</div>\n);\nconst after = 1;\n`;

  /**
   * Asserted as SAMENESS rather than as an outcome. What the tsx grammar makes of a block it was
   * never told about is its own affair — measured, an attribute list it cannot parse runs past the
   * tag — and the only claim this package can honestly make is that it changed nothing there.
   */
  test.each([
    ["a block that is not the first attribute", SECOND],
    ["a block on the line below the tag name", NEXT_LINE],
  ])("%s reads exactly as it would with no grammar installed", (_what, code) => {
    expect(scopesOf(code).some((token) => token.scope.endsWith(".ramonda"))).toBe(false);
    expect(scopesOf(code)).toEqual(plainScopesOf(code));
  });

  /** The proof it is not this grammar: a one-word injection is ignored in the same place. */
  test("no injection at all is consulted inside a tag's attribute list", async () => {
    const { createHighlighter } = await import("shiki");
    const probe: LanguageRegistration = {
      name: "probe",
      scopeName: "probe.injection",
      injectionSelector: "L:source.tsx",
      injectTo: ["source.tsx"],
      patterns: [{ match: "\\bZZZ\\b", name: "keyword.probe" }],
      repository: {},
    };
    const highlighter = await createHighlighter({ themes: ["github-dark"], langs: ["tsx", probe] });

    const scopeOfZZZ = (code: string) =>
      highlighter
        .codeToTokensBase(code, { lang: "tsx", theme: "github-dark", includeExplanation: true })
        .flat()
        .flatMap((token) => token.explanation ?? [])
        .find((part) => part.content.trim() === "ZZZ")
        ?.scopes.at(-1)?.scopeName;

    expect(scopeOfZZZ(`const a = <div ZZZ="1">x</div>;\n`)).toBe("keyword.probe");
    expect(scopeOfZZZ(`const a = <div id="x" ZZZ="1">x</div>;\n`)).toBe("entity.other.attribute-name.tsx");
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
