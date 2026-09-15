---
"@ramonda/css": patch
---

A numeric CSS value is a number in the type, so a narrowed property stops listing values you cannot
write.

```
before   "z-index"?: 0 | 1 | "0" | "1" | 10 | "10" | 100 | "100" | 1000 | "1000" | …
after    "z-index"?: 0 | 1 | 10 | 100 | 1000 | Token<…> | CssGlobal | `var(${string})`
```

The string spellings were there because the virtual file quoted every declaration's value, so
`z-index: 1` reached the type as `"1"` — and a list of numbers refused its own permitted values. The
fix admitted both spellings, which made the type offer `"1"` while `string-not-allowed` refuses
quotes in CSS and is right to. A type that lists a value the checker rejects is a contradiction, and
explaining it in a doc comment did not make it one less.

`quoted` emits a numeric value as a number now. A hole is unaffected: a numeric one is a number, and
a string one widens to `string`, which no narrowed property accepts.

And `z-index: "1"` is one report — the compiler's `Type '"\"1\""' is not assignable` is dropped where
the rule has spoken.
