/**
 * The POSITIONAL half of splitting a shorthand: the vocabulary it is learned with, the learner that
 * runs inside a browser, and the splitter that runs anywhere.
 *
 * One copy, because there are two callers — `prototype-expand.mjs`, which measures, and
 * `scripts/css/build-shorthand-shapes.mjs`, which writes the table down. Two copies of a rule is the
 * fault this repository keeps finding; see `DESIGN.md`.
 *
 * ## Why positional first, and alone
 *
 * A positional family needs no classifier at split time. `padding: 10px 20px` is answered by how
 * many values were written and nothing else, so the learned shape is pure DATA and `splitPositional`
 * below runs in a build with no browser in it. Every other shape asks *which longhand does this
 * token belong to*, and that question was measured unanswerable from what this package generates —
 * 84 of 404 placements, see `prototype-classify-from-tables.mjs`. Those families wait.
 *
 * 53 of the 89 families the prototype splits are positional, and they are the ones authors write
 * most: `padding`, `margin`, `inset`, `gap`, `border-radius`, `border-*-width/color/style`,
 * `place-*`, `scroll-*` and every logical variant.
 */

/**
 * The sentinel sets a family is probed with, and the corpus each is verified over.
 *
 * A family takes whichever set its grammar accepts. The sentinels must be DISTINCT — the position a
 * longhand took is read back off which sentinel it holds — and the corpus is what the splitter is
 * then checked against, which is where the awkward values belong: `calc()`, `min()`, `env()`, a
 * percentage, a zero, a negative, a `var()` and the CSS-wide keywords.
 */
import { loadTs } from "../../scripts/lib-load-ts.mjs";

export const DOMAINS = [
  {
    kind: "length",
    sentinels: ["1px", "2px", "3px", "4px", "5px", "6px", "7px", "8px"],
    corpus: ["0", "10px", "10%", "calc(1px + 2%)", "min(1px, 2%)", "-5px", "var(--x)", "inherit", "initial"],
  },
  {
    kind: "colour",
    sentinels: [
      "rgb(1, 1, 1)",
      "rgb(2, 2, 2)",
      "rgb(3, 3, 3)",
      "rgb(4, 4, 4)",
      "rgb(5, 5, 5)",
      "rgb(6, 6, 6)",
      "rgb(7, 7, 7)",
      "rgb(8, 8, 8)",
    ],
    corpus: ["red", "#abc", "rgb(1 2 3)", "color-mix(in srgb, red, blue)", "currentcolor", "var(--c)", "inherit"],
  },
  {
    kind: "line-style",
    sentinels: ["dotted", "dashed", "solid", "double", "groove", "ridge", "inset", "outset"],
    corpus: ["none", "solid", "double", "var(--s)", "inherit"],
  },
  {
    kind: "image",
    sentinels: ["url(a.png)", "url(b.png)", "url(c.png)", "url(d.png)", "url(e.png)", "url(f.png)"],
    corpus: ["none", "url(a.png)", "var(--i)", "inherit"],
  },
  {
    kind: "alignment",
    sentinels: ["start", "end", "center", "stretch", "flex-start", "flex-end", "baseline", "normal"],
    corpus: ["start", "end", "center", "stretch", "space-between", "normal", "var(--a)", "inherit"],
  },
  {
    kind: "corner-shape",
    sentinels: ["round", "bevel", "scoop", "notch", "square", "squircle"],
    corpus: ["round", "bevel", "scoop", "notch", "square", "var(--k)", "inherit"],
  },
  {
    kind: "white-space",
    sentinels: ["normal", "pre", "nowrap", "pre-wrap", "pre-line", "break-spaces", "collapse", "preserve"],
    corpus: ["normal", "pre", "nowrap", "balance", "pretty", "stable", "var(--w)", "inherit"],
  },
  {
    kind: "vertical-align",
    sentinels: ["baseline", "sub", "super", "top", "text-top", "middle", "bottom", "text-bottom"],
    corpus: ["baseline", "sub", "middle", "10px", "50%", "var(--v)", "inherit"],
  },
  {
    kind: "grid-line",
    sentinels: ["1", "2", "3", "4", "5", "6", "7", "8"],
    corpus: ["auto", "1", "-1", "span 2", "3", "var(--n)", "inherit"],
  },
  {
    kind: "overflow",
    sentinels: ["auto", "hidden", "clip", "scroll", "visible", "auto", "hidden", "clip"],
    corpus: ["visible", "auto", "clip", "var(--o)", "inherit"],
  },
];

