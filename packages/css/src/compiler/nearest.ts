/**
 * *Did you mean …* — the nearest name in a list, or nothing when nothing is near enough.
 *
 * **Its own module so it can be shared without a cycle.** Most callers are rules, but `declared.ts`
 * needs it for a wrong `kind( … )`, `codegen.ts` needs `declared.ts`, and a rule needs `codegen.ts`
 * — so living beside the rules would import, through three files, back into itself. One small
 * module that imports nothing breaks that and costs nothing.
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
       * six-character name it is 1, and every transposition would be out of reach: `@medai` would
       * get no suggestion at all. Measured over every single-swap and single-deletion typo of every
       * name in the four vocabularies, it is better in every direction — property swaps go from 88
       * wrong and 199 silent to 2 wrong and 0 silent, deletions are unchanged — and faster, 0.024
       * ms against 0.037 ms per word over 828 names, because a swap costing 1 reaches the abandon
       * bound sooner.
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
