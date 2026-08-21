---
"@ramonda/check": minor
---

The class family follows a value one name away — three rules, one of them a false report.

- **`state-mutated-in-place` reads what a `@state` field holds through a name.** The rule mirrors
  the runtime mutation guard on purpose, and the guard wraps a plain array or object whatever
  produced it — so `@state rows = makeRows()` is the same array `@state rows = []` is, and
  `this.rows.push(row)` is the same silence. Reading only the initializer meant four spellings of
  one fault with only the first reported: a helper, a module `const`, a branch, and an object built
  anywhere but on the line.
- **`interval-with-no-cleanup` follows the id out of the local it passes through.** A FALSE REPORT:
  `const id = setInterval(…); this.tick = id`, on a component whose `@destroyed` clears `this.tick`,
  was reported as an interval nothing could ever reach. The id escapes the local the moment it is
  assigned to a property, and where it lands decides whether anything clears it.
- **`watch-of-a-prop-that-is-not-there` reads a selector kept in a `const`.** `@watchProp(BY_USER)`
  is handed the same function `@watchProp((p) => p.userId)` is. A `const` only, and only through to
  a function literal — a `let` can be written again and a call has no single answer, and this rule's
  cost of being wrong is telling somebody a prop they can see does not exist.

`clock-read-while-rendering`, `stale-field` and `unwatched-fields` were walked through the same list
and hold: a clock read is found in the render and behind a helper in another file, `new Date(iso)`
parses and stays silent, and both of the others already ask the base classes.

No change to what is reported on any project in this repository.
