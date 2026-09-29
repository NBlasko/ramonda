import { KEYWORDS } from "./keywords.generated";
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
   * Comma-separated LAYERS, each read on its own and the lists joined back — `background-image` gets
   * one item per layer, and so does every other longhand but the colour, which only the last layer
   * may give.
   */
  background: (value) => {
    const items = itemsOf(value);
    if (items === undefined) return undefined;
    const layers = items.map((item, index) => layerOf(item, index === items.length - 1));
    if (layers.some((one) => one === undefined)) return undefined;
    const read = layers as Layer[];
    const list = (pick: (layer: Layer) => string) => read.map(pick).join(", ");
    return {
      "background-image": list((one) => one.image),
      "background-position-x": list((one) => one.x),
      "background-position-y": list((one) => one.y),
      "background-size": list((one) => one.size),
      "background-repeat": list((one) => one.repeat),
      "background-attachment": list((one) => one.attachment),
      "background-origin": list((one) => one.origin),
      "background-clip": list((one) => one.clip),
      "background-color": read[read.length - 1].color,
    };
  },

  "background-position": (value) => positions(value, "background-position-x", "background-position-y", true),
  /**
   * Into the PREFIXED longhands, the only names all three engines have: Chromium and WebKit expand
   * `mask-position` into `-webkit-mask-position-x` and `-y` and have no `mask-position-x`, and
   * Firefox takes the prefixed names as its own longhands' other names.
   */
  "mask-position": (value) => positions(value, "-webkit-mask-position-x", "-webkit-mask-position-y", false),
  "-webkit-mask-position": (value) => positions(value, "-webkit-mask-position-x", "-webkit-mask-position-y", false),

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

/**
 * A comma list of `<position>`s, as its two lists of axes — `left 10px top 5px, center` is
 * `x: left 10px, center` and `y: top 5px, center`.
 */
function positions(value: string, x: string, y: string, threeValues: boolean): Record<string, string> | undefined {
  const items = itemsOf(value);
  if (items === undefined) return undefined;
  // Three values are `background-position`'s own legacy form; `mask-position` takes a plain
  // `<position>`, which has none, and all three engines refuse `mask-position: left 10px top`.
  if (!threeValues && items.some((one) => tokensOf(one).length === 3)) return undefined;
  const axes = items.map(positionOf);
  if (axes.some((one) => one === undefined)) return undefined;
  const pairs = axes as [string, string][];
  return { [x]: pairs.map((one) => one[0]).join(", "), [y]: pairs.map((one) => one[1]).join(", ") };
}

/** The items of a comma list, or nothing when one of them is empty — which CSS refuses. */
function itemsOf(value: string): string[] | undefined {
  const items: string[] = [];
  let depth = 0;
  let at = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth === 0 && ch === ",") {
      items.push(at.trim());
      at = "";
      continue;
    }
    at += ch;
  }
  items.push(at.trim());
  return items.some((one) => one === "") ? undefined : items;
}

const X_EDGE = ["left", "right"];
const Y_EDGE = ["top", "bottom"];
const OFFSET = /^([+-]?(\d+\.?\d*|\.\d+)([a-z]+|%)?|calc\(.*\))$/i;
/** A length, a percentage or a `calc()` — and `0`, the one number CSS takes as a length. */
const isOffset = (one: string | undefined) =>
  one !== undefined && (one === "0" || (OFFSET.test(one) && !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(one)));

/**
 * One `<position>` as its horizontal and vertical parts, as CSS reads it.
 *
 * One value names one axis and centres the other; two are horizontal then vertical, except that two
 * KEYWORDS may come either way round (`top left`); three or four pair an edge with an offset
 * (`left 10px top`, `right 3px bottom 10%`), the two sides in either order.
 */
function positionOf(item: string): [string, string] | undefined {
  const t = tokensOf(item);
  const x = (one: string) => X_EDGE.includes(one) || one === "center";
  const y = (one: string) => Y_EDGE.includes(one) || one === "center";

  if (t.length === 1) {
    const [one] = t;
    if (Y_EDGE.includes(one)) return ["center", one];
    if (x(one) || isOffset(one)) return [one, "center"];
    return undefined;
  }
  if (t.length === 2) {
    const [a, b] = t;
    if ((x(a) || isOffset(a)) && (y(b) || isOffset(b))) return [a, b];
    if (y(a) && x(b) && !isOffset(a) && !isOffset(b)) return [b, a];
    return undefined;
  }
  if (t.length === 3 || t.length === 4) {
    // Two sides, each `center`, an edge, or an edge and its offset.
    const sides: string[][] = [];
    for (let at = 0; at < t.length; ) {
      const edge = t[at];
      if (edge === "center") {
        sides.push([edge]);
        at++;
      } else if ([...X_EDGE, ...Y_EDGE].includes(edge)) {
        const offset = isOffset(t[at + 1]) ? t[at + 1] : undefined;
        sides.push(offset === undefined ? [edge] : [edge, offset]);
        at += offset === undefined ? 1 : 2;
      } else return undefined;
    }
    if (sides.length !== 2 || sides.every((one) => one.length === 1)) return undefined;
    const [first, second] = sides;
    const horizontal = (side: string[]) => X_EDGE.includes(side[0]) || (side[0] === "center" && side.length === 1);
    const vertical = (side: string[]) => Y_EDGE.includes(side[0]) || (side[0] === "center" && side.length === 1);
    if (horizontal(first) && vertical(second)) return [first.join(" "), second.join(" ")];
    if (vertical(first) && horizontal(second)) return [second.join(" "), first.join(" ")];
    return undefined;
  }
  return undefined;
}

