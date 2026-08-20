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
through the import and only reported when what it returns is a literal built INSIDE it, so a helper
handing back an object it holds stays silent — as does a module-level `const`, which is the
documented fix. The walk is bounded at four hops and cycle-guarded, and a `@compute` is never
followed, because caching is the whole of what it does.

The report now quotes the line — `<Row conf={local}>`, `<Row conf={makeConf()}>` — and names where
the value is built, rather than printing `{…}` for everything. Calling `conf={local}` a `conf={{…}}`
sends a reader looking for a brace that is not there.
