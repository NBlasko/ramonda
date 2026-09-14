/**
 * *Did you mean …* — the nearest name in a list, or nothing when nothing is near enough.
 *
 * **Its own module so it can be shared without a cycle.** It lived in `rules.ts`, which is where
 * most of its callers are; but `declared.ts` needs it for a wrong `kind( … )`, `codegen.ts` needs
 * `declared.ts`, and a rule needs `codegen.ts` — so `rules.ts` would have imported, through three
 * files, back into itself. One small module that imports nothing breaks that and costs nothing.
 */

/**
 * The closest name, or nothing when nothing is close.
 *
 * The bound is what keeps the suggestion honest: a name three edits away from `flex-direction` is
 * not a typo of it, and offering one anyway sends a reader to change a line that was right for a
 * different reason. Scaled by length, so a short name needs a closer match than a long one.
 */
export function nearest(word: string, among: readonly string[]): string | undefined {
  const bound = Math.min(3, Math.max(1, Math.floor(word.length / 4)));
  let best: string | undefined;
  let closest = bound + 1;

  for (const candidate of among) {
    if (Math.abs(candidate.length - word.length) > closest) continue;
    const distance = editDistance(word, candidate, closest);
    if (distance < closest) {
      closest = distance;
      best = candidate;
    }
  }

  return best;
}

/**
 * Levenshtein, abandoned as soon as every cell in a row is past the bound.
 *
 * The bound is what makes this affordable: `unknown-value` asks it once per word against a set that
 * can be 160 colours long, and a full matrix per candidate would be the checker's whole cost.
 */
function editDistance(a: string, b: string, bound: number): number {
  /** The row before the one before, which is the only thing a swap needs to see. */
  let twoBack: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index);

  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;

    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let value = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + cost);

      /**
       * **A SWAPPED PAIR IS ONE EDIT, and plain Levenshtein counts it as two.**
       *
       * A swap is the commonest way to mistype a word, and the bound is scaled by length — so for a
       * six-character name it is 1, and every transposition was out of reach. Found by `@medai`,
       * which is `@media` with two letters swapped and got no suggestion at all.
       *
       * Measured over every single-swap typo of every name in the four vocabularies, and every
       * single DELETION as well, so the change was measured for what it might break:
       *
       *     properties  swap   Levenshtein  right 12978  wrong 88  silent 199
       *                        this         right 13263  wrong  2  silent   0
       *     properties  drop   both the same: right 14223, wrong 63, silent 0
       *     at-rules    swap   157 -> 182 right, 25 silent -> 0
       *     selectors   swap  1210 -> 1353 right, 141 silent -> 0
       *
       * Better in every direction, and FASTER — 0.024 ms against 0.037 ms per word over 828 names,
       * because a swap costing 1 reaches the abandon bound sooner.
       */
      if (
        i > 1 &&
        j > 1 &&
        a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        value = Math.min(value, twoBack[j - 2] + 1);
      }

      row.push(value);
      if (value < best) best = value;
    }

    if (best > bound) return bound + 1;
    twoBack = previous;
    previous = row;
  }

  return previous[b.length];
}
