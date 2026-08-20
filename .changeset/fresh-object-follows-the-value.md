---
"@ramonda/check": minor
---

`fresh-object-in-props` follows the value instead of matching the shape.

The literal written straight into the attribute is the shape people write first, and it is not the
one that survives a refactor. Both of these were planted and both were silent:

```tsx
const conf = { dense: true };      // one line up, inside render()
return <Row conf={conf} />;

return <Row conf={makeConf()} />;  // a helper in another file
```

They are the same object built at the same moment, and both are now reported. A call is followed
through the import and only reported when what comes back is a literal built INSIDE it, so a helper
handing back an object it holds stays silent — as does a module-level `const`, which is the
documented fix. A `@compute` is never followed, because caching is the whole of what it does.

A helper that calls a helper is followed the same way, however deep it goes — pinned at twelve hops,
which is further than anyone writes on purpose. A low bound looks careful and is not: a chain the
walk abandons is reported as nothing at all, and nothing is what a clean codebase looks like. What
stops a runaway is the cycle guard, so mutual recursion terminates and reports nothing.

A branch is followed on both sides, which is where the most common shape of all lives:
`conf={this.conf ?? { dense: true }}` hands the child a fresh object on every render where the left
is missing, and so does an arm of a ternary. A helper written as an arrow is the same helper — `const makeConf = () => ({ dense: true })` was a
plain miss until it was planted — and a cast does not hide it either.

The report now quotes the line — `<Row conf={local}>`, `<Row conf={makeConf()}>` — and names the
function the literal is actually IN, rather than printing `{…}` for everything. For a chain that is
the innermost one: `conf={chainConf()}` already says `chainConf`, and where the reader needs to go
is `level3`.

It is also the one element rule still asked about an element that SPREADS. The family-wide silence
is about an attribute that is MISSING — `<img {...rest} />` may well carry its `alt` — and that
does not transfer: a spread cannot un-build an object literal written beside it. What it can do is
overwrite it, so order decides. Written after the last spread, nothing can take the prop away and
it is reported; written before one, it may never reach the child and this stays quiet.

A literal inside a `map` or a `list` callback is reported in its own words: it is built once per
ROW, so no row can be skipped when the list renders again. The advice differs there too — a value
derived from the row cannot be lifted to a constant, so what is offered is `@StableProps` on the row
component, or a `@compute` that maps the array once. The row itself, `conf={row}`, is as stable as
the array holding it and is never reported.
