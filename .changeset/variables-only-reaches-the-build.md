---
"@ramonda/css": minor
---

`variablesOnly` reaches the build, and its message names the project.

The types refused `padding-left: 8px` and the rule said nothing — but vite and esbuild run the rules
and never type-check a block, so the build compiled what `ramonda-css check` refused. Only composite
properties like `border: 1px solid red` were caught.

```
before   TS2322: Type '"8px"' is not assignable to type
           'Narrowed<never, 0 | "0" | Token<"length" | "percentage" | "length-percentage">>'

after    literal-not-allowed: `8px` is a length or a percentage written out, and this project
           takes them only from its own variables.

           Declare it in `ramonda.css.ts` and write `$.…`, or set
           `"padding-left": { variablesOnly: false }`.
```

One report per fault: the compiler's word on that line is dropped where the rule has spoken.

A call, a bare `0`, `var()` and a hole are not literals and are never reported.
