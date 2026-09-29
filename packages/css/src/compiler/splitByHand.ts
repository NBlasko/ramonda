import { tokensOf } from "./split";

/**
 * The families neither table can answer, split by rules written out by hand.
 *
 * `SHAPES` learns a family from the engines by the POSITION of its values and `GRAMMAR_SHAPES` by
 * its own grammar. Some families fit neither, and each for a reason of its own:
 *
 * - a keyword that stands for SEVERAL longhands at once — `white-space: pre` is `preserve` and
 *   `nowrap`, `flex: none` is `0 0 auto`;
 * - a word that switches a longhand ON rather than being its value — `font-synthesis: weight`;
 * - a value of several words that belongs to ONE longhand — `grid-area: span 2`,
 *   `contain-intrinsic-size: auto 7px`;
 * - a rule that copies one part into another — `grid-area: a` names all four lines.
 *
 * These are CSS's own rules, from the specification, and the specification is not the oracle —
 * the engines are. `check-hand-splits.mjs` puts every value of a corpus into Chromium, Firefox and
 * WebKit twice, once as the shorthand and once as what this returns, and compares every computed
 * property. A rule here that an engine does not follow fails there, not on a page.
 *
 * Each returns `undefined` for a value it does not recognise, which keeps the shorthand. That is
 * always safe: the declaration reaches the sheet as the author wrote it. `splitOf` has already
 * refused a `var()` and handled a CSS-wide keyword before any of these is asked.
 */
