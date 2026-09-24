/**
 * The CSS value definition syntax — the notation every shorthand's grammar is written in.
 *
 * ## Why this exists
 *
 * A shorthand is split by knowing which longhand each token belongs to, and that is not guessable:
 * measured, what this package generates answers 84 of 404 placements. But it is not a secret
 * either. Every shorthand HAS a grammar and it is published:
 *
 *     border      <line-width> || <line-style> || <color>
 *     animation   <single-animation>#
 *     flex        none | [ <'flex-grow'> <'flex-shrink'>? || <'flex-basis'> ]
 *
 * `||` is "in any order", which is the type dispatch the prototype spent a day learning from the
 * engines. So the classification is a reading problem rather than a measuring one — and this is the
 * reader.
 *
 * Measured against every grammar `mdn-data` publishes: **1020 of 1029 read**. The nine it refuses
 * are not value grammars at all — `<keyframe-block>` is a block, `<feature-type>` is a list of
 * at-rule names, `<mf-plain>` and `<pseudo-page>` are media-query and selector syntax with `:` and
 * `;` in them, `<an+b>` carries a footnote dagger, and `<general-enclosed>` opens with `[` and
 * closes with `)`. Refusing those is the right answer rather than a gap: nothing classifies a
 * shorthand from a selector.
 *
 * **What it is NOT is a validator.** It parses the notation, not values written in it. Whether a
 * grammar is TRUE of an engine is a separate question, answered where it always is here: against
 * the engines, with a corpus. `mdn-data` is the file this repository has already measured lying —
 * `build-shorthand-leaves.mjs` exists because its `initial` field was missing 37 longhands. Take
 * the grammar, then check it.
 *
 * ## The notation
 *
 * From CSS Values 4. Loosest to tightest, which is the precedence this parser climbs:
 *
 * | written | means |
 * |---|---|
 * | `a \| b` | exactly one of them |
 * | `a \|\| b` | one or more, in any order |
 * | `a && b` | both, in any order |
 * | `a b` | both, in this order |
 * | `[ a b ]` | grouping |
 * | `a?` `a*` `a+` `a{1,4}` `a#` | how many, `#` being a comma-separated list |
 * | `<length>` | a data type |
 * | `<'padding-top'>` | whatever that property takes |
 * | `rgb( <number> )` | a function, its arguments a grammar of their own |
 * | `/` `,` | themselves, literally |
 */

/** One node of a parsed grammar. `terms` is set on the combinators and on nothing else. */
export interface Term {
  readonly kind: "alt" | "or" | "and" | "seq" | "keyword" | "data" | "property" | "literal" | "function";
  /** The word for a keyword, the name inside the angle brackets for a type or a property. */
  readonly name?: string;
  readonly terms?: readonly Term[];
  /** `?` and `*` make it optional; `{0,n}` does too. */
  readonly optional?: boolean;
  /** How many times it may repeat. `undefined` is exactly once. */
  readonly repeat?: { readonly min: number; readonly max: number };
  /** `#` — the repeats are separated by commas rather than spaces. */
  readonly comma?: boolean;
}

/** Thrown for notation this does not understand, so a silent misreading is not possible. */
export class SyntaxNotationError extends Error {
  /** Where in the grammar the reader gave up — a parameter property would need transforming, not
   * just stripping, and the generators load this file through node's own type stripping. */
  readonly at: number;

  constructor(message: string, at: number) {
    super(message);
    this.name = "SyntaxNotationError";
    this.at = at;
  }
}

const SINGLE = new Set(["/", ","]);

/**
 * Read a grammar into terms.
 *
 * Recursive descent, one level per precedence, which is what keeps `a | b c` reading as `a | (b c)`
 * — the thing a flat split on `|` gets wrong and cannot be told it got wrong.
 */
