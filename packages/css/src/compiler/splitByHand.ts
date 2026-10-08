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
    const layers = items.map((item, index) => layerOf(item, index === items.length - 1, BACKGROUND));
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

  /**
   * Layer by layer like `background`, with no colour and two parts of its own — a compositing
   * operator and a mode. Into `-webkit-mask-position-x` and `-y`, the only position names all three
   * engines have (see `mask-position`), and with every `mask-border` longhand reset: WebKit's `mask`
   * resets them, and the other two do not have them, so writing `initial` there changes nothing.
   */
  mask: (value) => {
    const items = itemsOf(value);
    if (items === undefined) return undefined;
    const layers = items.map((item) => layerOf(item, false, MASK));
    if (layers.some((one) => one === undefined)) return undefined;
    const read = layers as Layer[];
    const list = (pick: (layer: Layer) => string) => read.map(pick).join(", ");
    return {
      "mask-image": list((one) => one.image),
      "-webkit-mask-position-x": list((one) => one.x),
      "-webkit-mask-position-y": list((one) => one.y),
      "mask-size": list((one) => one.size),
      "mask-repeat": list((one) => one.repeat),
      "mask-origin": list((one) => one.origin),
      "mask-clip": list((one) => one.clip),
      "mask-composite": list((one) => one.composite),
      "mask-mode": list((one) => one.mode),
      "mask-border-source": "initial",
      "mask-border-slice": "initial",
      "mask-border-width": "initial",
      "mask-border-outset": "initial",
      "mask-border-repeat": "initial",
    };
  },

  /**
   * `font`, which resets every font longhand and sets up to seven of them.
   *
   * Up to four of style, the CSS2 variant, weight and width in any order — `normal` belonging to
   * any of them — then the size, an optional `/ line-height`, and the family list, which is the
   * rest of the value. A system font (`caption`, `menu`) is refused: what it sets is the platform's
   * and unknown here. Every other longhand is written out at the value `font` resets it to, and it
   * has to be: most are INHERITED, so a longhand left out takes the parent's value where the
   * shorthand gives the initial one.
   */
  font: (value) => {
    const t = slashed(value);
    const set: Record<string, string> = {};
    let at = 0;
    let normals = 0;
    for (; at < t.length && at < 4; at++) {
      const one = t[at];
      if (one === "normal") normals++;
      else if (FONT_STYLE.includes(one) && set["font-style"] === undefined) {
        const angle = one === "oblique" && /^[+-]?[\d.]+(deg|rad|grad|turn)$/.test(t[at + 1] ?? "");
        set["font-style"] = angle ? `oblique ${t[++at]}` : one;
      } else if (one === "small-caps" && set["font-variant-caps"] === undefined) set["font-variant-caps"] = one;
      else if ((FONT_WEIGHT.includes(one) || /^\d+(\.\d+)?$/.test(one)) && set["font-weight"] === undefined)
        set["font-weight"] = one;
      else if (FONT_WIDTH.includes(one) && set["font-stretch"] === undefined) set["font-stretch"] = one;
      else break;
    }
    if (Object.keys(set).length + normals > 4) return undefined;

    const size = t[at];
    if (size === undefined || !(FONT_SIZE.includes(size) || isOffset(size))) return undefined;
    at++;
    let lineHeight = "normal";
    if (t[at] === "/") {
      const given = t[at + 1];
      if (given === undefined || !(given === "normal" || isOffset(given) || /^[\d.]+$/.test(given))) return undefined;
      lineHeight = given;
      at += 2;
    }
    const family = t.slice(at).join(" ");
    if (family === "" || !familyList(family)) return undefined;

    return {
      ...FONT_RESETS,
      "font-style": set["font-style"] ?? "normal",
      "font-variant-caps": set["font-variant-caps"] ?? "normal",
      "font-weight": set["font-weight"] ?? "normal",
      "font-stretch": set["font-stretch"] ?? "normal",
      "font-size": size,
      "line-height": lineHeight,
      "font-family": family,
    };
  },

  /**
   * A list of ranges, each a start and an optional end. An end left out is the start's RANGE NAME,
   * and a length after a name is that name's offset — `cover 10%` runs from `cover 10%` to `cover`.
   * Measured in Chromium and WebKit; a positional reading gets it the other way round.
   */
  "animation-range": (value) => ranges(value, "animation-range-start", "animation-range-end"),

  /**
   * The two halves of `timeline-trigger`, shorthands of their own since Chromium split them. The same
   * rule as `animation-range` — measured: `contain` alone runs to `contain`, which a table learned
   * from sentinels wrote as `normal` — and each half's own blank, as `triggerOf` has it.
   */
  "timeline-trigger-activation-range": (value) =>
    ranges(value, "timeline-trigger-activation-range-start", "timeline-trigger-activation-range-end"),
  "timeline-trigger-active-range": (value) =>
    ranges(value, "timeline-trigger-active-range-start", "timeline-trigger-active-range-end", "auto"),

  /**
   * Per item: a name, an optional source, the activation range, and after a `/` the active range.
   * Chromium is the only engine with it, and what it does is what this writes — measured.
   */
  "timeline-trigger": (value) => {
    const items = itemsOf(value);
    if (items === undefined) return undefined;
    const read = items.map(triggerOf);
    if (read.some((one) => one === undefined)) return undefined;
    const all = read as string[][];
    const list = (at: number) => all.map((one) => one[at]).join(", ");
    return {
      "timeline-trigger-name": list(0),
      "timeline-trigger-source": list(1),
      "timeline-trigger-activation-range-start": list(2),
      "timeline-trigger-activation-range-end": list(3),
      "timeline-trigger-active-range-start": list(4),
      "timeline-trigger-active-range-end": list(5),
    };
  },

  /**
   * Rows and columns across a `/`, or the AREAS form: each row a string, with its size and its line
   * names around it. Line names that meet between two rows are one set — `[y] [z]` is `[y z]` — and
   * a row with no size is `auto`. Read off Chromium and WebKit, which agree.
   */
  "grid-template": (value) => gridTemplate(value),

  /**
   * `grid-template`, with the implicit grid reset; or `auto-flow` on one side of the `/`, which
   * makes that side the implicit tracks and the other the explicit ones.
   */
  grid: (value): Record<string, string> | undefined => {
    const t = gridTokens(value);
    if (t === undefined) return undefined;
    const slash = t.indexOf("/");
    const flowAt = t.indexOf("auto-flow");
    if (flowAt === -1) {
      const template = gridTemplate(value);
      return template === undefined
        ? undefined
        : { ...template, "grid-auto-flow": "row", "grid-auto-rows": "auto", "grid-auto-columns": "auto" };
    }
    if (slash === -1 || t.lastIndexOf("/") !== slash) return undefined;
    const left = t.slice(0, slash);
    const right = t.slice(slash + 1);
    const flowSide = flowAt < slash ? left : right;
    const other = flowAt < slash ? right : left;
    const dense = flowSide.filter((one) => one === "dense").length;
    const auto = flowSide.filter((one) => one !== "auto-flow" && one !== "dense");
    // `auto-flow` and `dense` together, first, in either order — then the implicit tracks.
    if (dense > 1 || flowSide.slice(0, 1 + dense).some((one) => one !== "auto-flow" && one !== "dense"))
      return undefined;
    if (other.length === 0 || !tracks(other) || (auto.length > 0 && !tracks(auto))) return undefined;
    const direction = flowAt < slash ? "row" : "column";
    return {
      "grid-template-rows": flowAt < slash ? "none" : other.join(" "),
      "grid-template-columns": flowAt < slash ? other.join(" ") : "none",
      "grid-template-areas": "none",
      "grid-auto-flow": dense > 0 ? `${direction} dense` : direction,
      "grid-auto-rows": flowAt < slash && auto.length > 0 ? auto.join(" ") : "auto",
      "grid-auto-columns": flowAt > slash && auto.length > 0 ? auto.join(" ") : "auto",
    };
  },

  /** Like `border-image`: a source, a slice with an optional width and outset after it, a repeat. */
  "mask-border": (value) =>
    imageBorder(value, "mask-border", { slice: "0", width: "auto", outset: "0", repeat: "stretch" }),

  /** The same shape as `mask-border`, and its own initial values — measured in all three engines. */
  "border-image": (value) =>
    imageBorder(value, "border-image", { slice: "100%", width: "1", outset: "0", repeat: "stretch" }),

  /**
   * An optional position, then an optional path with a distance and a rotation after it, and after
   * a `/` the anchor. `offset: none` is the path alone. The grammar table could not read a position
   * before a path, nor an anchor.
   */
  offset: (value) => {
    const parts = slashed(value);
    const slash = parts.indexOf("/");
    if (slash !== -1 && parts.lastIndexOf("/") !== slash) return undefined;
    const t = slash === -1 ? parts : parts.slice(0, slash);
    const anchorWords = slash === -1 ? undefined : parts.slice(slash + 1);
    let anchor = "auto";
    if (anchorWords !== undefined) {
      if (anchorWords.length === 1 && anchorWords[0] === "auto") anchor = "auto";
      else {
        const axes = positionOf(anchorWords.join(" "));
        if (axes === undefined) return undefined;
        anchor = axes.join(" ");
      }
    }
    let at = 0;
    let position = "normal";
    const pathAt = t.findIndex((one) => OFFSET_PATH.test(one));
    const head = pathAt === -1 ? t : t.slice(0, pathAt);
    if (head.length > 0) {
      if (head.length === 1 && (head[0] === "auto" || head[0] === "normal")) position = head[0];
      else {
        const axes = positionOf(head.join(" "));
        if (axes === undefined) return undefined;
        position = axes.join(" ");
      }
      at = head.length;
    }
    let path = "none";
    let distance = "0px";
    let rotate = "auto";
    if (pathAt !== -1) {
      path = t[pathAt];
      at = pathAt + 1;
      let rotated = false;
      let moved = false;
      while (at < t.length) {
        const one = t[at];
        // An angle before a length: `30deg` would pass as a length, and it is a rotation.
        if (!moved && isOffset(one) && !ANGLE.test(one)) {
          distance = one;
          moved = true;
          at++;
        } else if (!rotated && (one === "auto" || one === "reverse" || ANGLE.test(one))) {
          const two = (one === "auto" || one === "reverse") && ANGLE.test(t[at + 1] ?? "");
          rotate = two ? `${one} ${t[at + 1]}` : one;
          rotated = true;
          at += two ? 2 : 1;
        } else return undefined;
      }
      // A position or a path has to come before the `/` — an anchor alone is not an `offset`.
    } else if (at !== t.length || head.length === 0) return undefined;
    return {
      "offset-position": position,
      "offset-path": path,
      "offset-distance": distance,
      "offset-rotate": rotate,
      "offset-anchor": anchor,
    };
  },

  /**
   * One line or two across a `/`. A line left out is the first one's NAME when it is a name, and
   * `auto` otherwise — `grid-column: a` spans the area `a`, `grid-column: 2` starts at 2 and ends
   * where it may. Measured: every engine says `auto`, so the number is not copied.
   */
  "grid-row": (value) => gridLines(value, "grid-row-start", "grid-row-end"),
  "grid-column": (value) => gridLines(value, "grid-column-start", "grid-column-end"),

  /**
   * Up to four horizontal radii and, after a `/`, up to four vertical ones, each list filled out to
   * four corners the way CSS fills a box — and a corner whose two radii agree written once.
   */
  "border-radius": (value) => {
    const [across, down, extra] = value.split("/").map((one) => tokensOf(one));
    if (extra !== undefined || across.length === 0 || (down !== undefined && down.length === 0)) return undefined;
    const radius = (one: string) => one === "0" || (isOffset(one) && !one.startsWith("-"));
    if (![...across, ...(down ?? [])].every(radius) || across.length > 4 || (down?.length ?? 0) > 4) return undefined;
    const corners = (list: readonly string[]) => [
      list[0],
      list[1] ?? list[0],
      list[2] ?? list[0],
      list[3] ?? list[1] ?? list[0],
    ];
    const h = corners(across);
    const v = corners(down ?? across);
    const corner = (at: number) => (h[at] === v[at] ? h[at] : `${h[at]} ${v[at]}`);
    return {
      "border-top-left-radius": corner(0),
      "border-top-right-radius": corner(1),
      "border-bottom-right-radius": corner(2),
      "border-bottom-left-radius": corner(3),
    };
  },

  "overscroll-behavior": (value) => {
    const t = tokensOf(value);
    if (t.length === 0 || t.length > 2 || !t.every((one) => ["auto", "contain", "none"].includes(one)))
      return undefined;
    return { "overscroll-behavior-x": t[0], "overscroll-behavior-y": t[1] ?? t[0] };
  },

  /**
   * An alignment value may be two words — `first baseline`, `safe center`, `legacy left` — and the
   * positional table could only give a slot one. So the words are grouped first, and each group is
   * checked against what its longhand takes.
   */
  "place-items": (value) => place(value, "align-items", "justify-items", ALIGN_ITEMS, JUSTIFY_ITEMS),
  "place-self": (value) => place(value, "align-self", "justify-self", ALIGN_SELF, JUSTIFY_SELF),
  /**
   * With one value, a baseline puts `justify-content` at `start` — but WebKit refuses a baseline
   * here at all, so one is refused rather than split.
   */
  "place-content": (value) => {
    if (/\bbaseline\b/.test(value)) return undefined;
    return place(value, "align-content", "justify-content", ALIGN_CONTENT, JUSTIFY_CONTENT);
  },

  /**
   * A count, a width, or both in either order; `auto` is whichever is left. Chromium's `columns`
   * resets `column-height` and `column-wrap` too, which the others do not have.
   */
  columns: (value) => {
    const t = tokensOf(value);
    if (t.length === 0 || t.length > 2) return undefined;
    let count: string | undefined;
    let width: string | undefined;
    let autos = 0;
    for (const one of t) {
      if (one === "auto") autos++;
      else if (/^[1-9]\d*$/.test(one) && count === undefined) count = one;
      else if (isOffset(one) && !/^-|%$/.test(one) && width === undefined) width = one;
      else return undefined;
    }
    if (autos + (count ? 1 : 0) + (width ? 1 : 0) !== t.length) return undefined;
    return {
      "column-width": width ?? "auto",
      "column-count": count ?? "auto",
      "column-height": "auto",
      "column-wrap": "auto",
    };
  },

  /** Names, then an optional `/` and a type. */
  container: (value) => {
    const [names, type, extra] = value.split("/").map((one) => one.trim());
    const words = tokensOf(names);
    if (extra !== undefined || words.length === 0) return undefined;
    const none = words.length === 1 && words[0] === "none";
    if (!none && !words.every((one) => isIdent(one) && !["none", "and", "or", "not", "normal"].includes(one)))
      return undefined;
    if (type !== undefined && !["normal", "size", "inline-size"].includes(type)) return undefined;
    return { "container-name": words.join(" "), "container-type": type ?? "normal" };
  },

  "text-decoration": (value) => {
    const t = tokensOf(value);
    const line: string[] = [];
    let style: string | undefined;
    let thickness: string | undefined;
    let color: string | undefined;
    for (const one of t) {
      if (
        DECORATION_LINE.includes(one) &&
        !line.includes(one) &&
        !line.includes("none") &&
        !ERROR_LINE.some((error) => line.includes(error))
      )
        line.push(one);
      else if ((one === "none" || ERROR_LINE.includes(one)) && line.length === 0) line.push(one);
      else if (DECORATION_STYLE.includes(one) && style === undefined) style = one;
      else if ((one === "auto" || one === "from-font" || isOffset(one)) && thickness === undefined) thickness = one;
      else if (isColour(one) && color === undefined) color = one;
      else return undefined;
    }
    if (t.length === 0) return undefined;
    return {
      "text-decoration-line": line.length === 0 ? "none" : line.join(" "),
      "text-decoration-style": style ?? "solid",
      "text-decoration-thickness": thickness ?? "auto",
      "text-decoration-color": color ?? "currentcolor",
    };
  },

  "text-emphasis": (value) => {
    const t = tokensOf(value);
    let fill: string | undefined;
    let shape: string | undefined;
    let text: string | undefined;
    let color: string | undefined;
    for (const one of t) {
      if (["filled", "open"].includes(one) && fill === undefined && text === undefined) fill = one;
      else if (EMPHASIS_SHAPE.includes(one) && shape === undefined && text === undefined) shape = one;
      else if (/^(".*"|'.*')$/.test(one) && text === undefined && fill === undefined && shape === undefined) text = one;
      else if (one === "none" && t.length <= 2 && fill === undefined && shape === undefined && text === undefined)
        text = one;
      else if (isColour(one) && color === undefined) color = one;
      else return undefined;
    }
    // A colour alone leaves the style at `none`, which is what the shorthand resets it to.
    const style = text ?? ([fill, shape].filter((one) => one !== undefined).join(" ") || "none");
    if (t.length === 0) return undefined;
    return { "text-emphasis-style": style, "text-emphasis-color": color ?? "currentcolor" };
  },

  "interest-delay": (value) => {
    const t = tokensOf(value);
    const delay = (one: string) => one === "normal" || /^[\d.]+m?s$/.test(one);
    if (t.length === 0 || t.length > 2 || !t.every(delay)) return undefined;
    return { "interest-delay-start": t[0], "interest-delay-end": t[1] ?? t[0] };
  },

  /**
   * An optional ORDER, then a comma list of fallbacks. Each item is an AREA — one word, or two from
   * different axes — or TACTICS with at most one name; `none` is a whole value. Written from what
   * the engines take, which is not the grammar mdn-data carries: all three refuse `x-self-start` and
   * its kin, and all three take `flip-x` and `flip-y`, which it lacks. Measured over 3549 items, and
   * the three engines agreed on every one of them. DESIGN.md §18: two-word items stayed whole.
   */
  "position-try": (value) => {
    const items = itemsOf(value);
    if (items === undefined) return undefined;
    const first = tokensOf(items[0] as string);
    const order = TRY_ORDER.includes((first[0] ?? "").toLowerCase()) && first.length > 1 ? first.shift() : undefined;
    const fallbacks = [first.join(" "), ...items.slice(1)];
    const none = fallbacks.length === 1 && (fallbacks[0] as string).toLowerCase() === "none";
    if (!none && !fallbacks.every((one) => tryArea(tokensOf(one)) || tryTactics(tokensOf(one)))) return undefined;
    return { "position-try-order": order ?? "initial", "position-try-fallbacks": fallbacks.join(", ") };
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
   * Aliases of one logical side each — `before` is `border-block-start`, `after` its end, `start` and
   * `end` the inline ones — split into their OWN prefixed longhands. Splitting them into the standard
   * ones would make them work in Firefox, which does not have them and drops the declaration.
   */
  "-webkit-border-before": webkitSide("before"),
  "-webkit-border-after": webkitSide("after"),
  "-webkit-border-start": webkitSide("start"),
  "-webkit-border-end": webkitSide("end"),
};

