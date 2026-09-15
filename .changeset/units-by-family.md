---
"@ramonda/css": minor
---

`units` in `ramonda.css.ts` is keyed by unit family, and the flat list is refused.

```ts
units: { length: ["px", "rem"] }      // lengths are these two
units: { length: ["px"], time: ["ms"] }
units: { flex: [] }                   // `fr` is not used here at all
```

A family the config does not name is not constrained. The flat list — `units: ["px", "rem"]` — meant
*every unit in CSS and nothing else*, and measured, a project stating the one rule it wanted got four
reports on ordinary CSS it had no opinion about: `transition: all 200ms ease`, `width: 50%`,
`rotate: 45deg`, `grid-template-columns: repeat(3, 1fr)`. To say "lengths are px and rem" you had to
enumerate the units of five other families.

**The old list is refused rather than reinterpreted.** Reading it as `{ length: [...] }` would make a
project's rules quietly weaker on upgrade, with nothing said. The error writes out the family form
with your own units in it.

The `units` key inside `properties` is unchanged — that one is per property and reaches the types.
