---
"@ramonda/css": patch
---

A closed list of values takes numbers where CSS measures the property in numbers.

`values: ["1", "10"]` on `z-index` type-checked and then every use of it was refused, because a
quoted value is a CSS string and a browser drops the declaration. A setting that permits what the
checker will not take is worse than one that refuses outright.

The twenty-one properties CSS gives a `<number>` or an `<integer>` now take `readonly number[]`, from
a generated type built out of the same grammar the rules read. Everything else still takes either — a
time is `"120ms"` and a colour is `"#10b981"`.

Both halves, because nothing type-checks a config in the build: the type refuses it in your editor,
and the config validator refuses it with the number to write.
