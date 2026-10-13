import { type Term, alternativesOf, componentsOf, parseValueSyntax } from "./valueSyntax";

/**
 * Which longhand a component of a shorthand's grammar feeds.
 *
 * ## Why it is four rules and not one
 *
 * The grammar says what a shorthand is made of — `border` is `<line-width> || <line-style> ||
 * <color>` — but not which longhand each part lands on. That has to be read off the longhands
 * themselves, and they say it four different ways. Each of the four was found by a measurement
 * failing on a named family, not by reading the specification and guessing what it would need:
 *
 * | the component | how the longhand claims it | found by |
 * |---|---|---|
 * | `<'border-top-width'>` | it is that property, or takes the same values | `border-block-end` |
 * | `<color>` | its own grammar asks for that type | `border-bottom` |
 * | `solid` | its own grammar lists that word | `grid` |
 * | `weight` | it is NAMED that — the word is a flag, not a value | `font-synthesis` |
 *
 * The fourth is the odd one and the reason this is not a lookup. `font-synthesis: weight` does not
 * give `font-synthesis-weight` the value `weight`; it turns it ON. The word names the slot. No
 * grammar of a longhand mentions it, so the first three rules all draw a blank and the family reads
 * as unclassifiable.
 *
 * ## Why the grammar has to be FOLLOWED, not read
 *
 * `border-bottom-color` is written `<'border-top-color'>` — a reference to another property rather
 * than a type. Matching `<color>` against that text fails silently: the component is then
 * resolved into its own alternatives and `border-bottom` comes out with 222 of them instead of 3. So a property's grammar is read through its references before anything is matched
 * against it.
 */

/** Reads a property's grammar. Injected, because the source of it belongs to the build and not here. */
export type SyntaxOf = (property: string) => string;

/** Follows `<'other-property'>` to whatever it really is. */
export function resolving(syntax: SyntaxOf): SyntaxOf {
  const followed = (property: string, depth: number): string => {
    const own = syntax(property);
    if (own === "" || depth > 3) return own;
    const reference = /^<'([-\w]+)'>$/.exec(own.trim());
    return reference === null ? own : followed(reference[1], depth + 1);
  };
  return (property) => followed(property, 0);
}

