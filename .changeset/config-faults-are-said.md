---
"@ramonda/css": patch
---

A fault in `ramonda.css.ts` is said, not crashed — and the editor stops hiding one.

Two halves of the same thing, both measured by running every way a config can be wrong through
every consumer that reads one.

A bad variable name, a value that would close the `:root` rule, and two variables spelling one
custom property all threw a raw `Error`, so they reached a person as a Node stack trace with the
sentence buried in it. `cli.ts` already draws this distinction — a fault in the author's file is
said, a bug of ours is thrown — and these were on the wrong side of it. No test saw it, because a
crash exits 1 and prints its message too. They are refusals now, and they name the config file,
which the Vite build never did.

In an editor, a config that could not be read was swallowed so it would not take the completions
down with it. It took every RULE down instead, in silence: a block breaking two of the project's own
settings showed nothing at all, under all nine broken configs measured. The completions still
survive, and now one diagnostic sits on the block saying the config did not read and no rules are
running. Only on files that hold a block.
