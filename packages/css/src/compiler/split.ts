import { KEYWORDS, UNIT_TYPE } from "./keywords.generated";
import { type Shape, SHAPES } from "./shapes.generated";
import { TOKEN_SHAPES, type TokenShape, type TokenSlot } from "./tokenShapes.generated";

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
  /**
   * A NEGATIVE where the family refuses one, because CSS and a split disagree about invalid input.
   *
   * CSS drops a whole declaration when any part of it is invalid; a split drops only the part.
   * `padding: 10px -5px` leaves no padding at all, and four longhands would leave 10px on top and
   * bottom — the author's mistake stops doing nothing and starts doing half of something. Which
   * families refuse a negative is measured, not listed: all three engines agree, and `margin`,
   * `inset` and `scroll-margin` take one.
   *
   * It asks of each TOKEN, not of the text: reading the text refused `calc(4px - 9px)`, whose `- 9`
   * is a subtraction inside a call and not a negative value at all. What that call works out to is
   * still past this — the boundary, and the reason the refusal path exists.
   */
  if (!shape.negative && tokensOf(value, /[\s/]/).some((one) => /^-\.?\d/.test(one))) return undefined;

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

/**
 * Splitting a shorthand whose value is a BAG OF TOKENS — written in any order, one token per slot.
 *
 * ## Why this is a second function and not a wider first one
 *
 * A positional family is answered by how many values were written. `border: 1px solid red` is not:
 * the three parts may be written in any order, and which longhand each feeds is decided by what the
 * token IS. So the shape here is not a count-to-mapping table but a RECOGNISER per slot, derived
 * from the family's published grammar and measured against three engines by
 * `scripts/build-token-shapes.mjs`.
 *
 * ## The boundary, which is a fact and not a shortfall
 *
 * A value is a bag of tokens only where the grammar is flat — no comma, no slash, no repetition.
 * `background`, `animation`, `transition`, `mask`, `font` and `grid` all have one of the three, so
 * they are not in the table and keep their shorthand. What IS in it is the whole `border` family,
 * `outline`, `column-rule`, `text-decoration`, `flex-flow` and `list-style`.
 *
 * ## Why the three passes are in this order
 *
 * An exact WORD first, then what a slot takes by primitive or function, then the open slot as a
 * catch-all. The first two are not interchangeable: `list-style-type` lists `none` exactly AND
 * takes a `custom-ident`, so matching primitives first walks `list-style: none` past it into
 * `list-style-image` — a different declaration that looks the same.
 *
 * ## One token per slot, and the two families that want more
 *
 * A slot takes at most ONE token. Where a longhand's own grammar is `a || b || c`, several keywords
 * may stand together and the second finds no free slot, so the whole value is refused and the
 * shorthand stays. Measured over every pair of words in the table, the engines accept ten that this
 * turns down, and they are all in two families:
 *
 * ```
 * text-decoration: underline overline      text-decoration-line takes several at once
 * position-try: flip-block flip-inline     position-try-fallbacks likewise
 * ```
 *
 * A refusal is safe — it is what the compiler did for these before there was a splitter at all —
 * and lifting it means a slot knowing its own multiplicity, which the grammar can say and this
 * shape cannot. Recorded rather than fixed, because the fix is a different model and not a patch.
 *
 * The third pass takes whatever is left, which is what puts `upper-roman` in `list-style-type`
 * without a list of counter styles that could not exist. It does NOT consult what the slot accepts,
 * and the middle pass deliberately does not skip an open slot: measured over the whole table, no
 * open slot can win the middle pass, because `custom-ident` and `string` are the only primitives
 * one has and neither is ever the answer for a token. A guard there was written, was found to
 * decide nothing, and was removed rather than kept as a comment about a case that cannot arise.
 * A family that later brings an open slot with a real primitive would be caught by the generator,
 * which refuses any family it cannot reproduce in all three engines.
 */
/** A colour is tested directly rather than expanded: `<color>` is 192 words, and every border family takes one. */
const COLOUR_WORDS = new Set((KEYWORDS.color ?? "").split(" ").filter((one) => one !== ""));
const COLOUR_CALL = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i;
/** The spelling `rules.ts` and `flatten.ts` already use: optional space after the bang, any case. */
const IMPORTANT = /!\s*important\s*$/i;
const A_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const A_DIMENSION = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?([a-z%]+)$/i;

