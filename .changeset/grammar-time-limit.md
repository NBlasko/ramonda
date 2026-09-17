---
"@ramonda/css": patch
---

The grammar tests no longer fail when the machine is busy.

`includeExplanation` makes shiki tokenise each line twice — once for scopes, once for the binary
form — and hands both passes the same 500 ms limit. When one trips it and the other does not, the
two disagree about where the line ends and shiki walks the shorter list with an index from the
longer one, reading `undefined`.

It appeared once in a full run with every package's tests going at once, and not on an idle machine.
Turning the limit down to 1 ms reproduces the same error every time, which is what identified it.

The limit is now zero, which is `vscode-textmate`'s own default: a time limit has nothing to do with
what these tests claim, which is the scope a grammar gives a piece of text.