interface Layer {
  image: string;
  x: string;
  y: string;
  size: string;
  repeat: string;
  attachment: string;
  origin: string;
  clip: string;
  color: string;
}

const IMAGE =
  /^(none|url\(|(-webkit-)?(repeating-)?(linear|radial|conic)-gradient\(|(-webkit-)?image-set\(|image\(|(-webkit-)?cross-fade\(|(-moz-)?element\(|paint\()/i;
const ATTACHMENT = ["scroll", "fixed", "local"];
const BOX = ["border-box", "padding-box", "content-box"];
const REPEAT_ONE = ["repeat-x", "repeat-y"];
const REPEAT = ["repeat", "space", "round", "no-repeat"];
const POSITION_WORD = ["left", "right", "top", "bottom", "center"];
const COLOUR_WORDS = new Set((KEYWORDS["background-color"] ?? "").split(" "));
const COLOUR_FUNCTION = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|device-cmyk)\(/i;
const isColour = (one: string) =>
  COLOUR_WORDS.has(one.toLowerCase()) ||
  /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(one) ||
  COLOUR_FUNCTION.test(one);

/** A value's tokens with a top-level `/` as a token of its own — `center/cover` is three. */
function slashed(value: string): string[] {
  let spaced = "";
  let depth = 0;
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    spaced += depth === 0 && ch === "/" ? " / " : ch;
  }
  return tokensOf(spaced);
}

/**
 * One layer of `background`, each part at most once, in any order — and the position's words
 * together, with its size straight after a `/`. `undefined` for anything else, which keeps the
 * shorthand.
 */
function layerOf(item: string, last: boolean): Layer | undefined {
  const t = slashed(item);
  const layer: Partial<Layer> & { boxes?: string[] } = {};
  for (let at = 0; at < t.length; ) {
    const one = t[at];
    if (IMAGE.test(one) && layer.image === undefined) {
      layer.image = one;
      at++;
    } else if (ATTACHMENT.includes(one) && layer.attachment === undefined) {
      layer.attachment = one;
      at++;
    } else if (BOX.includes(one) && (layer.boxes?.length ?? 0) < 2) {
      layer.boxes = [...(layer.boxes ?? []), one];
      at++;
    } else if (REPEAT_ONE.includes(one) && layer.repeat === undefined) {
      layer.repeat = one;
      at++;
    } else if (REPEAT.includes(one) && layer.repeat === undefined) {
      const two = REPEAT.includes(t[at + 1] ?? "");
      layer.repeat = two ? `${one} ${t[at + 1]}` : one;
      at += two ? 2 : 1;
    } else if ((POSITION_WORD.includes(one) || isOffset(one)) && layer.x === undefined) {
      let end = at;
      while (end < t.length && (POSITION_WORD.includes(t[end]) || isOffset(t[end]))) end++;
      const axes = positionOf(t.slice(at, end).join(" "));
      if (axes === undefined) return undefined;
      [layer.x, layer.y] = axes;
      at = end;
      if (t[at] === "/") {
        let stop = at + 1;
        while (stop < t.length && stop < at + 3 && (t[stop] === "auto" || isOffset(t[stop]))) stop++;
        const size = t[at + 1] === "cover" || t[at + 1] === "contain" ? [t[at + 1]] : t.slice(at + 1, stop);
        if (size.length === 0) return undefined;
        layer.size = size.join(" ");
        at += 1 + size.length;
      }
    } else if (last && isColour(one) && layer.color === undefined) {
      layer.color = one;
      at++;
    } else return undefined;
  }
  const [origin, clip] = layer.boxes ?? [];
  return {
    image: layer.image ?? "none",
    x: layer.x ?? "0%",
    y: layer.y ?? "0%",
    size: layer.size ?? "auto",
    repeat: layer.repeat ?? "repeat",
    attachment: layer.attachment ?? "scroll",
    origin: origin ?? "padding-box",
    clip: clip ?? origin ?? "border-box",
    color: layer.color ?? "transparent",
  };
}