/** Which primitives a token could be. A bare number is BOTH a number and an integer when it has no point. */
function primitivesOf(token: string): readonly string[] {
  if (A_NUMBER.test(token)) return token.includes(".") || token.includes("e") ? ["number"] : ["number", "integer"];
  const dimension = A_DIMENSION.exec(token);
  if (dimension !== null) {
    const type = UNIT_TYPE[(dimension[3] ?? "").toLowerCase()];
    return type === undefined ? [] : [type];
  }
  if (token.startsWith("#")) return ["hex-color", "color"];
  /**
   * A `--name` is a DASHED-IDENT, which is how a timeline, an anchor and a position area are named.
   *
   * Nothing produced this type, so `scroll-timeline: --carousel block` matched no slot and the whole
   * value was refused — and the generator could not see it, because it only checks what splits.
   */
  if (token.startsWith("--")) return ["dashed-ident"];
  if (token.startsWith('"') || token.startsWith("'")) return ["string"];
  return [];
}

/** Whether one slot takes this token, by word, by function, or by primitive. */
function accepts(slot: TokenSlot, token: string): boolean {
  const lower = token.toLowerCase();
  if (slot.words.some((one) => one.toLowerCase() === lower)) return true;
  if (slot.types.includes("color") && (COLOUR_WORDS.has(lower) || lower.startsWith("#") || COLOUR_CALL.test(lower)))
    return true;
  const call = /^([a-z-]+)\(/i.exec(lower);
  // `url(…)` is spelled like a call and is a TYPE — a grammar writes `<url>`, never `url()`.
  if (call !== null) return call[1] === "url" ? slot.types.includes("url") : slot.functions.includes(call[1] ?? "");
  return primitivesOf(lower).some((one) => slot.types.includes(one));
}

/**
 * Split a bag-of-tokens value into its longhands, or refuse.
 *
 * It refuses on a comma or a slash (the shape does not describe those), on `var()` (what is in it
 * is unknown until the browser reads it), and on a token no slot will take. A refusal leaves the
 * declaration a shorthand, which is visibly the author's own text; a wrong guess is invisible.
 *
 * A CSS-wide keyword goes on EVERY longhand the family resets — `border: inherit` inherits all
 * twelve — and beside another value it is refused, because CSS has no such form either.
 */
export function splitTokens(shape: TokenShape, value: string): Record<string, string> | undefined {
  if (/(^|[^\w-])var\(/i.test(value)) return undefined;
  /**
   * A comma or a slash at the TOP LEVEL, which is not the same as one anywhere in the text.
   *
   * Read as text, this turned away `rgb(1, 2, 3)` while splitting `rgb(1 2 3)` — and the comma
   * spelling is what almost every codebase writes for a colour. It stayed invisible because the
   * generator samples a colour as `rgb(1 2 3)`, so no corpus value ever carried one.
   */
  if (tokensOf(value, /[,/]/).length > 1) return undefined;
  const tokens = tokensOf(value);
  if (tokens.length === 0) return undefined;
  if (tokens.some((one) => WIDE.includes(one.toLowerCase()))) {
    if (tokens.length !== 1) return undefined;
    return Object.fromEntries(shape.longhands.map((one) => [one, tokens[0] as string]));
  }

  const taken: (string | undefined)[] = shape.slots.map(() => undefined);
  const free = (fits: (slot: TokenSlot) => boolean): number =>
    shape.slots.findIndex((slot, index) => taken[index] === undefined && fits(slot));
  for (const token of tokens) {
    const lower = token.toLowerCase();
    let at = free((slot) => slot.words.some((one) => one.toLowerCase() === lower));
    if (at < 0) at = free((slot) => accepts(slot, token));
    if (at < 0) at = free((slot) => slot.open);
    if (at < 0) return undefined;
    taken[at] = token;
  }

  // A longhand no token reached is reset, which is exactly what the shorthand does to it.
  const out: Record<string, string> = Object.fromEntries(shape.longhands.map((one) => [one, "initial"]));
  for (const [index, slot] of shape.slots.entries()) {
    const token = taken[index];
    if (token === undefined) continue;
    for (const longhand of slot.longhands) out[longhand] = token;
  }
  return out;
}

/**
 * The one door from a written declaration to the longhands it sets, or a refusal.
 *
 * Two tables, asked in turn: a positional family is answered by how many values were written, a
 * bag-of-tokens family by what each token is, and a family in neither keeps its shorthand. The
 * caller does not choose between them, because which shape a family has is not a fact the compiler
 * should hold in a second place — see `one-rule-many-consumers`.
 *
 * `!important` is taken off before the split and put back on every longhand. It has to be: it is
 * part of the value's text here, so a splitter would see it as a token nothing accepts and refuse
 * the whole declaration. Splitting it out is also what CSS means by it — `border: 1px solid red
 * !important` makes all three important, not the first. Every spelling a browser honours is put
 * back verbatim, measured: `!IMPORTANT` and `! important` are important in all three engines.
 *
 * ## A PREFIXED name is looked up as itself, and must stay that way
 *
 * `breadthOf` asks `standardFormOf` so that `-webkit-border-radius` borrows `border-radius`'s layer,
 * and the obvious next thought is to give the splitter the same fallback. It is wrong, measured:
 *
 * ```
 * border-radius: 4px 8px            4px | 8px | 4px | 8px      two corners, the standard rule
 * -webkit-border-radius: 4px 8px    4px 8px | 4px 8px | …      Chromium and WebKit: ONE elliptical
 *                                   4px | 8px | 4px | 8px      Firefox: like the standard
 * ```
 *
 * The prefixed name is not an alias. It keeps the old WebKit reading where two values are the
 * horizontal and vertical radii of every corner, and the engines disagree with each other about it.
 * Splitting it through the standard shape would write a different page in two of the three. So a
 * prefixed shorthand is in neither table, stays whole, and the layer — where the question is only
 * *do these two fight*, and they do — keeps its fallback.
 */
export function splitOf(property: string, value: string): Record<string, string> | undefined {
  const bang = IMPORTANT.exec(value);
  const bare = bang === null ? value : value.slice(0, bang.index);

  const positional = SHAPES[property];
  const tokens = TOKEN_SHAPES[property];
  const split =
    positional !== undefined
      ? splitPositional(positional, bare)
      : tokens === undefined
        ? undefined
        : tokens.list === true
          ? splitList(tokens, bare)
          : splitTokens(tokens, bare);
  if (split === undefined || bang === null) return split;

  return Object.fromEntries(Object.entries(split).map(([one, each]) => [one, `${each} ${bang[0].trim()}`]));
}

/**
 * Splitting a COMMA-SEPARATED family — the same shape repeated, and each longhand a list of its own.
 *
 * `transition: color 1s, opacity 2s` is two items of one shape, and every longhand the family sets
 * takes a list the same length: `transition-property: color, opacity` beside
 * `transition-duration: 1s, 2s`. So this is `splitTokens` applied per item and joined back per
 * longhand, which is why it is a few lines rather than a third splitter.
 *
 * The shape describes ONE item, read from the grammar inside the `#` rather than from the whole
 * value — `<single-transition>` and not `<single-transition>#`.
 *
 * **An item that cannot be answered refuses the WHOLE value**, and an empty item refuses it too.
 * Dropping a bad item would shorten one longhand's list and leave the others long, and the lists
 * are matched by POSITION: a shorter one repeats from its start, so every item after the gap would
 * silently take another item's value.
 */
export function splitList(shape: TokenShape, value: string): Record<string, string> | undefined {
  if (/(^|[^\w-])var\(/i.test(value)) return undefined;

  const items = tokensOf(value, /,/).map((one) => one.trim());
  if (items.length === 0 || items.some((one) => one === "")) return undefined;

  // A CSS-wide keyword is the whole value, never one item of a list.
  const first = items[0] as string;
  if (items.length === 1 && WIDE.includes(first.toLowerCase()))
    return Object.fromEntries(shape.longhands.map((one) => [one, first]));

  const per = items.map((one) => splitTokens(shape, one));
  if (per.some((one) => one === undefined)) return undefined;

  return Object.fromEntries(
    shape.longhands.map((one) => [one, per.map((each) => (each as Record<string, string>)[one]).join(", ")]),
  );
}