/** A word on its own, not a piece of a longer one — `style` must not match `font-style`. */
function mentions(syntax: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^-\\w])${escaped}([^-\\w]|$)`).test(syntax);
}

/**
 * The longhands a component feeds. Empty means nobody claimed it.
 *
 * Several is not a failure on its own — `border`'s `<line-width>` feeds all four sides — but it is
 * ambiguous where two components claim the same longhand, which the caller checks.
 */
export function longhandsFor(term: Term, longhands: readonly string[], syntax: SyntaxOf): readonly string[] {
  /**
   * A GROUP is one component, so it answers with whatever its alternatives answer.
   *
   * `<single-transition>` is `[ none | <single-transition-property> ] || <time> || …` — the group
   * is one of its components, it names no type, and nothing here claimed it. Every family written
   * as a comma-separated list has this shape, and without it none of them produced a single slot.
   */
  if (term.kind === "alt") {
    return [...new Set((term.terms ?? []).flatMap((one) => longhandsFor(one, longhands, syntax)))];
  }

  if (term.kind === "property" && term.name !== undefined) {
    if (longhands.includes(term.name)) return [term.name];

    const pattern = syntax(term.name);
    if (pattern !== "") {
      const same = longhands.filter((one) => syntax(one) === pattern);
      if (same.length > 0) return same;
    }

    // `border-block-end`'s grammar names `<'border-top-width'>` while its own longhand is
    // `border-block-end-width`. The reference means "the kind of value that property takes", so the
    // family's longhand for the same component is the one whose name ends the same way.
    const tail = term.name.split("-").at(-1);
    return tail === undefined ? [] : longhands.filter((one) => one.endsWith(`-${tail}`));
  }

  if (term.kind === "keyword" && term.name !== undefined) {
    const lists = longhands.filter((one) => mentions(syntax(one), term.name as string));
    if (lists.length > 0) return lists;
    // A FLAG: the word names the longhand rather than describing a value it takes.
    return longhands.filter((one) => one.endsWith(`-${term.name}`));
  }

  /**
   * A FUNCTION is claimed by the longhand whose grammar calls it — `font-variant-alternates` is
   * the one that takes `stylistic()`. Written apart from the type case because a function is
   * spelled with its parenthesis and a type is not.
   */
  if (term.kind === "function" && term.name !== undefined) {
    return longhands.filter((one) => syntax(one).includes(`${term.name}(`));
  }

  if (term.kind === "data" && term.name !== undefined) {
    const wanted = `<${term.name}>`;
    return longhands.filter((one) => syntax(one).includes(wanted));
  }

  return [];
}

/**
 * What a component ACCEPTS, so a token can be recognised as it.
 *
 * `longhandsFor` above answers the question the grammar asks — which longhand is this component
 * for. Splitting needs the other direction: a token is written, and which component is it? That
 * cannot be a lookup of tokens, because a token may be anything an author types. It is a
 * PREDICATE, and the grammar is where the predicate comes from.
 *
 *     <line-style>     words only: none hidden dotted dashed solid double groove ridge inset outset
 *     <line-width>     words thin medium thick, or anything whose primitive is a length
 *     <keyframes-name> no words at all: a custom-ident or a string, which is to say almost anything
 *
 * The third is why a component that accepts a free identifier has to be known as such rather than
 * tried last: it answers YES to nearly every token, so it can only be asked once everything with a
 * closed grammar has said no.
 */
export interface Accepts {
  /** Keywords it takes, exactly. */
  readonly words: readonly string[];
  /** Primitive types it takes — `length`, `color`, `custom-ident`. */
  readonly types: readonly string[];
  /** Functions it takes, by name. */
  readonly functions: readonly string[];
}

/** Reads a NAMED grammar — a type like `line-style`, or a property. Injected, like `SyntaxOf`. */
export type GrammarOf = (name: string) => string;

/**
 * Resolve a component into what it accepts, following named types to the bottom.
 *
 * The depth cap and the `seen` set are both load-bearing: CSS's grammars refer to each other and
 * `<calc-sum>` refers to itself, so a resolver with neither does not return.
 */
export function acceptedBy(term: Term, grammar: GrammarOf, depth = 0, seen = new Set<string>()): Accepts {
  const words = new Set<string>();
  const types = new Set<string>();
  const functions = new Set<string>();

  const absorb = (below: Accepts): void => {
    for (const word of below.words) words.add(word);
    for (const type of below.types) types.add(type);
    for (const call of below.functions) functions.add(call);
  };

  const take = (one: Term): void => {
    if (one.kind === "keyword" && one.name !== undefined) {
      words.add(one.name);
      return;
    }
    if (one.kind === "function" && one.name !== undefined) {
      functions.add(one.name);
      return;
    }
    if (one.name === undefined) {
      /**
       * A GROUP standing where a component stands is one component, and what is inside it counts.
       *
       * `<baseline-position>` is `[ first | last ]? && baseline`: the group is one component of the
       * `&&` and has no name, so without this it falls past every branch above and only `baseline`
       * comes back — measured, `text-emphasis-style` and `position-try-fallbacks` then lost their
       * own vocabulary in the token table and refused values they could have split.
       */
      if (one.kind === "alt" || one.kind === "seq" || one.kind === "or" || one.kind === "and")
        absorb(acceptedBy(one, grammar, depth, seen));
      return;
    }

    // A type with a grammar of its own is followed; one without is a PRIMITIVE and is the answer.
    const inner = depth > 4 || seen.has(one.name) ? "" : grammar(one.name);
    if (inner === "") {
      types.add(one.name);
      return;
    }
    let tree;
    try {
      tree = parseValueSyntax(inner);
    } catch {
      // A grammar this cannot read is a type we cannot open, which is still an answer.
      types.add(one.name);
      return;
    }
    absorb(acceptedBy(tree, grammar, depth + 1, new Set([...seen, one.name])));
  };

  for (const branch of alternativesOf(term)) {
    if (branch.kind === "alt") {
      absorb(acceptedBy(branch, grammar, depth, seen));
      continue;
    }
    const parts =
      branch.kind === "seq" || branch.kind === "or" || branch.kind === "and" ? componentsOf(branch) : [branch];
    for (const one of parts) take(one);
  }

  return { words: [...words], types: [...types], functions: [...functions] };
}

/**
 * Whether a component can only be told by having nothing else claim the token.
 *
 * `<keyframes-name>` is a `custom-ident`, which is to say any word at all. A component like that
 * answers yes to nearly everything, so it is asked LAST and only where every closed grammar has
 * said no — the rule that puts `spin` in `animation-name` without a list of animation names, which
 * could not exist.
 */
export function isOpen(accepts: Accepts): boolean {
  return accepts.types.includes("custom-ident") || accepts.types.includes("string");
}
