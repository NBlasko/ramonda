---
"@ramonda/check": minor
---

`duplicate-key-among-siblings` — two children of the same parent written with the same `key`.

A key is how the diff decides that the node it is looking at is the node it saw last time. Two
children claiming the same one means only one can be matched: the other is treated as new, so its
state and its DOM land on a node that is not it, while the page still looks right.

Read from the PARENT, because the fault belongs to neither child on its own — each is a good
element with a good key, and what is wrong is that they are siblings. That is also what makes "among
siblings" exact: the same key under a different parent is a different key and is never reported.

Keys written as literals only, strings and numbers alike. `key={row.id}` may well collide at run
time and deciding that needs the data, which is what `RMD002` is for.

A warning for now, and an error in a later version — the rule for a new rule here, kept even though
a duplicate literal key is not a judgement call.
