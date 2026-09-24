import type { Shape } from "./shapes.generated";

/**
 * Splitting a POSITIONAL shorthand into its longhands, from a learned shape and nothing else.
 *
 * ## Why this is worth doing at all
 *
 * If every declaration a block emits is a longhand, no two classes on an element set the same
 * property, `mergeClassNames` settles every conflict by key, and the cascade is never asked. That
 * is what removes the shorthand-against-longhand question from the stylesheet entirely — see
 * `DESIGN.md`, "The way out: split every shorthand".
 *
 * ## Why only the positional ones
 *
 * A positional family is answered by HOW MANY values were written and nothing else, so the shape is
 * data and this function needs no browser, no tables and no grammar. Every other shape asks which
 * longhand a token belongs to, and that was measured unanswerable from what this package generates
 * — 84 of 404 placements. Those families keep their shorthand and the cascade keeps deciding.
 *
 * The shapes themselves are measured out of Chromium, Firefox and WebKit by
 * `scripts/build-shorthand-shapes.mjs`, and only written where every engine that has the family
 * agreed.
 */

/** The keywords that are not component values: they go on EVERY longhand, or nowhere. */
export const WIDE: readonly string[] = ["inherit", "initial", "unset", "revert", "revert-layer"];

/**
 * Top-level separators only.
 *
 * `rgb(1, 1, 1)` is ONE value, and splitting on every space tore it into three — the first thing
 * the engines caught, before a line of the real splitter existed.
 */
export function tokensOf(value: string, separator = /\s/): string[] {
  const out: string[] = [];
  let depth = 0;
  let at = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth === 0 && separator.test(ch)) {
      if (at !== "") out.push(at);
      at = "";
      continue;
    }
    at += ch;
  }
  if (at !== "") out.push(at);
  return out;
}

/**
 * The longhands this value sets, or `undefined` where it must not be split.
 *
 * **Refusing is a correct answer rather than a gap**, and there are three of them:
 *
 * - a pattern the family was never taught — the arity is one no engine accepted, so there is
 *   nothing measured to go on;
 * - a CSS-wide keyword beside a real value, which is invalid CSS and belongs to the checker;
 * - a `var()` ANYWHERE in the value. Its content is unknown until computed-value time and may carry
 *   several values: measured, `border-color: var(--c)` with `--c: red blue` renders red/blue/red/
 *   blue, while `var(--c)` on each longhand is four invalid declarations and a black border.
 *
 * A CSS-wide keyword ALONE is not refused — it is not a component value, so it goes on every
 * longhand. Measured: `background-position: inherit` inherits both axes, where treating it
 * positionally gave `x: inherit, y: center`.
 */
export function splitPositional(shape: Shape, value: string): Record<string, string> | undefined {
  const keys = Object.keys(shape.patterns);
  if (keys.length === 0) return undefined;
  const longhands = Object.keys(shape.patterns[keys[0]]);

  const bare = value.trim();
  if (WIDE.includes(bare)) return Object.fromEntries(longhands.map((one) => [one, bare]));
  if (tokensOf(value).some((one) => WIDE.includes(one))) return undefined;
  if (/\bvar\(/.test(value)) return undefined;

  const sides = tokensOf(value, /\//).map((one) => tokensOf(one));
  const mapping = shape.patterns[sides.map((one) => one.length).join("/")];
  if (mapping === undefined) return undefined;
  const flat = sides.flat();
  return Object.fromEntries(
    Object.entries(mapping).map(([longhand, how]) => [
      longhand,
      "literal" in how ? how.literal : how.slots.map((index) => flat[index]).join(" "),
    ]),
  );
}
