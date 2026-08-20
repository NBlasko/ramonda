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

A helper written as an arrow is the same helper — `const makeConf = () => ({ dense: true })` was a
plain miss until it was planted — and a cast does not hide it either.

The report now quotes the line — `<Row conf={local}>`, `<Row conf={makeConf()}>` — and names the
function the literal is actually IN, rather than printing `{…}` for everything. For a chain that is
the innermost one: `conf={chainConf()}` already says `chainConf`, and where the reader needs to go
is `level3`.