export const BY_HAND: Readonly<Record<string, (value: string) => Record<string, string> | undefined>> = {
  marker: (value) => {
    const tokens = tokensOf(value);
    if (tokens.length !== 1) return undefined;
    const [one] = tokens;
    if (one !== "none" && !/^url\(/i.test(one)) return undefined;
    return { "marker-start": one, "marker-mid": one, "marker-end": one };
  },

  "white-space": (value) => {
    const tokens = tokensOf(value);
    const whole = WHITE_SPACE_WORDS[tokens.join(" ")];
    if (tokens.length === 1 && whole !== undefined) return whole;

    let collapse: string | undefined;
    let mode: string | undefined;
    for (const one of tokens) {
      if (COLLAPSE.includes(one) && collapse === undefined) collapse = one;
      else if (WRAP_MODE.includes(one) && mode === undefined) mode = one;
      else return undefined;
    }
    return { "white-space-collapse": collapse ?? "collapse", "text-wrap-mode": mode ?? "wrap" };
  },

  "font-synthesis": (value) => {
    const tokens = tokensOf(value);
    const on = new Set<string>();
    if (!(tokens.length === 1 && tokens[0] === "none")) {
      for (const one of tokens) {
        // `position` is refused as a word: Chromium does not take it and drops the declaration,
        // where a split would still switch the others off. Its longhand is still reset below.
        if (!SYNTHESIS.includes(one) || one === "position" || on.has(one)) return undefined;
        on.add(one);
      }
    }
    return Object.fromEntries(SYNTHESIS.map((one) => [`font-synthesis-${one}`, on.has(one) ? "auto" : "none"]));
  },

  "-webkit-text-stroke": (value) => {
    const tokens = tokensOf(value);
    if (tokens.length === 0 || tokens.length > 2) return undefined;
    let width: string | undefined;
    let color: string | undefined;
    for (const one of tokens) {
      if (LINE_WIDTH.test(one) && width === undefined) width = one;
      else if (!LINE_WIDTH.test(one) && color === undefined) color = one;
      else return undefined;
    }
    return { "-webkit-text-stroke-width": width ?? "0", "-webkit-text-stroke-color": color ?? "currentcolor" };
  },

  "contain-intrinsic-size": (value) => {
    const groups: string[] = [];
    const tokens = tokensOf(value);
    for (let at = 0; at < tokens.length; at++) {
      const auto = tokens[at] === "auto";
      const size = auto ? tokens[at + 1] : tokens[at];
      if (size === undefined || !(size === "none" || LENGTH.test(size))) return undefined;
      groups.push(auto ? `auto ${size}` : size);
      if (auto) at++;
    }
    if (groups.length === 0 || groups.length > 2) return undefined;
    return { "contain-intrinsic-width": groups[0], "contain-intrinsic-height": groups[1] ?? groups[0] };
  },

  flex: (value) => {
    const tokens = tokensOf(value);
    if (tokens.length === 1 && tokens[0] === "none") return flex("0", "0", "auto");
    if (tokens.length === 1 && tokens[0] === "auto") return flex("1", "1", "auto");

    const numbers = tokens.filter((one) => NUMBER.test(one));
    const bases = tokens.filter((one) => !NUMBER.test(one));
    if (bases.length > 1 || numbers.length > 2 || numbers.length + bases.length === 0) return undefined;
    if (bases.length === 1 && !BASIS.test(bases[0])) return undefined;
    // The basis goes first or last, never between the two factors, and the factors stay together.
    if (bases.length === 1 && numbers.length === 2 && tokens[1] === bases[0]) return undefined;
    const [grow, shrink] = numbers;
    return flex(grow ?? "1", shrink ?? "1", bases[0] ?? (numbers.length > 0 ? "0%" : "auto"));
  },

  "grid-area": (value) => {
    const parts = value.split("/").map((one) => one.trim());
    if (parts.length > 4 || parts.some((one) => !GRID_LINE(one))) return undefined;
    const [rowStart, given2, given3, given4] = parts;
    const columnStart = given2 ?? (isIdent(rowStart) ? rowStart : "auto");
    return {
      "grid-row-start": rowStart,
      "grid-column-start": columnStart,
      "grid-row-end": given3 ?? (isIdent(rowStart) ? rowStart : "auto"),
      "grid-column-end": given4 ?? (isIdent(columnStart) ? columnStart : "auto"),
    };
  },

  "text-box": (value) => {
    const tokens = tokensOf(value);
    if (tokens.length === 1 && tokens[0] === "normal") return { "text-box-trim": "none", "text-box-edge": "auto" };
    const trims = tokens.filter((one) => TRIM.includes(one));
    if (trims.length > 1 || tokens.length === 0) return undefined;
    // The edge's words are one value, so the trim goes before them or after them, never between.
    const at = trims.length === 0 ? -1 : tokens.indexOf(trims[0]);
    if (at > 0 && at < tokens.length - 1) return undefined;
    const edges = tokens.filter((_one, index) => index !== at);
    if (edges.length > 2) return undefined;
    if (!(edges.length === 0 || (edges.length === 1 && edges[0] === "auto") || edgeWords(edges))) return undefined;
    return { "text-box-trim": trims[0] ?? "trim-both", "text-box-edge": edges.join(" ") || "auto" };
  },

  /**
   * An alias of `border-block-start`, split into its OWN prefixed longhands. Splitting it into the
   * standard ones would make it work in Firefox, which does not have it and drops the declaration.
   */
  "-webkit-border-before": (value) => {
    const tokens = tokensOf(value);
    if (tokens.length === 0 || tokens.length > 3) return undefined;
    let width: string | undefined;
    let style: string | undefined;
    let color: string | undefined;
    for (const one of tokens) {
      if (LINE_WIDTH.test(one) && width === undefined) width = one;
      else if (LINE_STYLE.includes(one) && style === undefined) style = one;
      else if (!LINE_WIDTH.test(one) && !LINE_STYLE.includes(one) && color === undefined) color = one;
      else return undefined;
    }
    return {
      "-webkit-border-before-width": width ?? "medium",
      "-webkit-border-before-style": style ?? "none",
      "-webkit-border-before-color": color ?? "currentcolor",
    };
  },
};

const flex = (grow: string, shrink: string, basis: string) => ({
  "flex-grow": grow,
  "flex-shrink": shrink,
  "flex-basis": basis,
});

const WHITE_SPACE_WORDS: Readonly<Record<string, Record<string, string>>> = {
  normal: { "white-space-collapse": "collapse", "text-wrap-mode": "wrap" },
  pre: { "white-space-collapse": "preserve", "text-wrap-mode": "nowrap" },
  "pre-wrap": { "white-space-collapse": "preserve", "text-wrap-mode": "wrap" },
  "pre-line": { "white-space-collapse": "preserve-breaks", "text-wrap-mode": "wrap" },
};
const COLLAPSE = ["collapse", "preserve", "preserve-breaks", "break-spaces"];
const WRAP_MODE = ["wrap", "nowrap"];
const SYNTHESIS = ["weight", "style", "small-caps", "position"];
const TRIM = ["none", "trim-start", "trim-end", "trim-both"];
const LINE_STYLE = ["none", "hidden", "dotted", "dashed", "solid", "double", "groove", "ridge", "inset", "outset"];

const NUMBER = /^[+]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const LENGTH = /^([+]?(\d+\.?\d*|\.\d+)[a-z]+|0|calc\(.*\))$/i;
const LINE_WIDTH = /^(thin|medium|thick|0|[+]?(\d+\.?\d*|\.\d+)[a-z]+|calc\(.*\))$/i;
const BASIS =
  /^(auto|content|max-content|min-content|fit-content|fit-content\(.*\)|[+]?(\d+\.?\d*|\.\d+)([a-z]+|%)|calc\(.*\))$/i;

/**
 * The edges every engine with `text-box` takes. Narrower than the grammar on purpose: Chromium
 * refuses `cap` alone and `ideographic ideographic-ink`, which WebKit takes, and a value one engine
 * refuses must keep its shorthand — see `check-hand-splits.mjs`.
 */
const EDGE_OVER = ["text", "cap", "ex"];
const EDGE_UNDER = ["text", "alphabetic"];
const edgeWords = (words: readonly string[]) =>
  words.length === 1 ? words[0] === "text" : EDGE_OVER.includes(words[0]) && EDGE_UNDER.includes(words[1]);

/** A `<custom-ident>` standing alone, which is what `grid-area` copies into the lines left out. */
const isIdent = (part: string) => /^-?[a-z_][\w-]*$/i.test(part) && !["auto", "span"].includes(part.toLowerCase());

/** `auto`, a name, `2`, `2 name`, `span 2`, `span name`, `span 2 name` — in any order CSS allows. */
const GRID_LINE = (part: string): boolean => {
  const words = tokensOf(part);
  if (words.length === 1) return words[0] === "auto" || isIdent(words[0]) || /^-?\d+$/.test(words[0]);
  if (words.length > 3) return false;
  const span = words.filter((one) => one === "span").length;
  const numbers = words.filter((one) => /^-?\d+$/.test(one)).length;
  const names = words.filter((one) => isIdent(one)).length;
  return span <= 1 && numbers <= 1 && names <= 1 && span + numbers + names === words.length && numbers + names >= 1;
};
