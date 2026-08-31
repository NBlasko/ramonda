---
"@ramonda/core": patch
---

Two pages said TypeScript refuses a function as a JSX tag. It refuses two thirds of it.

`JSX.ElementType` is deliberately not declared, so the compiler's default rule applies: a tag has to
return one `JSX.Element`. Measured on all three shapes against core's own types:

| the function returns | the compiler |
|---|---|
| several nodes — `[<p/>, <p/>]` | refused, `TS2786` |
| anything that is not a node | refused, `TS2786` |
| exactly ONE node — `<p/>` | **accepted** |

The accepted one is how a function component gets written out of habit, so the shape most likely to
appear was the one nothing typed caught. `RMD011` catches it at runtime and its own page said the
compiler had already refused it — which is the sentence that would stop somebody looking.

Corrected in `reference/diagnostics.md`, in `why/classes.md`, and beside the decision itself in
`global.ts`, where the note said the default rule "rejects a function returning an array of vnodes"
and left the single-node case unsaid.
