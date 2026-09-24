---
"@ramonda/css": patch
---

**A block inside a `${ … }` is reported by name, and the checker stops piling six syntax errors on
top of it.**

A template literal is text, so such a block produces no site — and the whole CSS pass in
`checkProject` sat behind `if (virtual !== undefined)`. The rule never ran, the file went to `tsc` as
written, and `ramonda-css` answered with what the rule exists to replace:

```
TS1005: ')' expected.
TS1003: Identifier expected.
TS2322: Type '{ className: string; red: true; }' is not assignable …
```

Six of them, naming neither the block nor the line. The build has always said it properly, and says
where in its own source why: *asked before the early return, since a file whose only block is in a
template finds no site at all*. The checker asked after.

Now:

```
block-in-a-template: a style block inside a `${ … }` compiles to nothing — a template literal is
text, and nothing here can see a block in one.

    Join it with `mergeClassNames` instead: …
```

And the compiler's word about that file goes with it: the file cannot be parsed until the block
moves, so every syntax error in it is about the fault already named — the same trade made wherever a
rule of ours speaks first.

**A `ramonda-css-ignore` no longer silences it in the checker, either.** It never could in the build,
and a directive that quieted one and not the other left an author with a green editor, a green
`ramonda-css`, and a failing build.
