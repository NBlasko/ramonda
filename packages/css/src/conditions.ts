/**
 * How strongly a rule's conditions override — one number, and the sheet's major order.
 *
 * **Its own module because the RUNTIME needs it too, and the runtime must not reach into the
 * compiler.** `flatten.ts` carries the whole shorthand table; importing it from `merge.ts` would put
 * that table on every page. And a second copy of this here would be the fault this repository keeps
 * finding: one rule, two answers, drifting apart the first time one of them is corrected.
 *
 * The compiler asks with a declaration's conditions. `compose` asks with the context half of a map
 * key, which is the same text run together — every function below matches over the joined string, so
 * both callers get the same answer without the key having to be parsed back into parts.
 */
/**
 * A length in a media query, in px — `rem` and `em` at the root's 16px, and nothing else.
 *
 * **Case-insensitive, and it was not.** A CSS unit is a keyword, and keywords are case-insensitive:
 * `40REM` is `40rem`, and a browser reads them as one breakpoint. This read `40REM` as no width at
 * all, which put the rule in the unknown band at the END of the order — so measured in Chromium
 * against plain CSS, `@media (min-width: 40REM)` in one file beat `@media (min-width: 80rem)` in
 * another at a 1600px viewport, in both file orders. The narrower breakpoint won.
 */
function pixelsOf(text: string): number | undefined {
  const found = /^\s*(-?\d*\.?\d+)(px|rem|em)\s*$/i.exec(text);
  if (found === null) return undefined;
  const value = Number(found[1]);
  return found[2].toLowerCase() === "px" ? value : value * 16;
}

/**
 * Every width a condition states, as a `min` or a `max`, in both spellings CSS has for one.
 *
 * **The range syntax was read as no width at all**, and it is the spelling MDN now recommends:
 * `(width >= 40rem)` rather than `(min-width: 40rem)`. So every range breakpoint landed in the
 * unknown band together, where they TIE — and a tie is decided by the sheet's position, which is
 * exactly what the layers exist to stop. Measured: `(width >= 40rem)` against `(width >= 80rem)` in
 * two files came out right when the narrow file loaded first and WRONG when the wide one did.
 *
 * The feature name may sit on either side of the comparison, or between two of them, and which side
 * it is on flips the meaning: `(40rem <= width)` is a MIN, `(width <= 40rem)` is a max. Written as
 * one walk over the parts rather than a regex per shape, because the two-sided form is the same
 * question asked twice.
 *
 * `>` and `>=` land on the same width. They differ by the smallest length a browser can tell apart,
 * and the slot is a sort order rather than a measurement — two breakpoints that close a pixel apart
 * tie, which is honest, and the colon form already ties with itself the same way.
 */
function* widthsStated(condition: string): Generator<{ which: "min" | "max"; pixels: number }> {
  // The colon form, which may name the feature `min-width` or `max-width`.
  for (const [, which, text] of condition.matchAll(/\((min|max)-width\s*:([^)]*)\)/gi)) {
    const pixels = pixelsOf(text);
    if (pixels !== undefined) yield { which: which.toLowerCase() as "min" | "max", pixels };
  }

  // The range form. Only a group that holds a comparison, so an ordinary condition is skipped.
  for (const [, inside] of condition.matchAll(/\(([^()]*[<>][^()]*)\)/g)) {
    const parts = inside.split(/\s*(<=|>=|<|>)\s*/);
    const at = parts.findIndex((one) => one.trim().toLowerCase() === "width");
    // `height`, `aspect-ratio`, `resolution` — a comparison, and not one about width.
    if (at === -1) continue;

    for (const [value, operator, side] of [
      [parts[at - 2], parts[at - 1], "before"],
      [parts[at + 2], parts[at + 1], "after"],
    ] as const) {
      if (value === undefined || operator === undefined) continue;
      const pixels = pixelsOf(value);
      if (pixels === undefined) continue;
      // `40rem <= width` bounds width from BELOW; `width <= 40rem` bounds it from above.
      const lower = side === "before" ? operator.startsWith("<") : operator.startsWith(">");
      yield { which: lower ? "min" : "max", pixels };
    }
  }
}

/**
 * The widest `min-width` and the narrowest `max-width` across every condition around a rule — the
 * most restrictive of each, since a rule under two conditions applies only where both hold.
 *
 * A width in a unit this cannot resolve is simply not one of them, which leaves the rule with the
 * modes: no number, nothing to compare.
 */
function widthsIn(conditions: readonly string[]): { min?: number; max?: number } {
  let min: number | undefined;
  let max: number | undefined;

  for (const condition of conditions) {
    for (const { which, pixels } of widthsStated(condition)) {
      if (which === "min") min = min === undefined ? pixels : Math.max(min, pixels);
      else max = max === undefined ? pixels : Math.min(max, pixels);
    }
  }
  return { min, max };
}

