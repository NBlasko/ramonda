---
"@ramonda/css": patch
---

A closed `values` list is asked per property, which fixes three faults at once.

```
values + variablesOnly        the literal went in anyway — `variablesOnly` was never consulted
"<time>": { values: [...] }   emitted a row literally NAMED `"<time>"`, constraining nothing
"*": { values: [...] }        silently did nothing at all
```

The branch writing a closed list walked the config's own KEYS while every other setting asks
`ruleFor(property)`. A kind selector exposed it; the `"*"` fault predates the selector and was never
noticed.

`"*": { values: [...] }` is refused now, naming the two places a closed list belongs. A list of
permitted values for all 935 properties is not a thing anybody means, and doing nothing about it
quietly was the worse answer.

`variablesOnly` removes the literal spelling and nothing else — a variable is still held to the
range by its declared value.
