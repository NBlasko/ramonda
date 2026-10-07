/**
 * A space-separated list of words — a property's keywords from the generated tables — as a set,
 * made once per list.
 *
 * Built per value instead, `canonicalValue` alone was 21.6% of a build on 1000 files of ten blocks
 * (`scripts/css/bench-css.mjs`) — `color` has over two hundred keywords. The lists are the tables' own
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
