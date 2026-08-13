---
"@ramonda/check": patch
---

A component under another name is followed, and the message for one that is not says what it means.

`const Named = Reader` and then `<Named />` was reported as a hole. It is a plain rename: one hop to
what the name was declared with, which a loader, a binding and a factory's registry already got — a
tag was the one place without it.

The message for a name that genuinely cannot be followed said `resolves to VariableDeclaration`,
which is the compiler's word for it and reads to everyone else as something else entirely. It now
says a variable holds it and what it holds cannot be read from where it is declared — or, for a
parameter, that only a caller can say.

The hop is bounded, because two constants that name each other are a runtime error and ordinary
syntax; the cycles fixture caught that within the minute of the hop being added.
