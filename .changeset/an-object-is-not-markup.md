---
"@ramonda/check": minor
---

`object-among-the-children` — a plain object written where markup was meant

`vdom/h.ts` walks an element's children and replaces anything that is an object but not a vnode,
a list descriptor or an array with a hole: *"an object that is not a vnode has nothing the diff can
do with it"*. `RMD037` names it in a development build.

The failure is SILENT and it looks like data. Nothing throws and nothing is red — the page renders
without the thing, and the eye goes to the fetch, the state and the condition long before it goes to
the one child that was never markup. Almost always the line stopped a word early: `{item}` where
`{item.name}` was meant.

Reported wherever the object is written: in the child, in a `const` one line up, in a module
constant, or on one arm of a branch — that arm really is dropped whenever it is taken.

**A module constant counts here, and is the FIX in `fresh-object-in-props`.** Both walk the same
`follow`, and the difference is the question. "Is this value rebuilt?" — a module constant is the
answer. "What IS this value?" — it is still an object, and the runtime still drops it.

Silent on an ARRAY, which the runtime flattens into the children rather than dropping; on a CALL,
which may hand back a vnode, and this rule's claim is that the page is missing something; and on a
prop, a field read, a vnode, a string or a number.

Reports nothing across the documentation app, the packages and the playgrounds.
