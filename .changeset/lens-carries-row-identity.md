---
"@ramonda/lens": minor
"@ramonda/core": patch
---

A lens write keeps the row's identity.

`list()` recognises a row by the object it holds. Every immutable update replaces that object, so the row was torn down and built again — taking whatever its component was holding with it: a half-typed input, an open menu, a scroll position.

Anything looking at the result afterwards has to GUESS which new object is which old row. A lens write does not have to: at the moment it replaces a value it is holding both versions, so the answer is known. It now carries the marker across, and a `focusOn(rows).at(0).merge({ done: true })` keeps that row's component exactly as it was.

The marker comes from the global symbol registry (`Symbol.for("ramonda.row")`), so lens still depends on nothing — with core present the two agree, and without it there is never a marker to carry.

`1.33 KB → 1.46 KB` gzipped.