export function parseValueSyntax(source: string): Term {
  let at = 0;

  const skip = (): void => {
    while (at < source.length && /\s/.test(source[at])) at++;
  };
  const peek = (text: string): boolean => {
    skip();
    return source.startsWith(text, at);
  };
  const take = (text: string): boolean => {
    if (!peek(text)) return false;
    at += text.length;
    return true;
  };

  /** `a | b` — the loosest, so the outermost. */
  const alternatives = (): Term => {
    const terms = [anyOrder()];
    // `||` first: `startsWith("|")` is true of both, and reading `||` as two `|` loses the meaning.
    while (peek("|") && !peek("||")) {
      at++;
      terms.push(anyOrder());
    }
    return terms.length === 1 ? terms[0] : { kind: "alt", terms };
  };

  /** `a || b` — one or more, any order. */
  const anyOrder = (): Term => {
    const terms = [allOf()];
    while (take("||")) terms.push(allOf());
    return terms.length === 1 ? terms[0] : { kind: "or", terms };
  };

  /** `a && b` — both, any order. */
  const allOf = (): Term => {
    const terms = [sequence()];
    while (take("&&")) terms.push(sequence());
    return terms.length === 1 ? terms[0] : { kind: "and", terms };
  };

  /** `a b` — juxtaposition, the tightest combinator. */
  const sequence = (): Term => {
    const terms: Term[] = [];
    for (;;) {
      skip();
      if (at >= source.length) break;
      if (source.startsWith("]", at) || source.startsWith(")", at) || peek("|") || peek("||") || peek("&&")) break;
      terms.push(repeated());
    }
    if (terms.length === 0) throw new SyntaxNotationError("nothing where a term was expected", at);
    return terms.length === 1 ? terms[0] : { kind: "seq", terms };
  };

  /** A term and whatever multiplier follows it. */
  const repeated = (): Term => {
    const term = atom();
    let out = term;
    for (;;) {
      if (take("?")) out = { ...out, optional: true };
      else if (take("*")) out = { ...out, optional: true, repeat: { min: 0, max: Infinity } };
      else if (take("+")) out = { ...out, repeat: { min: 1, max: Infinity } };
      else if (take("#")) out = { ...out, comma: true, repeat: { min: 1, max: Infinity } };
      else if (take("!")) out = { ...out, optional: false };
      else if (peek("{")) {
        const close = source.indexOf("}", at);
        if (close === -1) throw new SyntaxNotationError("a `{` with no `}`", at);
        const [min, max] = source
          .slice(at + 1, close)
          .split(",")
          .map((one) => one.trim());
        at = close + 1;
        const low = Number(min);
        const high = max === undefined || max === "" ? low : Number(max);
        if (!Number.isFinite(low)) throw new SyntaxNotationError(`\`{${min}\` is not a count`, at);
        out = { ...out, optional: low === 0, repeat: { min: low, max: Number.isFinite(high) ? high : Infinity } };
      } else break;
    }
    return out;
  };

  /** A group, a bracketed name, a literal, or a keyword. */
  const atom = (): Term => {
    skip();
    if (at >= source.length) throw new SyntaxNotationError("the grammar ended where a term was expected", at);

    if (take("[")) {
      const inner = alternatives();
      if (!take("]")) throw new SyntaxNotationError("a `[` with no `]`", at);
      return inner;
    }

    /**
     * A BARE `(` groups, the way `[` does — `<calc-value>` is written `… | ( <calc-sum> )`.
     *
     * Parentheses mean two things in this notation and the difference is what precedes them: after
     * a word they open a function's arguments, on their own they are a group. Reading only the
     * first cost nine grammars, every one of them a `calc()` form.
     */
    if (take("(")) {
      const inner = alternatives();
      if (!take(")")) throw new SyntaxNotationError("a `(` with no `)`", at);
      return inner;
    }

    if (source[at] === "<") {
      const close = source.indexOf(">", at);
      if (close === -1) throw new SyntaxNotationError("a `<` with no `>`", at);
      const inside = source.slice(at + 1, close);
      at = close + 1;
      if (inside.startsWith("'") && inside.endsWith("'")) {
        return { kind: "property", name: inside.slice(1, -1) };
      }
      // A range is part of the TYPE — `<time [0s,∞]>` is a time, and the bounds are not ours.
      return { kind: "data", name: inside.split(/\s*\[/)[0].trim() };
    }

    /**
     * A QUOTED character is itself, literally — `'+'`, `'*'`, `'['`. Without this the reader
     * refused 24 of the 1029 published grammars, every one of them for the same reason, and all of
     * them selector or `calc()` grammars where an operator has to be written as a character rather
     * than read as notation.
     */
    if (source[at] === "'") {
      const close = source.indexOf("'", at + 1);
      if (close === -1) throw new SyntaxNotationError("a `'` with no closing `'`", at);
      const text = source.slice(at + 1, close);
      at = close + 1;
      return { kind: "literal", name: text };
    }

    if (SINGLE.has(source[at])) {
      const text = source[at];
      at++;
      return { kind: "literal", name: text };
    }

    const word = /^[-\w%]+/.exec(source.slice(at));
    if (word === null) throw new SyntaxNotationError(`\`${source[at]}\` is not notation this reads`, at);
    at += word[0].length;

    /**
     * A FUNCTION, whose arguments are a grammar of their own — `rgb( <number>#{3} )`.
     *
     * Read as two keywords before this existed: `rgb(` and `)`, with the arguments loose between
     * them. `<color>` then resolved into a word list holding `rgb(` and `)`, which is not a colour
     * anybody writes and would have matched no token at all.
     */
    if (source[at] === "(") {
      at++;
      skip();
      if (source[at] === ")") {
        at++;
        return { kind: "function", name: word[0], terms: [] };
      }
      const args = alternatives();
      skip();
      if (source[at] !== ")") throw new SyntaxNotationError(`\`${word[0]}(\` with no \`)\``, at);
      at++;
      return { kind: "function", name: word[0], terms: [args] };
    }

    return { kind: "keyword", name: word[0] };
  };

  const out = alternatives();
  skip();
  if (at < source.length) throw new SyntaxNotationError(`\`${source.slice(at, at + 12)}\` is left over`, at);
  return out;
}

/**
 * Every `<'property'>` and `<type>` the grammar can produce, flattened, in the order written.
 *
 * What a caller wants from a shorthand's grammar is *which components are there*, and the shape of
 * the combinators is not part of that question — `||` and `&&` and juxtaposition all mean "these
 * appear". `|` is different and is kept apart: those are ALTERNATIVES, and a family that reads one
 * way or a wholly different way has two shapes rather than one.
 */
export function componentsOf(term: Term): readonly Term[] {
  if (term.kind === "alt") return [];
  if (term.kind === "or" || term.kind === "and" || term.kind === "seq") {
    return (term.terms ?? []).flatMap((one) => componentsOf(one));
  }
  return term.kind === "literal" ? [] : [term];
}

/** The branches of a top-level `|`, or the grammar itself where there is no choice. */
export function alternativesOf(term: Term): readonly Term[] {
  return term.kind === "alt" ? (term.terms ?? []) : [term];
}
