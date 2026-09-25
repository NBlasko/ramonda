import type { Term } from "./valueSyntax";

/**
 * Reading a written value AGAINST its grammar, which is what filling slots could not do.
 *
 * ## Why a parse and not a set of slots
 *
 * `splitTokens` hands each token to the first slot that takes it. CSS hands it to whichever
 * component the GRAMMAR reaches first, and the two differ wherever two components accept the same
 * token. Measured in all three engines, and they agree with each other and not with the slots:
 *
 * ```
 * animation: --zz   engines: animation-name      slots: animation-timeline
 * mask: 7px         engines: mask-position-x     slots: mask-size
 * ```
 *
 * Reordering the slots does not fix it. `--zz` is a `dashed-ident` to one component and a
 * `custom-ident` to another; `list-style: url(a.png)` has an OPEN component standing before the one
 * that means it. What answers both is the grammar's own order plus BACKTRACKING — a first choice
 * that leaves the rest unmatchable has to be given up — and that is a parser.
 *
 * ## What it returns
 *
 * Which tokens each LEAF of the grammar took. The caller turns leaves into longhands, which it
 * already knows how to do. A value that does not parse returns nothing, and nothing is the answer
 * that cannot be wrong: the declaration stays a shorthand.
 */

/** Whether one token satisfies one leaf of the grammar. Injected, because what a `<length>` is belongs to the caller. */
export type Accepts = (term: Term, token: string) => boolean;

/** Which tokens each leaf took, in the order the grammar names them. */
export type Taken = ReadonlyMap<Term, readonly string[]>;

/** One way the grammar could read the value so far: how far it got, and what each leaf took. */
interface Reading {
  readonly at: number;
  readonly taken: readonly (readonly [Term, string])[];
}

const LEAF = new Set(["keyword", "data", "property", "function", "literal"]);

/**
 * Every way a term can read the tokens from `at`, one at a time.
 *
 * A generator rather than a list, because the caller wants the FIRST reading that consumes
 * everything and the rest are never built. `||` over five components is 325 orders, and `animation`
 * has eight.
 */
function* readings(term: Term, tokens: readonly string[], at: number, accepts: Accepts): Generator<Reading> {
  const min = term.repeat?.min ?? (term.optional === true ? 0 : 1);
  /**
   * `#`, `*` and `+` have NO upper bound, and the tokens are what bound them: a repetition cannot
   * take more items than there are tokens left to take. Counting down from `Infinity` never reaches
   * the minimum, because `Infinity - 1` is `Infinity` — so every comma family hung here.
   */
  const wanted = term.repeat?.max ?? 1;
  const max = Math.min(wanted, Math.max(tokens.length - at, min));

  /** The term ONCE, with its multiplier already accounted for by the caller below. */
  function* once(from: number): Generator<Reading> {
    if (LEAF.has(term.kind)) {
      const token = tokens[from];
      if (token !== undefined && accepts(term, token)) yield { at: from + 1, taken: [[term, token]] };
      return;
    }
    if (term.kind === "alt") {
      for (const branch of term.terms ?? []) yield* readings(branch, tokens, from, accepts);
      return;
    }
    if (term.kind === "seq") {
      yield* inOrder(term.terms ?? [], from);
      return;
    }
    // `&&` wants all of them and `||` at least one, both in ANY order.
    yield* inAnyOrder(term.terms ?? [], from, term.kind === "and", false);
  }

  /** Each term after the one before it, which is what juxtaposition means. */
  function* inOrder(parts: readonly Term[], from: number): Generator<Reading> {
    const [head, ...rest] = parts;
    if (head === undefined) {
      yield { at: from, taken: [] };
      return;
    }
    for (const one of readings(head, tokens, from, accepts))
      for (const more of inOrder(rest, one.at)) yield { at: more.at, taken: [...one.taken, ...more.taken] };
  }

  /**
   * Any of them, each at most once, in any order — `all` when every one is required.
   *
   * `taken` is whether a component has already been read AT THIS LEVEL, and it is the whole
   * difference between `||` and optional. `||` means at least one: stopping is a reading once
   * something has been read and not before. Without that flag a required group could be skipped,
   * and the skip only showed inside a sequence — at the top the leftover token catches it.
   */
  function* inAnyOrder(parts: readonly Term[], from: number, all: boolean, taken: boolean): Generator<Reading> {
    if (parts.length === 0) {
      yield { at: from, taken: [] };
      return;
    }
    for (const [index, head] of parts.entries()) {
      const rest = [...parts.slice(0, index), ...parts.slice(index + 1)];
      for (const one of readings(head, tokens, from, accepts)) {
        if (one.at === from) continue; // Took nothing, so the order would never end.
        for (const more of inAnyOrder(rest, one.at, all, true))
          yield { at: more.at, taken: [...one.taken, ...more.taken] };
      }
    }
    // `||` is satisfied by one of them, so stopping here is a reading too. `&&` is not.
    if (!all && taken) yield { at: from, taken: [] };
  }

  /** The term `count` times over, with a comma between them where the grammar says `#`. */
  function* repeated(count: number, from: number): Generator<Reading> {
    if (count === 0) {
      yield { at: from, taken: [] };
      return;
    }
    for (const one of once(from)) {
      if (count === 1) {
        yield one;
        continue;
      }
      const next = term.comma === true ? (tokens[one.at] === "," ? one.at + 1 : -1) : one.at;
      if (next < 0) continue;
      for (const more of repeated(count - 1, next)) yield { at: more.at, taken: [...one.taken, ...more.taken] };
    }
  }

  // Most repeats first: a grammar that may take two wants both where both are there.
  for (let count = max; count >= min; count--) yield* repeated(count, at);
}

/**
 * Read the whole value, or nothing.
 *
 * The first reading that consumes every token wins, and the generator makes the rest unbuilt work.
 * A value that leaves a token over has not been understood, and understanding it is the only reason
 * to take it apart.
 */
export function matchValue(term: Term, tokens: readonly string[], accepts: Accepts): Taken | undefined {
  for (const reading of readings(term, tokens, 0, accepts)) {
    if (reading.at !== tokens.length) continue;
    const out = new Map<Term, string[]>();
    for (const [leaf, token] of reading.taken) out.set(leaf, [...(out.get(leaf) ?? []), token]);
    return out;
  }
  return undefined;
}
