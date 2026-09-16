---
"@ramonda/css": patch
---

The caret right after `@@` offers the named sites, not the whole world.

Typing `css={@@` and then `(` produced `css={@@Component()}` — the completion list held **1003
entries**, every global and local and keyword, with the first preselected so the next keystroke
committed a name the author never typed.

`css={@@}` has no parens yet, so no block is found and no virtual file is built; the question reached
TypeScript against the author's own text, where that caret is an ordinary expression position.

Four things can follow `@@` — a `(`, or `keyframes`, `font-face`, `property` — so that is the list,
and `isGlobalCompletion: false` stops the editor falling back to its own word list.

**And nothing in it commits by accident.** Narrowing the list was not enough: the first entry is
preselected, so `(` still wrote `@@keyframes()` where a plain `@@( … )` was meant. The position is
declared a new-identifier location — which it is, since `(` is a thing the author may type that is
not in the list — and every entry says its commit characters are none.

A single `@` is an ordinary decorator and is untouched.