/** `width || style || color`, into that side's own prefixed longhands — see the four entries using it. */
function webkitSide(side: string) {
  return (value: string): Record<string, string> | undefined => {
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
      [`-webkit-border-${side}-width`]: width ?? "medium",
      [`-webkit-border-${side}-style`]: style ?? "none",
      [`-webkit-border-${side}-color`]: color ?? "currentcolor",
    };
  };
}

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

const NUMBER = /^[+]?(\d+(?:\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;
const LENGTH = /^([+]?(\d+(?:\.\d*)?|\.\d+)[a-z]+|0|calc\(.*\))$/i;
const LINE_WIDTH = /^(thin|medium|thick|0|[+]?(\d+(?:\.\d*)?|\.\d+)[a-z]+|calc\(.*\))$/i;
const BASIS =
  /^(auto|content|max-content|min-content|fit-content|fit-content\(.*\)|[+]?(\d+(?:\.\d*)?|\.\d+)([a-z]+|%)|calc\(.*\))$/i;

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

/**
 * `auto`, a name, `2`, `2 name`, `span 2`, `span name`, `span 2 name` — in any order CSS allows. A
 * line is never `0`, and a span is never below 1: every engine drops `grid-row: 0` and `span -1`.
 */
const GRID_LINE = (part: string): boolean => {
  const words = tokensOf(part);
  const line = (one: string) => /^-?\d+$/.test(one) && Number(one) !== 0;
  if (words.length === 1) return words[0] === "auto" || isIdent(words[0]) || line(words[0]);
  if (words.length > 3) return false;
  const span = words.filter((one) => one === "span").length;
  const numbers = words.filter(line);
  const names = words.filter((one) => isIdent(one)).length;
  if (span === 1 && numbers.some((one) => Number(one) < 1)) return false;
  return (
    span <= 1 &&
    numbers.length <= 1 &&
    names <= 1 &&
    span + numbers.length + names === words.length &&
    numbers.length + names >= 1
  );
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

const TRY_ORDER = ["normal", "most-width", "most-height", "most-block-size", "most-inline-size"];
const TRY_TACTICS = ["flip-block", "flip-inline", "flip-start", "flip-x", "flip-y"];
/** A `position-area` word's axis. `center` and `span-all` have none and sit beside any word. */
const TRY_AXIS: Readonly<Record<string, string>> = Object.fromEntries([
  ...["left", "right", "span-left", "span-right", "x-start", "x-end", "span-x-start", "span-x-end"].map((w) => [
    w,
    "x",
  ]),
  ...["top", "bottom", "span-top", "span-bottom", "y-start", "y-end", "span-y-start", "span-y-end"].map((w) => [
    w,
    "y",
  ]),
  ...["block-start", "block-end", "span-block-start", "span-block-end"].map((w) => [w, "block"]),
  ...["inline-start", "inline-end", "span-inline-start", "span-inline-end"].map((w) => [w, "inline"]),
  ...["self-block-start", "self-block-end", "span-self-block-start", "span-self-block-end"].map((w) => [
    w,
    "self-block",
  ]),
  ...["self-inline-start", "self-inline-end", "span-self-inline-start", "span-self-inline-end"].map((w) => [
    w,
    "self-inline",
  ]),
  ...["start", "end", "span-start", "span-end"].map((w) => [w, "logical"]),
  ...["self-start", "self-end", "span-self-start", "span-self-end"].map((w) => [w, "self-logical"]),
  ["center", ""],
  ["span-all", ""],
]);
/** The axes two words may pair: one of each, in either order — or two of the same, for these two. */
const TRY_PAIRS = ["x y", "y x", "block inline", "inline block", "self-block self-inline", "self-inline self-block"];
const TRY_SAME = ["logical", "self-logical"];

/** One fallback that is a `position-area`: a word, or two whose axes pair. */
function tryArea(tokens: string[]): boolean {
  const axes = tokens.map((one) => TRY_AXIS[one.toLowerCase()]);
  if (tokens.length === 0 || tokens.length > 2 || axes.some((one) => one === undefined)) return false;
  const [a, b] = axes as string[];
  return (
    b === undefined || a === "" || b === "" || TRY_PAIRS.includes(`${a} ${b}`) || (a === b && TRY_SAME.includes(a))
  );
}

/**
 * One fallback of tactics, each at most once, with at most one name of the author's — first or
 * last, since the tactics are one group: `flip-block --a flip-inline` is refused by every engine.
 */
function tryTactics(tokens: string[]): boolean {
  const words = tokens.map((one) => (one.startsWith("--") ? "--" : one.toLowerCase()));
  const name = words.indexOf("--");
  return (
    words.length > 0 &&
    new Set(words).size === words.length &&
    words.every((one) => one === "--" || TRY_TACTICS.includes(one)) &&
    (name <= 0 || name === words.length - 1)
  );
}

/** The items of a comma list, or nothing when one of them is empty — which CSS refuses. */
function itemsOf(value: string): string[] | undefined {
  const items: string[] = [];
  let depth = 0;
  let at = "";
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
const OFFSET = /^([+-]?(\d+(?:\.\d*)?|\.\d+)([a-z]+|%)?|calc\(.*\))$/i;
/** A length, a percentage or a `calc()` — and `0`, the one number CSS takes as a length. */
const isOffset = (one: string | undefined) =>
  one !== undefined && (one === "0" || (OFFSET.test(one) && !/^[+-]?(\d+(?:\.\d*)?|\.\d+)$/.test(one)));

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
  composite: string;
  mode: string;
}

/** What one family's layer holds, and what each part is when the layer leaves it out. */
interface LayerSpec {
  readonly boxes: readonly string[];
  /** A word that can only be the SECOND box — `mask`'s `no-clip`. */
  readonly clipOnly: readonly string[];
  readonly attachments: readonly string[];
  readonly composites: readonly string[];
  readonly modes: readonly string[];
  readonly threeValues: boolean;
  readonly origin: string;
  readonly clip: string;
}

const BACKGROUND: LayerSpec = {
  boxes: ["border-box", "padding-box", "content-box"],
  clipOnly: [],
  attachments: ["scroll", "fixed", "local"],
  composites: [],
  modes: [],
  threeValues: true,
  origin: "padding-box",
  clip: "border-box",
};

const MASK: LayerSpec = {
  // Narrower than the grammar, as measured: no engine takes `margin-box` here, and WebKit refuses
  // `fill-box`, `stroke-box` and `view-box` — a value one engine drops keeps its shorthand.
  boxes: ["border-box", "padding-box", "content-box"],
  clipOnly: ["no-clip"],
  attachments: [],
  composites: ["add", "subtract", "intersect", "exclude"],
  modes: ["alpha", "luminance", "match-source"],
  threeValues: false,
  origin: "border-box",
  clip: "border-box",
};

const IMAGE =
  /^(none|url\(|(-webkit-)?(repeating-)?(linear|radial|conic)-gradient\(|(-webkit-)?image-set\(|image\(|(-webkit-)?cross-fade\(|(-moz-)?element\(|paint\()/i;
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
  let quote = "";
  for (const ch of value) {
    if (quote !== "") {
      spaced += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    spaced += depth === 0 && quote === "" && ch === "/" ? " / " : ch;
  }
  return tokensOf(spaced);
}

/**
 * One layer of `background`, each part at most once, in any order — and the position's words
 * together, with its size straight after a `/`. `undefined` for anything else, which keeps the
 * shorthand.
 */
function layerOf(item: string, last: boolean, spec: LayerSpec): Layer | undefined {
  const t = slashed(item);
  const layer: Partial<Layer> & { boxes?: string[]; clipOnly?: string } = {};
  for (let at = 0; at < t.length; ) {
    const one = t[at];
    if (IMAGE.test(one) && layer.image === undefined) {
      layer.image = one;
      at++;
    } else if (spec.attachments.includes(one) && layer.attachment === undefined) {
      layer.attachment = one;
      at++;
    } else if (spec.composites.includes(one) && layer.composite === undefined) {
      layer.composite = one;
      at++;
    } else if (spec.modes.includes(one) && layer.mode === undefined) {
      layer.mode = one;
      at++;
    } else if (spec.boxes.includes(one) && (layer.boxes?.length ?? 0) < 2) {
      layer.boxes = [...(layer.boxes ?? []), one];
      at++;
    } else if (spec.clipOnly.includes(one) && layer.clipOnly === undefined) {
      // `no-clip` is only ever the clip, wherever it is written; a box beside it is the origin.
      layer.clipOnly = one;
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
      if (!spec.threeValues && end - at === 3) return undefined;
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
  if (layer.clipOnly !== undefined && (layer.boxes?.length ?? 0) > 1) return undefined;
  const [origin, second] = layer.boxes ?? [];
  const clip = layer.clipOnly ?? second;
  return {
    image: layer.image ?? "none",
    x: layer.x ?? "0%",
    y: layer.y ?? "0%",
    size: layer.size ?? "auto",
    repeat: layer.repeat ?? "repeat",
    attachment: layer.attachment ?? "scroll",
    origin: origin ?? spec.origin,
    clip: clip ?? origin ?? spec.clip,
    color: layer.color ?? "transparent",
    composite: layer.composite ?? "add",
    mode: layer.mode ?? "match-source",
  };
}

const FONT_STYLE = ["italic", "oblique"];
const FONT_WEIGHT = ["bold", "bolder", "lighter"];
const FONT_WIDTH = [
  "ultra-condensed",
  "extra-condensed",
  "condensed",
  "semi-condensed",
  "semi-expanded",
  "expanded",
  "extra-expanded",
  "ultra-expanded",
];
const FONT_SIZE = [
  "xx-small",
  "x-small",
  "small",
  "medium",
  "large",
  "x-large",
  "xx-large",
  "xxx-large",
  "larger",
  "smaller",
  "math",
];
const GENERIC =
  /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong)$/i;

/** What `font` resets and never sets, at the value it resets each to — read off all three engines. */
const FONT_RESETS: Readonly<Record<string, string>> = {
  "font-variant-ligatures": "normal",
  "font-variant-numeric": "normal",
  "font-variant-east-asian": "normal",
  "font-variant-alternates": "normal",
  "font-variant-position": "normal",
  "font-variant-emoji": "normal",
  "font-size-adjust": "none",
  "font-language-override": "normal",
  "font-kerning": "auto",
  "font-optical-sizing": "auto",
  "font-feature-settings": "normal",
  "font-variation-settings": "normal",
};

/** A family list: quoted names, runs of identifiers, generic families — never an empty item. */
function familyList(text: string): boolean {
  const items = itemsOf(text);
  return (
    items !== undefined &&
    items.every(
      (one) =>
        /^"[^"]*"$|^'[^']*'$/.test(one) ||
        GENERIC.test(one) ||
        tokensOf(one).every(
          (word) =>
            /^-?[a-z_][\w-]*$/i.test(word) && !["inherit", "initial", "unset", "default"].includes(word.toLowerCase()),
        ),
    )
  );
}

const RANGE_NAME = ["cover", "contain", "entry", "exit", "entry-crossing", "exit-crossing", "scroll"];

/** One range as its start and end, or nothing. `blank` is what an end left out on a length is. */
function rangeOf(t: readonly string[], blank: string): [string, string] | undefined {
  const part = (at: number): [string, number] | undefined => {
    const one = t[at];
    if (one === undefined) return undefined;
    if (one === "normal" || isOffset(one)) return [one, 1];
    if (!RANGE_NAME.includes(one)) return undefined;
    return isOffset(t[at + 1]) ? [`${one} ${t[at + 1]}`, 2] : [one, 1];
  };
  const start = part(0);
  if (start === undefined) return undefined;
  if (start[1] === t.length) {
    const name = start[0].split(" ")[0];
    return [start[0], RANGE_NAME.includes(name) ? name : blank];
  }
  const end = part(start[1]);
  if (end === undefined || start[1] + end[1] !== t.length) return undefined;
  return [start[0], end[0]];
}

function ranges(value: string, start: string, end: string, blank = "normal"): Record<string, string> | undefined {
  const items = itemsOf(value);
  if (items === undefined) return undefined;
  const read = items.map((one) => rangeOf(tokensOf(one), blank));
  if (read.some((one) => one === undefined)) return undefined;
  const pairs = read as [string, string][];
  return { [start]: pairs.map((one) => one[0]).join(", "), [end]: pairs.map((one) => one[1]).join(", ") };
}

/** A source: `auto`, `none`, `view()`, `scroll()`, or a named timeline — `--b` in `--a --b`. */
const TRIGGER_SOURCE = /^(auto|none|view\(.*\)|scroll\(.*\)|--[\w-]+)$/i;

/** One `timeline-trigger` item as its six parts, in the longhands' order. */
function triggerOf(item: string): string[] | undefined {
  const t = slashed(item);
  const name = t[0];
  if (name === undefined || !(name === "none" || /^--[\w-]+$/.test(name))) return undefined;
  let at = 1;
  const source = TRIGGER_SOURCE.test(t[at] ?? "") ? t[at++] : "auto";
  const slash = t.indexOf("/", at);
  const first = t.slice(at, slash === -1 ? undefined : slash);
  const second = slash === -1 ? [] : t.slice(slash + 1);
  if (slash !== -1 && second.length === 0) return undefined;
  const activation = first.length === 0 ? ["normal", "normal"] : rangeOf(first, "normal");
  const active = second.length === 0 ? ["auto", "auto"] : rangeOf(second, "auto");
  if (activation === undefined || active === undefined) return undefined;
  return [name, source, ...activation, ...active];
}

const BORDER_REPEAT = ["stretch", "repeat", "round", "space"];
const SLICE_PART = /^([\d.]+%?)$/;
const WIDTH_PART = /^(auto|[\d.]+([a-z]+|%)?|calc\(.*\))$/i;
const OUTSET_PART = /^([\d.]+([a-z]+)?|calc\(.*\))$/i;

/**
 * A grid value's tokens, with a string, a set of line names and a function each ONE token, and a
 * top-level `/` a token of its own. `undefined` for an unbalanced one.
 */
function gridTokens(value: string): string[] | undefined {
  const out: string[] = [];
  let at = "";
  let depth = 0;
  let quote = "";
  const flush = () => {
    if (at !== "") out.push(at);
    at = "";
  };
  for (const ch of value) {
    if (quote !== "") {
      at += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (depth < 0) return undefined;
    if (depth === 0 && quote === "" && /\s/.test(ch)) {
      flush();
      continue;
    }
    if (depth === 0 && quote === "" && ch === "/") {
      flush();
      out.push("/");
      continue;
    }
    at += ch;
  }
  if (depth !== 0 || quote !== "") return undefined;
  flush();
  return out;
}

const isString = (one: string) => /^(".*"|'.*')$/.test(one);
const isNames = (one: string) => /^\[[\s\w-]*\]$/.test(one);
const TRACK =
  /^(auto|min-content|max-content|subgrid|masonry|[\d.]+(fr|[a-z]+|%)|0|(minmax|fit-content|repeat|calc)\(.*\))$/i;

/** A track list's tokens: track sizes and line names, never two sets of names side by side. */
const tracks = (list: readonly string[]) =>
  list.length > 0 &&
  list.every((one) => TRACK.test(one) || isNames(one)) &&
  list.some((one) => !isNames(one)) &&
  !list.some((one, index) => isNames(one) && isNames(list[index + 1] ?? ""));

function gridTemplate(value: string): Record<string, string> | undefined {
  const t = gridTokens(value);
  if (t === undefined) return undefined;
  if (t.length === 1 && t[0] === "none")
    return { "grid-template-rows": "none", "grid-template-columns": "none", "grid-template-areas": "none" };

  const slash = t.indexOf("/");
  if (slash !== -1 && t.lastIndexOf("/") !== slash) return undefined;
  const before = slash === -1 ? t : t.slice(0, slash);
  const after = slash === -1 ? undefined : t.slice(slash + 1);

  if (!before.some(isString)) {
    const side = (list: readonly string[]) => (list.length === 1 && list[0] === "none") || tracks(list);
    if (after === undefined || !side(before) || !side(after)) return undefined;
    return {
      "grid-template-rows": before.join(" "),
      "grid-template-columns": after.join(" "),
      "grid-template-areas": "none",
    };
  }

  // The areas form: [names]? "row" size? [names]?, one after another.
  const rows: string[] = [];
  const areas: string[] = [];
  let pending: string[] = [];
  for (let at = 0; at < before.length; ) {
    // Names here lead the FIRST row; any later ones were taken as the previous row's trailing names
    // below. Two sets before the first row is not a grid.
    if (isNames(before[at])) {
      if (pending.length > 0) return undefined;
      pending.push(before[at].slice(1, -1).trim());
      at++;
      continue;
    }
    if (!isString(before[at])) return undefined;
    areas.push(before[at]);
    at++;
    const names = pending.filter((one) => one !== "").join(" ");
    const size =
      before[at] !== undefined && TRACK.test(before[at]) && !/^(subgrid|masonry)$/.test(before[at])
        ? before[at++]
        : "auto";
    if (/^repeat\(/i.test(size)) return undefined;
    rows.push(names === "" ? size : `[${names}] ${size}`);
    pending = [];
    // A row's own trailing names, which join the next row's leading ones.
    while (isNames(before[at] ?? "")) {
      pending.push(before[at].slice(1, -1).trim());
      at++;
    }
    if (pending.length > 2) return undefined;
  }
  if (!rectangular(areas)) return undefined;
  const trailing = pending.filter((one) => one !== "").join(" ");
  if (trailing !== "") rows.push(`[${trailing}]`);
  if (after !== undefined && (!tracks(after) || after.some((one) => /^repeat\(\s*auto-/i.test(one)))) return undefined;
  return {
    "grid-template-rows": rows.join(" "),
    "grid-template-columns": after === undefined ? "none" : after.join(" "),
    "grid-template-areas": areas.join(" "),
  };
}

/**
 * Whether the area strings make a grid CSS takes: every row the same number of cells, and every
 * name covering a rectangle. `"a b" "c"` is refused by all three engines, which drop the whole
 * declaration — and a split would still set the rows.
 */
function rectangular(areas: readonly string[]): boolean {
  const cells: string[][] = [];
  for (const one of areas) {
    const row = one.slice(1, -1).match(/[\w-]+|\.+|\S/g) ?? [];
    if (row.length === 0 || row.some((cell) => !/^([\w-]+|\.+)$/.test(cell))) return false;
    cells.push(row);
  }
  if (cells.some((row) => row.length !== cells[0].length)) return false;
  const names = new Set(cells.flat().filter((cell) => !cell.startsWith(".")));
  for (const name of names) {
    const at = cells
      .flatMap((row, r) => row.map((cell, c) => (cell === name ? [r, c] : null)))
      .filter((one) => one !== null);
    const rows = at.map((one) => one[0]);
    const columns = at.map((one) => one[1]);
    const height = Math.max(...rows) - Math.min(...rows) + 1;
    const width = Math.max(...columns) - Math.min(...columns) + 1;
    if (height * width !== at.length) return false;
  }
  return true;
}

function gridLines(value: string, start: string, end: string): Record<string, string> | undefined {
  const parts = value.split("/").map((one) => one.trim());
  if (parts.length > 2 || parts.some((one) => !GRID_LINE(one))) return undefined;
  return { [start]: parts[0], [end]: parts[1] ?? (isIdent(parts[0]) ? parts[0] : "auto") };
}

const DECORATION_LINE = ["underline", "overline", "line-through", "blink"];
const DECORATION_STYLE = ["solid", "double", "dotted", "dashed", "wavy"];
/** A line value that stands alone — none of the others beside it. */
const ERROR_LINE = ["spelling-error", "grammar-error"];
const EMPHASIS_SHAPE = ["dot", "circle", "double-circle", "triangle", "sesame"];

const POSITIONAL = ["center", "start", "end", "flex-start", "flex-end", "self-start", "self-end"];
// `anchor-center` is a SELF value only here: Chromium refuses it in `place-items`, measured.
const ALIGN_ITEMS = {
  words: ["normal", "stretch"],
  positional: POSITIONAL,
  baseline: true,
  legacy: false,
  distribution: false,
};
const JUSTIFY_ITEMS = { ...ALIGN_ITEMS, positional: [...POSITIONAL, "left", "right"], legacy: true };
const ALIGN_SELF = { ...ALIGN_ITEMS, words: ["auto", "normal", "stretch", "anchor-center"] };
const JUSTIFY_SELF = { ...ALIGN_SELF, positional: [...POSITIONAL, "left", "right"] };
const CONTENT_POSITION = ["center", "start", "end", "flex-start", "flex-end"];
const ALIGN_CONTENT = {
  words: ["normal"],
  positional: CONTENT_POSITION,
  baseline: true,
  legacy: false,
  distribution: true,
};
const JUSTIFY_CONTENT = { ...ALIGN_CONTENT, positional: [...CONTENT_POSITION, "left", "right"], baseline: false };

type Takes = typeof ALIGN_ITEMS;

/** Words that belong together as ONE alignment value — `first baseline`, `safe center`, `legacy left`. */
function alignGroups(t: readonly string[]): string[][] {
  const out: string[][] = [];
  for (let at = 0; at < t.length; ) {
    const one = t[at];
    const next = t[at + 1];
    const pair =
      (["first", "last"].includes(one) && next === "baseline") ||
      (["safe", "unsafe"].includes(one) && next !== undefined) ||
      (one === "legacy" && ["left", "right", "center"].includes(next ?? "")) ||
      // `center legacy right` is `center`, then `legacy right` — a direction before `legacy` only
      // belongs to it when nothing after `legacy` does.
      (["left", "right", "center"].includes(one) &&
        next === "legacy" &&
        !["left", "right", "center"].includes(t[at + 2] ?? ""));
    out.push(pair ? [one, next as string] : [one]);
    at += pair ? 2 : 1;
  }
  return out;
}

/** Whether one grouped value is one this longhand takes. */
function takes(group: readonly string[], kind: Takes): boolean {
  const [a, b] = group;
  if (group.length === 1)
    return (
      kind.words.includes(a) ||
      kind.positional.includes(a) ||
      (kind.baseline && a === "baseline") ||
      (kind.legacy && a === "legacy") ||
      (kind.distribution && ["space-between", "space-around", "space-evenly", "stretch"].includes(a))
    );
  if (b === "baseline") return kind.baseline;
  if (a === "safe" || a === "unsafe") return kind.positional.includes(b);
  return kind.legacy;
}

function place(
  value: string,
  first: string,
  second: string,
  one: Takes,
  two: Takes,
): Record<string, string> | undefined {
  const groups = alignGroups(tokensOf(value));
  if (groups.length === 0 || groups.length > 2) return undefined;
  const [a, b] = groups;
  const other = b ?? a;
  if (!takes(a, one) || !takes(other, two)) return undefined;
  return { [first]: a.join(" "), [second]: other.join(" ") };
}

const ANGLE = /^[+-]?(\d+(?:\.\d*)?|\.\d+)(deg|rad|grad|turn)$/i;
/** What an `offset-path` may be written as: a shape function, a `url()`, a box, or `none`. */
const OFFSET_PATH =
  /^(none|(ray|path|url|inset|circle|ellipse|polygon|xywh|rect|shape)\(.*\)|content-box|padding-box|border-box|fill-box|stroke-box|view-box)$/i;

/**
 * `border-image` and `mask-border`: a source, a slice with its width and outset after `/`s, and a
 * repeat — each part at most once, in any order.
 */
function imageBorder(
  value: string,
  family: "border-image" | "mask-border",
  initial: { slice: string; width: string; outset: string; repeat: string },
): Record<string, string> | undefined {
  const t = slashed(value);
  let source: string | undefined;
  let repeat: string | undefined;
  let slice: string | undefined;
  let width: string | undefined;
  let outset: string | undefined;
  for (let at = 0; at < t.length; ) {
    const one = t[at];
    if (IMAGE.test(one) && source === undefined) {
      source = one;
      at++;
    } else if (BORDER_REPEAT.includes(one) && repeat === undefined) {
      const two = BORDER_REPEAT.includes(t[at + 1] ?? "");
      repeat = two ? `${one} ${t[at + 1]}` : one;
      at += two ? 2 : 1;
    } else if ((SLICE_PART.test(one) || one === "fill") && slice === undefined) {
      let end = at;
      while (end < t.length && (SLICE_PART.test(t[end]) || t[end] === "fill")) end++;
      const part = t.slice(at, end);
      const fills = part.filter((word) => word === "fill").length;
      if (fills > 1 || part.length - fills < 1 || part.length - fills > 4) return undefined;
      if (fills === 1 && part[0] !== "fill" && part[part.length - 1] !== "fill") return undefined;
      slice = part.join(" ");
      at = end;
      const sides = (from: number, test: RegExp): [string | undefined, number] => {
        let stop = from;
        while (stop < t.length && stop - from < 4 && test.test(t[stop])) stop++;
        return stop === from ? [undefined, from] : [t.slice(from, stop).join(" "), stop];
      };
      if (t[at] === "/") {
        [width, at] = sides(at + 1, WIDTH_PART);
        if (t[at] === "/") {
          [outset, at] = sides(at + 1, OUTSET_PART);
          if (outset === undefined) return undefined;
        } else if (width === undefined) return undefined;
      }
    } else return undefined;
  }
  return {
    [`${family}-source`]: source ?? "none",
    [`${family}-slice`]: slice ?? initial.slice,
    [`${family}-width`]: width ?? initial.width,
    [`${family}-outset`]: outset ?? initial.outset,
    [`${family}-repeat`]: repeat ?? initial.repeat,
  };
}
