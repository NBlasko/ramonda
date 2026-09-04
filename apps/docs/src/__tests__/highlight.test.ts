import type { BundledLanguage } from "shiki";
import { describe, expect, test } from "vitest";
import { highlighter } from "../../scripts/highlighter.mjs";

/**
 * The colours a docs page really gets.
 *
 * ## The fault this exists for
 *
 * A `css=@( … )` block is not TypeScript, and the tsx grammar cannot tokenise one. Measured before
 * the grammars were wired in, a fence holding a block came back with the theme's INVALID colour —
 * and so did every line BELOW it, to the end of the fence. Nothing failed; the page just shipped
 * looking broken, which is the worst outcome for a page whose job is to teach the syntax.
 *
 * The claim below is the one a reader can check: a declaration is coloured the SAME inside a block
 * as it is in an ordinary CSS fence. That is what "consistent colours" has to mean, and it is the
 * only version of it a test can hold.
 *
 * A hole is not among the claims, and the reason is worth writing down: measured, `{{accent}}` comes
 * out the theme's plain text colour in both themes with the grammars wired in AND without them, so a
 * test on its colour could never fail. What the hole really gets is a SCOPE, and scopes are asserted
 * where they are visible — `@ramonda/css`'s own grammar test.
 */

/** Every token's own colour, in order, with whitespace dropped. */
const coloursOf = (code: string, lang: BundledLanguage) =>
  highlighter
    .codeToTokens(code, { lang, themes: { light: "github-light", dark: "github-dark" }, defaultColor: false })
    .tokens.flat()
    .filter((token) => token.content.trim() !== "")
    .map((token) => ({ text: token.content, colour: token.htmlStyle?.["--shiki-light"] }));

const colourOf = (code: string, lang: BundledLanguage, text: string) =>
  coloursOf(code, lang).find((token) => token.text.trim() === text)?.colour;

describe("a style block in a fence", () => {
  const FENCE = `const a = (
  <div css=@(
    display: flex;
    color: {{accent}};
  )>x</div>
);
const after = 1;
`;

  test("a property is the colour it has in a CSS fence", () => {
    expect(colourOf(FENCE, "tsx", "display")).toBe(colourOf("a { display: flex; }", "css", "display"));
  });

  test("a value is too", () => {
    expect(colourOf(FENCE, "tsx", "flex")).toBe(colourOf("a { display: flex; }", "css", "flex"));
  });

  /** The line that made this worth wiring: the block used to swallow the rest of the fence. */
  test("the code below the block is ordinary TypeScript again", () => {
    expect(colourOf(FENCE, "tsx", "const")).toBe(colourOf("const after = 1;\n", "tsx", "const"));
    expect(colourOf(FENCE, "tsx", "1")).toBe(colourOf("const after = 1;\n", "tsx", "1"));
  });
});
