---
"@ramonda/css": minor
---

Three things a user met in the editor.

**An accepted auto-import landed at the end of the file** when it carried a `@@` block, and at the
top the moment the block was deleted. `getCompletionsAtPosition` was proxied and mapped the caret
into the virtual file; `getCompletionEntryDetails` was not proxied at all, so TypeScript got the
author's position against the virtual text and returned nothing the editor could place. It is
proxied now, and every span a code action would write at is mapped home — an insertion that lands in
this package's own preamble is written at the author's own first character, which is where an import
belongs. A code action holding a span that maps nowhere is dropped whole.

**`import { $ } from "@ramonda/css/properties"` was offered** beside the real `$` from a project's
generated module. That `$` exists only to carry a sentence for a project that has declared no
variables, and an export is an auto-import suggestion. The virtual file writes the fallback inline
now, and nothing exports a `$` but the generated module.

**`Var<K>` is generated**, for a value toggled between variables:

```ts
const tone: Var<"color"> = toggle ? $.color.accent.quiet : $.color.accent.main;
```

`Token<"color", …>` could not express this — its second parameter is the variable's range, and a
toggled value has two. Inference already carries the local case; `Var<K>` is for a class field, a
parameter, or a return type.
