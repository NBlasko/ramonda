---
"@ramonda/css": minor
---

`variablesOnly` is a selector inside `properties` now, not a top-level list of kinds.

```ts
properties: {
  "*":             { shorthand: false },      // every property
  "<length>":      { variablesOnly: true },   // every property whose value is that kind
  "border-radius": { variablesOnly: false },  // that property, overriding the kind
}
```

`properties` is keyed by three things — the sweep, a kind, a property name — each binding more
tightly than the one before, and merged key by key so shared configs still combine.

It was a top-level key listing kinds, which made it the one setting keyed by kind while every other
was keyed by property. Per property alone could not work: `<color>` reaches 40 properties and
`<length>` 127.

**What the list could not express is the exemption** — it was all-or-nothing per kind, so a project
could not say *lengths from variables, except `border-radius`*.

The old key is refused with the selector written out from its own list. `<length>` is the same word
already written in `kind("length", …)`.