/**
 * The value patterns a family is taught, each written as the length of every SLASH-SEPARATED side.
 *
 * A list rather than a flag, because a slash means two different things. `border-radius: 1px / 2px`
 * splits ONE value into a horizontal and a vertical half; `grid-area: 1 / 2 / 3 / 4` is four
 * independent slots. The key is written the way the value is — `2/2`, `1/1/1/1`.
 */
export const PATTERNS = [[1], [2], [3], [4], [1, 1], [2, 2], [4, 4], [2, 1], [1, 2], [1, 1, 1], [1, 1, 1, 1]].map(
  (sides) => ({ key: sides.join("/"), sides, slots: sides.reduce((sum, one) => sum + one, 0) }),
);

/**
 * The splitter itself, loaded rather than re-exported.
 *
 * `split.ts` imports `./keywords.generated` without an extension, which is how every module under
 * `src` is written and which node cannot resolve on its own. `loadTs` bundles it in memory. A plain
 * `export … from` cannot do that, so the names are bound here — this file is build-only and never
 * published, so the extra step costs nothing at runtime.
 */
const split = await loadTs(new URL("./src/compiler/split.ts", import.meta.url).pathname);
export const { WIDE, tokensOf, splitPositional, misplacedWord, holdsVar } = split;

/**
 * Learn every positional family, inside a page. Returns data, not closures.
 *
 * Stringified and injected, so it may use nothing from this module's scope — that is why `tokensOf`
 * is written out again inside it rather than imported. The duplication is a page boundary rather
 * than a second copy of a rule: this one exists to be serialised.
 */
export function learnPositionalIn(names, DOMAINS, PATTERNS) {
  const element = document.getElementById("x");

  const expand = (name, value) => {
    element.style.cssText = "";
    element.style.setProperty(name, value);
    const out = {};
    for (let index = 0; index < element.style.length; index++) {
      const one = element.style[index];
      if (one !== name) out[one] = element.style.getPropertyValue(one);
    }
    return out;
  };

  /** What a longhand REPORTS when set to this value — so a normalisation is not read as a mismatch. */
  const held = (longhand, token) => {
    element.style.cssText = "";
    element.style.setProperty(longhand, token);
    return element.style.getPropertyValue(longhand);
  };

  const tokens = (value, separator = /\s/) => {
    const out = [];
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
  };

  const fill = (sentinels, pattern) => {
    const values = sentinels.slice(0, pattern.slots);
    let at = 0;
    return pattern.sides.map((n) => values.slice(at, (at += n)).join(" ")).join(" / ");
  };

  const out = {};
  for (const name of names) {
    // A property this engine does not have cannot disagree about it.
    if (!(name in element.style)) continue;

    /**
     * The domain is chosen across every PATTERN, not by one probe. `grid-column` takes `1 / 3` and
     * refuses `1 3`, so asking only whether a family accepts two values side by side read it as
     * having no positional shape at all.
     */
    const domain = DOMAINS.find((candidate) =>
      PATTERNS.some((pattern) => {
        const got = expand(name, fill(candidate.sentinels, pattern));
        const keys = Object.keys(got);
        return (
          keys.length > 0 &&
          keys.every((key) => candidate.sentinels.some((one) => got[key] === one || got[key] === held(key, one)))
        );
      }),
    );
    if (domain === undefined) continue;

    const patterns = {};
    for (const pattern of PATTERNS) {
      const values = domain.sentinels.slice(0, pattern.slots);
      const got = expand(name, fill(domain.sentinels, pattern));
      if (Object.keys(got).length === 0) continue;
      patterns[pattern.key] = Object.fromEntries(
        Object.entries(got).map(([longhand, carries]) => {
          // The WHOLE value first, then token by token: a longhand can hold a slot and a constant
          // side by side, and a sentinel can come back normalised.
          const whole = values.findIndex((one) => carries === one || carries === held(longhand, one));
          if (whole >= 0) return [longhand, { slots: [whole] }];
          const slots = tokens(carries).map((one) =>
            values.findIndex((candidate) => one === candidate || one === held(longhand, candidate)),
          );
          return [longhand, slots.every((one) => one >= 0) ? { slots } : { literal: carries }];
        }),
      );
    }
    if (Object.keys(patterns).length === 0) continue;
    out[name] = { kind: domain.kind, patterns };
  }
  return out;
}
