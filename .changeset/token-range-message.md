---
"@ramonda/css": minor
---

`toStyle` says why a value was refused, instead of `not assignable to type 'never'`.

```
before   Type 'Token<"length", "16px">' is not assignable to type 'never'.
         Type 'string' is not assignable to type 'never'.

after    Type '"24px"' is not assignable to type
           '"24px" & this_variable_may_only_be<"8px" | "16px">'
```

Two errors on one line become one, and it names the values the variable may take. A variable
declared with a bare value — which means it never changes — says that instead, and says to give it a
`range`.

The second parameter of a `Token` was always the RANGE rather than the initial value; a bare
declaration has a range of one value, so the two coincide. What was missing was any way to read that
off the refusal.

`Fixed<V>` is exported and is written by codegen for a bare declaration. It marks the declaration,
not the value: `range: ["16px"]` is a range that holds one value and stays settable.
