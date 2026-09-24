import type { Term } from "./valueSyntax";

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
 * as unclassifiable — which is exactly what it did until this was added.
 *
 * ## Why the grammar has to be FOLLOWED, not read
 *
 * `border-bottom-color` is written `<'border-top-color'>` — a reference to another property rather
 * than a type. Matching `<color>` against that text fails, and it failed silently: the component
 * was then resolved into its own alternatives and `border-bottom` came out with 222 of them
 * instead of 3. So a property's grammar is read through its references before anything is matched
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
