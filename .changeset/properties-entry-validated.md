---
"@ramonda/css": patch
---

A wrong setting inside `properties` is refused with a sentence, instead of crashing or being ignored.

The config validator checked the top-level keys and the `properties` keys, and stopped there. Inside
an entry, `units` and `values` reached `.map` on a non-array: measured,
`properties: { "<length>": { units: { length: ["px"] } } }` threw `units.map is not a function` out of
codegen, with a stack naming neither the file nor the key — and from an editor that throw comes out
of `getScriptSnapshot`, which takes down completion, hover and every squiggle in the project.

`units` was the sharp one, because the top-level key changed to be keyed by family and says so when
a list arrives. Per property it is still a list — one property, one set of units — so an author
applying the top-level lesson one level down was thanked with a crash. The message now says which
shape belongs where.

`shorthand: "no"`, `variablesOnly: "yes"`, `arity: "2"` and a key that is not a setting at all were
accepted in silence and did nothing. A misspelled property name was too: `"<lenght>"` was refused
and `"padding-lft"` was not. All of them are refused now, with the near miss offered.