/** The widest breakpoint that gets its own slot; beyond it, values are clamped and tie. */
const WIDEST = 4999;

/**
 * The conditions that carry no width, in the order they OVERRIDE one another.
 *
 * This is Tailwind's own variant order, read out of its `corePlugins.js` rather than invented here —
 * a decision a great many projects have already lived with. Later wins: reduced motion is the
 * weakest, then the colour scheme, then the medium, then the breakpoints (which sit between these
 * two halves), then capability and device facts, and `forced-colors` last of all because it is the
 * user forcing the page's hand.
 *
 * **The breakpoints sit in the MIDDLE of this list, and that was the decision.** I had put every
 * mode after every breakpoint, which makes a dark-mode rule beat a wide-screen rule for the same
 * property. Tailwind's order is the other way, and the reason to prefer it is which mistake stays
 * silent: theming lives in a BASE block and a modifier adjusts at a breakpoint, so
 * `...{base}; @media (min-width: …) { … }` is the shape people write — and under the mode-wins order
 * that shape loses, with nothing able to report it (a spread's operand is a runtime value). The user
 * made the call.
 */
const MODES: readonly RegExp[] = [
  /\(\s*prefers-reduced-motion/,
  /\(\s*prefers-color-scheme/,
  /@media[^(]*\b(?:print|screen)\b/,
];

/** And the ones that override a breakpoint, in the same order. */
const OVERRIDING_MODES: readonly RegExp[] = [
  /^@supports\b/,
  /\(\s*orientation\s*:/,
  /\(\s*prefers-contrast/,
  /\(\s*forced-colors/,
];

/** Where the first slot a `max-width` can take sits: after every mode weaker than a breakpoint. */
const NARROWEST_MAX = MODES.length + 1;
/** Where `min-width` starts, right after the `max-width` band. */
const WIDEST_MIN = NARROWEST_MAX + WIDEST + 1;
/** And where the modes that beat a breakpoint start. */
const AFTER_WIDTHS = WIDEST_MIN + WIDEST + 1;

/**
 * How strongly a rule's conditions override, as a number that sorts — the sheet's major order.
 *
 * **A narrower rule has to be emitted later**, and until this existed the sheet could not tell two
 * breakpoints apart. `padding` under `@media (min-width: 40rem)` and again under
 * `@media (min-width: 64rem)` are both conditional and neither is a shorthand, so they ranked the
 * same, and the sheet fell back to the order the file happened to write them in — which another file
 * re-emitting one of the two then reversed. Measured in Chromium: 280 of 750 load orders wrong.
 *
 * A breakpoint is a NUMBER, so this is what every atomic CSS framework does: order by the query
 * rather than by where it was written. The bands, ascending:
 *
 * | slot | what is in it |
 * |---|---|
 * | `0` | not conditional at all, so it is first |
 * | `1 … 3` | `prefers-reduced-motion`, then `prefers-color-scheme`, then the medium |
 * | `4 … 5003` | `max-width`, the narrowest last — which is desktop-first |
 * | `5004 … 10003` | `min-width`, the widest last — which is mobile-first |
 * | `10004 … 10007` | `@supports`, `orientation`, `prefers-contrast`, `forced-colors` |
 * | `10008` | a condition with no width this table knows |
 *
 * **`min-width` after `max-width`** when both match, which is the order the frameworks settled on.
 * A rule with BOTH is placed by its `min-width`: a band is narrower than the open range it starts
 * from, and no single number orders two bands that overlap only partly.
 *
 * The order of the modes around the breakpoints is {@link MODES}, and it is Tailwind's rather than
 * mine. A width in a unit this cannot resolve — `50ch`, a `calc()` — and a condition the table does
 * not know both land in the last slot, where they tie with each other the way everything conditional
 * used to. Two of THOSE against each other is what is still open; see `PLAN.md`.
 */
export function widthSlot(conditions: readonly string[] | undefined): number {
  if (conditions === undefined || conditions.length === 0) return 0;

  const { min, max } = widthsIn(conditions);
  const clamp = (value: number) => Math.min(Math.max(value, 0), WIDEST);
  if (min !== undefined) return WIDEST_MIN + clamp(min);
  if (max !== undefined) return NARROWEST_MAX + WIDEST - clamp(max);

  const text = conditions.join(" ");
  // The strongest match wins, so `@supports … and (forced-colors)` is placed by the stronger half.
  for (let index = OVERRIDING_MODES.length - 1; index >= 0; index--) {
    if (OVERRIDING_MODES[index].test(text)) return AFTER_WIDTHS + index;
  }
  for (let index = MODES.length - 1; index >= 0; index--) {
    if (MODES[index].test(text)) return index + 1;
  }
  return AFTER_WIDTHS + OVERRIDING_MODES.length;
}
