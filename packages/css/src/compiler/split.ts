import { holdsVar } from "../holdsVar";
import { BY_HAND } from "./splitByHand";
import { GRAMMAR_SHAPES, type GrammarLeaf, type GrammarShape } from "./grammarShapes.generated";
import { INITIAL_VALUES } from "./initials.generated";
import { KEYWORDS, UNIT_TYPE, VALUE_WORDS } from "./keywords.generated";
import { matchValue } from "./matchValue";
import { type Shape, SHAPES } from "./shapes.generated";
import type { Term } from "./valueSyntax";

export { holdsVar };

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
  // A quoted string is ONE token, whatever it holds: `"A/B"` and `'A, B'` are font names.
  let quote = "";
  for (const ch of value) {
    if (quote !== "") {
      at += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth === 0 && quote === "" && separator.test(ch)) {
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
  // In any case: CSS keywords are case-insensitive, and `margin: 1px INHERIT` is as invalid as its
  // lower-case twin — a browser drops it, and a split would set the `1px`.
  if (WIDE.includes(bare.toLowerCase())) return Object.fromEntries(longhands.map((one) => [one, bare]));
  if (tokensOf(value).some((one) => WIDE.includes(one.toLowerCase()))) return undefined;
  if (holdsVar(value)) return undefined;
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
  // A percentage where the family refuses one, for the same reason: `scroll-margin: 10% 5px` sets
  // nothing, and a split would set the 5px. Anywhere in a token, so `calc(1px + 2%)` counts too.
  if (shape.percent === false && tokensOf(value, /[\s/]/).some((one) => one.includes("%"))) return undefined;

  const sides = tokensOf(value, /\//).map((one) => tokensOf(one));
  const mapping = shape.patterns[sides.map((one) => one.length).join("/")];
  if (mapping === undefined) return undefined;
  const flat = sides.flat();
  if (misplacedWord(shape, value) !== undefined) return undefined;

  const out: Record<string, string> = {};
  for (const [longhand, how] of Object.entries(mapping)) {
    const piece = "literal" in how ? how.literal : how.slots.map((index) => flat[index]).join(" ");
    /**
     * A word that is only ever PART of a value cannot be a slot on its own.
     *
     * `first baseline` and `safe center` are one value of two words, and a positional split read
     * them as two: `align-items: first`, which no engine accepts, so the align was dropped and the
     * justify kept. `alone` is the list the engines take as a longhand's WHOLE value, measured and
     * intersected across all three; `words` stays the grammar's list because the checker reads it,
     * and `place-items: first baseline` is valid CSS it must not report.
     *
     * Written inline because this function is injected into a page as text — see
     * `build-shorthand-shapes.mjs`.
     */
    const alone = shape.takes?.[longhand]?.alone;
    if (alone !== undefined && !("literal" in how) && /^-{0,2}[a-z_][\w-]*$/i.test(piece)) {
      const lower = piece.toLowerCase();
      if (!WIDE.includes(lower) && !alone.some((word) => word.toLowerCase() === lower)) return undefined;
    }
    out[longhand] = piece;
  }
  return out;
}

/**
 * The first WORD this value puts where its longhand has no place for one, if there is one.
 *
 * CSS drops a whole declaration when any part of it is invalid; a split drops only the part. So
 * `place-items: start space-between` — which no engine accepts, `justify-items` having no
 * `space-between` — sets nothing in a browser and would have set the align here, and the author's
 * mistake stops doing nothing and starts doing half of something. Measured in all three engines,
 * and it is the same rule `negative` states for `padding: 10px -5px`.
 *
 * **Only words.** A length, a percentage, a `calc()` or a `var()` is the same to every longhand
 * that takes lengths at all, and whether a NEGATIVE one is allowed is a range the grammar reader
 * drops — which is why that stays measured on its own.
 *
 * A longhand whose `free` is set takes something no list can hold: a colour name, a `custom-ident`,
 * a string. It is not checked, because a list would refuse `red`.
 *
 * Exported because the SPLITTER and the CHECKER ask the same question: one refuses the value, the
 * other says why. Two copies of this would be the fault `one-rule-many-consumers` names — and
 * `scripts/build-shorthand-shapes.mjs` injects it into a page beside `tokensOf`, for the reason
 * written there.
 */
export function misplacedWord(
  shape: Shape,
  value: string,
): { readonly word: string; readonly longhand: string } | undefined {
  const sides = tokensOf(value, /\//).map((one) => tokensOf(one));
  const mapping = shape.patterns[sides.map((one) => one.length).join("/")];
  if (mapping === undefined) return undefined;
  const flat = sides.flat();

  for (const [longhand, how] of Object.entries(mapping)) {
    const takes = shape.takes?.[longhand];
    if (takes === undefined || takes.free || "literal" in how) continue;
    for (const index of how.slots) {
      const one = flat[index];
      if (one === undefined || !/^-{0,2}[a-z_][\w-]*$/i.test(one)) continue;
      const lower = one.toLowerCase();
      if (WIDE.includes(lower)) continue;
      if (!takes.words.some((word) => word.toLowerCase() === lower)) return { word: one, longhand };
    }
  }
  return undefined;
}

/** A colour is tested directly rather than expanded: `<color>` is 192 words, and every border family takes one. */
const COLOUR_WORDS = new Set((KEYWORDS.color ?? "").split(" ").filter((one) => one !== ""));
const COLOUR_CALL = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i;
/** The spelling `rules.ts` and `flatten.ts` already use: optional space after the bang, any case. */
/** `!important`, however it is spelt — ONE pattern for the split, the flattener and the checker. */
export const IMPORTANT = /!\s*important\s*$/i;
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
function accepts(slot: GrammarLeaf, token: string): boolean {
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
 * The one door from a written declaration to the longhands it sets, or a refusal.
 *
 * Two tables, asked in turn: a positional family is answered by how many values were written, and
 * every other by reading the value against the family's own GRAMMAR. A family in neither keeps its
 * shorthand. The caller does not choose between them, because which shape a family has is not a
 * fact the compiler should hold in a second place — see `one-rule-many-consumers`.
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

  // An EMPTY item — `transition: 1s,`, `1s,,2s` — is invalid CSS in every family, and a browser
  // drops the whole declaration. `tokensOf` skips empty items, so without this the split read
  // `1s,` as `1s` and set it.
  if (emptyItem(bare)) return undefined;

  const positional = SHAPES[property];
  const grammar = GRAMMAR_SHAPES[property];
  const byHand = BY_HAND[property];
  /**
   * By hand FIRST where a family has it. Eighteen families have both — `background-position`,
   * `animation-range`, `place-*`, `grid-row`/`-column`, `border-radius` among them — and the table
   * was the weaker answer each time: learned from sentinels, it read a value unlike them wrong or
   * not at all. The hand rules are checked against all three engines, value by value, by
   * `check-hand-splits.mjs` and `check-must-split.mjs`.
   *
   * The table stays for what the CHECKER reads — `word-out-of-its-longhand` asks `misplacedWord` of
   * its `takes` — which is about whether a word is valid CSS for a longhand, not about how a value
   * is split; a review asked, and on every value those gates hold it reports nothing.
   */
  const split =
    byHand !== undefined
      ? !holdsVar(bare) && !tokensOf(bare).some((one) => WIDE.includes(one.toLowerCase()))
        ? // A CSS-wide keyword is refused here rather than spread: `grid-area: inherit` would
          // otherwise read as a line NAME, and be copied into the three lines left out.
          byHand(keywordsFolded(property, bare.trim()))
        : undefined
      : positional !== undefined
        ? splitPositional(positional, bare)
        : grammar === undefined
          ? undefined
          : splitByGrammar(grammar, bare);
  if (split === undefined || bang === null) return split;

  return Object.fromEntries(Object.entries(split).map(([one, each]) => [one, `${each} ${bang[0].trim()}`]));
}

/**
 * The items of one longhand, with every RESET written as a value rather than as `initial`.
 *
 * A longhand no part of the grammar reached is marked `initial`, which says exactly the right
 * thing and is valid on its own. It is not valid as one item of a comma-separated value: `initial`
 * is a CSS-wide keyword, and all three engines reject `scroll-timeline-axis: initial, initial`
 * outright. A rejected declaration sets nothing, so the longhand the shorthand was supposed to
 * reset keeps whatever another class left on it — the silent direction, and how this shipped.
 *
 * The value comes from `initials.generated.ts`, measured on an element nothing has styled and
 * written back in the same run to prove it is a value that may be specified. A longhand the engines
 * DISAGREE about has none, and then the whole value is refused: a family left a shorthand is
 * visibly the author's own text, where one engine's answer written everywhere is not.
 */
function reset(longhand: string, parts: readonly string[]): string | undefined {
  if (!parts.includes("initial")) return parts.join(", ");
  const value = INITIAL_VALUES[longhand];
  if (value === undefined) return undefined;
  return parts.map((one) => (one === "initial" ? value : one)).join(", ");
}

/**
 * A family described by its own GRAMMAR rather than by a list of slots.
 *
 * The slots fill; they do not parse. Where two of them take a token the passes hand it to the
 * closed one and CSS hands it to whichever component the grammar reaches first, and all three
 * engines side with the grammar — `animation: --zz` is a name, `mask: 7px` is a position. Reading
 * the value against the grammar answers both, and it answers a shape a slot list cannot hold at
 * all: `<bg-position> [ / <bg-size> ]?`, two longhands told apart by a separator.
 *
 * The tree is the family's grammar OPENED — see `openGrammar.ts` — so every leaf of it belongs to
 * a longhand. {@link GrammarShape} is declared beside the table that carries it, the way every
 * other generated shape in here is.
 */
const LEAF_KINDS = new Set(["keyword", "data", "property", "function"]);

/**
 * A plain identifier, which is what `<custom-ident>` means.
 *
 * An OPEN leaf takes a free identifier, so in the slot passes it is asked LAST and only where every
 * closed slot has said no. A parse says the same thing differently: the grammar's own order decides
 * who is asked first and backtracking gives up a choice that leaves the rest unreadable. What the
 * open leaf still must not do is take a token that is not an identifier at all — `list-style` has
 * an open `list-style-type` standing before `list-style-image`, and `url(a.png)` belongs to the
 * second. A dimension and a call are both refused here for that reason.
 */
const AN_IDENT = /^-{0,2}[a-z_][\w-]*$/i;

/**
 * A match against a FINITE list: a word the leaf spells, a named colour, a function it calls.
 *
 * This is the line an open leaf stands down for. It is not "anything another leaf accepts": a
 * `<dashed-ident>` or a `<length>` admits endlessly many tokens and names none of them, which is
 * exactly why the slot passes put `animation: --zz` in the timeline.
 */
function namesIt(leaf: GrammarLeaf, token: string): boolean {
  const lower = token.toLowerCase();
  if (leaf.words.some((one) => one.toLowerCase() === lower)) return true;
  if (leaf.types.includes("color") && COLOUR_WORDS.has(lower)) return true;
  const call = /^([a-z-]+)\(/i.exec(lower);
  return call !== null && leaf.functions.includes(call[1] ?? "");
}

/**
 * Whether one leaf takes this token: what a slot takes, plus a free identifier where it is open.
 *
 * **An open leaf stands down for a leaf that NAMES the token, and beats one that merely admits
 * it.** Three measured cases, and no two of them agree on a simpler rule:
 *
 * ```
 * animation: --zz            name over timeline    <dashed-ident> names nothing, so open wins
 * transition: linear         easing over property  `linear` is a word, so open stands down
 * text-emphasis: rebeccapurple  colour over style  a named colour is a word too
 * ```
 *
 * The first is what the slot passes get wrong and the parse exists for; the second and third are
 * what the parse got wrong until the line was drawn here rather than at "any other leaf accepts
 * it". A leaf that spells the token beats an open one; a leaf that would take any `--x` or any
 * length does not.
 *
 * A leaf that names the token ITSELF never reaches this — `accepts` answers first, which is what
 * keeps `list-style: none` on the type where `list-style-image` also spells `none`.
 */
function takes(leaf: GrammarLeaf, token: string, leaves: readonly GrammarLeaf[]): boolean {
  if (accepts(leaf, token)) return true;
  if (!leaf.open || !AN_IDENT.test(token)) return false;
  return !leaves.some((one) => one !== leaf && namesIt(one, token));
}

/**
 * The leaves of a tree, in the order `openGrammar` collected them.
 *
 * A separator is not one: it belongs to no longhand, and the walk here has to skip it exactly where
 * the opener did or every leaf after it takes the wrong description.
 */
function leavesOf(term: Term, out: Term[] = []): Term[] {
  if (term.kind === "literal") return out;
  if (LEAF_KINDS.has(term.kind)) {
    out.push(term);
    return out;
  }
  for (const one of term.terms ?? []) leavesOf(one, out);
  return out;
}

/**
 * Read one value against the family's grammar and say what each longhand gets.
 *
 * A longhand no leaf reached is `initial`, which is what the shorthand does to it. A value the
 * grammar cannot read at all is refused, and a refusal leaves the declaration the author's own
 * text — where a wrong split is invisible.
 */
function byGrammar(shape: GrammarShape, value: string): Record<string, string> | undefined {
  const tokens = tokensOf(value);
  if (tokens.length === 0) return undefined;
  if (tokens.some((one) => WIDE.includes(one.toLowerCase()))) {
    if (tokens.length !== 1) return undefined;
    return Object.fromEntries(shape.longhands.map((one) => [one, tokens[0] as string]));
  }

  const leaves = leavesOf(shape.tree);
  // The table and the tree are written together, so a mismatch is a corrupt table rather than a
  // value this cannot read — refusing says so without guessing which leaf lost its description.
  if (leaves.length !== shape.leaves.length) return undefined;
  const described = new Map<Term, GrammarLeaf>(leaves.map((one, index) => [one, shape.leaves[index] as GrammarLeaf]));

  const taken = matchValue(shape.tree, tokens, (term, token) =>
    term.kind === "literal" ? term.name === token : takes(described.get(term) as GrammarLeaf, token, shape.leaves),
  );
  if (taken === undefined) return undefined;

  const out: Record<string, string> = Object.fromEntries(shape.longhands.map((one) => [one, "initial"]));
  const written = new Set<string>();
  for (const [term, got] of taken) {
    const leaf = described.get(term);
    if (leaf === undefined) continue; // A separator: read by the parse, owned by no longhand.
    /**
     * A leaf feeding SEVERAL longhands hands each of them the same token — `border`'s
     * `<line-width>` puts `1px` on every side. More than one token is a different question:
     * `scroll-margin: 1px 2px` is one leaf, `<length>{1,4}`, and it put `"1px 2px"` on every side,
     * which no side accepts, so the browser dropped all four. Which value goes to which side is
     * POSITIONAL, and this splitter does not answer it.
     */
    if (leaf.longhands.length > 1 && got.length > 1) return undefined;
    /**
     * Several leaves may feed ONE longhand, and then their tokens add up rather than overwrite.
     * `font-variant-numeric` is fed by five leaves of `font-variant`; each used to write the whole
     * longhand, so `tabular-nums slashed-zero` kept only the last.
     */
    for (const longhand of leaf.longhands) {
      const token = got.join(" ");
      out[longhand] = written.has(longhand) ? `${out[longhand]} ${token}` : token;
      written.add(longhand);
    }
  }
  return out;
}

/** Whether a value has an empty comma-separated item, outside quotes and parentheses. */
function emptyItem(value: string): boolean {
  let depth = 0;
  let quote = "";
  let held = false;
  let commas = 0;
  for (const ch of value) {
    if (quote !== "") {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      held = true;
    } else if (ch === "(") {
      depth++;
      held = true;
    } else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      if (!held) return true;
      commas++;
      held = false;
    } else if (!/\s/.test(ch)) held = true;
  }
  return commas > 0 && !held;
}

/**
 * Split by the grammar, one value or a comma-separated list of them.
 *
 * The list case is `byGrammar` per item joined back per longhand, and the reason it is a few lines
 * rather than a second splitter is this:
 * every longhand of a comma family takes a list the same length, and the lists are matched by
 * POSITION — so one bad item refuses the whole value rather than shortening one list.
 */
export function splitByGrammar(shape: GrammarShape, value: string): Record<string, string> | undefined {
  if (holdsVar(value)) return undefined;
  /**
   * A value the ENGINES read differently from each other, which no one split can satisfy.
   *
   * Measured, `animation: auto` is `animation-name: auto` in Firefox and touches nothing in
   * Chromium or WebKit — so either answer is wrong in some browser. The value keeps its shorthand
   * and every other value of the family still splits, which is what refusing the whole family for
   * one value used to cost.
   */
  if (shape.contested !== undefined || shape.partial !== undefined) {
    const written = tokensOf(value, /[\s,]/).map((one) => one.toLowerCase());
    if (written.some((one) => shape.contested?.includes(one))) return undefined;
    /**
     * And a word one engine does not HAVE — `text-wrap: pretty` in Firefox. That engine drops the
     * whole declaration and a split would still set the rest there. Kept whole, and not an error:
     * one browser lacking a value is what its author expects, which reading it differently is not.
     */
    if (written.some((one) => shape.partial?.includes(one))) return undefined;
  }

  if (shape.list !== true) {
    if (tokensOf(value, /,/).length > 1) return undefined;
    return byGrammar(shape, value);
  }

  const items = tokensOf(value, /,/).map((one) => one.trim());
  if (items.length === 0 || items.some((one) => one === "")) return undefined;

  const first = items[0] as string;
  if (items.length === 1 && WIDE.includes(first.toLowerCase()))
    return Object.fromEntries(shape.longhands.map((one) => [one, first]));

  if (items.some((one) => WIDE.includes(one.toLowerCase()))) return undefined;

  const per = items.map((one) => byGrammar(shape, one));
  if (per.some((one) => one === undefined)) return undefined;

  /**
   * A longhand the family resets ONCE rather than once per item.
   *
   * `animation: 4s, 9s` gives `animation-duration: 4s, 9s` and `animation-timeline: auto` — one
   * value for two items. Which longhands do that is measured and carried in the shape, because the
   * grammar cannot say: `animation-timeline` has a part in the item and `animation-range-start`
   * has none, and both behave this way. A rule written from the grammar — "a longhand no part
   * mentions is reset once" — got `animation-timeline` wrong, and the corpus caught it.
   */
  const once = new Set(shape.resetOnce ?? []);

  const out: Record<string, string> = {};
  for (const longhand of shape.longhands) {
    if (once.has(longhand)) {
      /**
       * A longhand the shorthand resets once is one it cannot SET, so a token the parse gave it
       * makes the value invalid. `animation: 1s spin scroll()` is rejected by all three engines;
       * writing `initial` here and applying the rest was half of a declaration CSS drops.
       */
      if (per.some((each) => (each as Record<string, string>)[longhand] !== "initial")) return undefined;
      out[longhand] = "initial";
      continue;
    }
    // `initial` cannot be one item of a list, so the reset is written as a value.
    const written = reset(
      longhand,
      per.map((each) => (each as Record<string, string>)[longhand] as string),
    );
    if (written === undefined) return undefined;
    out[longhand] = written;
  }
  return out;
}

/**
 * A value with the property's KEYWORDS in lower case, and everything else as written.
 *
 * The compiler folds a keyword's case only for a property whose values are a closed list, so a
 * property that also takes names of the author's own — `grid-column`, `font`, `container` — reached
 * the hand rules as written: `grid-column: SPAN 2` matched nothing and stayed whole, though every
 * engine takes it, CSS keywords ignoring case. Folded here, word by word, and only a word the
 * property lists; a quoted string, a function's contents and a name keep their case — a container's
 * NAME is before its `/`, and only the type after it is folded. So does a grid line name in
 * brackets: `[Dense]` and `[None]` are names spelled like keywords, and folding them made the split
 * name a different line than the shorthand, in all three engines. A review found it.
 */
/** A property's foldable words, made once per property — they were made on every value. */
const foldable = new Map<string, ReadonlySet<string>>();

function keywordsFolded(property: string, value: string): string {
  let words = foldable.get(property);
  if (words === undefined) {
    words = new Set((VALUE_WORDS[property] ?? "").split(" ").filter((one) => one !== "" && !one.endsWith("()")));
    foldable.set(property, words);
  }
  if (words.size === 0) return value;
  let out = "";
  let word = "";
  let depth = 0;
  let quote = "";
  // Before the `/`, a container's words are its NAMES, which are the author's and case-sensitive.
  let folding = property !== "container";
  const flush = () => {
    out += folding && words.has(word.toLowerCase()) ? word.toLowerCase() : word;
    word = "";
  };
  for (const ch of value) {
    if (quote !== "") {
      out += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (depth === 0 && /[\w-]/.test(ch)) {
      word += ch;
      continue;
    }
    flush();
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (depth === 0 && ch === "/") folding = true;
    out += ch;
  }
  flush();
  return out;
}
