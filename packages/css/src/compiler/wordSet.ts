/**
 * A space-separated list of words — a property's keywords from the generated tables — as a set,
 * made once per list.
 *
 * Every caller used to split and build its own on every value: `canonicalValue` did it for each
 * declaration, and `color` alone has over two hundred keywords. Measured on 1000 files of ten blocks
 * (`scripts/bench-css.mjs`), that one function was 21.6% of a build. The lists are the tables' own
 * strings, so the same list is always the same key, and there are a few hundred of them at most.
 */
const sets = new Map<string, ReadonlySet<string>>();

export function wordSet(list: string): ReadonlySet<string> {
  let found = sets.get(list);
  if (found === undefined) {
    // An empty list is a property that takes no keyword at all; splitting "" would give a set
    // holding one empty string, which matches nothing and reads as a bug later.
    found = new Set(list === "" ? [] : list.split(" "));
    sets.set(list, found);
  }
  return found;
}
