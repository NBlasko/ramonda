---
"@ramonda/lens": minor
"@ramonda/core": patch
---

A lens write keeps hidden symbols across an edit, and `set` takes an option.

`list()` recognises a row by the object it holds. Every immutable update replaces that object, so the row was torn down and built again — taking whatever its component was holding with it: a half-typed input, an open menu, a scroll position.

Anything looking at the result afterwards has to GUESS which new object is which old row. A lens write does not have to: at the moment it replaces a value it is holding both versions, so the answer is known. It now carries the value's non-enumerable symbols onto the copy, and `focusOn(rows).at(0).merge({ done: true })` keeps that row's component exactly as it was.

`set` is the exception. It is handed a value rather than deriving one, so `set(edited)` and `set(aDifferentRow)` are the same call, and carrying would give a different row the open editor of the row it replaced. It keeps nothing unless told:

```ts
focusOn(items).at(0).set(other);                            // a different value
focusOn(items).at(0).set(rebuilt, { keepSymbols: true });   // the same one, rebuilt
focusOn(items).at(0).set(rebuilt, { keepSymbols: [MINE] }); // only this one
```

The lens knows nothing about what the symbols mean — `keepSymbols` is generic, and `merge`, `update` and a write aimed deeper all keep automatically because they derive. Core exports `SAME_ITEM` as the ready-made option, so an app never has to name the symbol behind it:

```ts
this.rows = focusOn(this.rows).at(0).set(fromTheForm, SAME_ITEM);
```

`1.33 KB → 1.50 KB` gzipped.
