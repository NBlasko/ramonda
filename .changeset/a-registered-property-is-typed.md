---
"@ramonda/css": minor
---

`@@property( … )` binds a TYPED name, and a property nothing sets is reported.

```tsx
const angle = @@property( syntax: "<angle>"; inherits: false; initial-value: 0deg; );
const dial = @@( transform: rotate(var({angle})); );

<div className={dial} style={toStyle([[angle, "45deg"]])} />
```

The binding's type is `CssVar<"angle">`, read from the `syntax` the declaration wrote, so `toStyle`
refuses a length where an angle was declared — the same check a declared `$` variable already got,
now answering for a registered property too. A `syntax` with no kind behind it — `"*"`, or a
compound grammar — binds `CssVar<"any">`, which takes what CSS itself would.

**`registered-never-set`** is the other half. `initial-value` is required, so a property nothing
ever sets still renders: every element gets the initial, the page looks right, and nothing says the
value meant to vary never arrives. It is reported on the declaration.

Anything that mentions the binding in TypeScript counts as setting it — `style`, `toStyle`, a helper
it is passed to — so the rule fires only when the name is written in exactly one place and read from
blocks. A library exporting a property for its consumers to set is the one shape it is wrong about,
and both escapes are asserted: a `ramonda-css-ignore` above the declaration, or the id turned off in
`ramonda.css.ts`.
