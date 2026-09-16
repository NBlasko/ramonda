---
"@ramonda/css": patch
---

The unused-code dimming, and a `// TODO`, are the author's own again.

An editor fades unused code out from `getSuggestionDiagnostics` — a third list beside the semantic
and syntactic ones, and it was not proxied. It came straight off the virtual file with virtual
positions, so an editor applied them to the author's text at face value: a word came out half
coloured, and hovering a `<div>` said `'__cond' is declared but its value is never read` — a name
this package wrote and nobody can act on.

Where the stray fades LANDED depended on the file's length, which is why editing an unrelated line
changed the symptom and why removing every `$` appeared to cure it: the preamble is shorter without
one, so the same meaningless offsets fell past the end of the text instead of onto it.

A sweep of the language service for every method that answers with a position found one more:
`getTodoComments` reported a comment on line five at offset 838 of a file a hundred characters long.

Both map home now, so a name the author really did leave unused is still faded and a TODO they wrote
is still found — at the place they wrote it.
