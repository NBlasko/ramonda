---
"@ramonda/check": minor
---

The three key rules read a list whose row callback was lifted out of the JSX.

`rows.map(renderRow)` is the same list `rows.map((row) => …)` is, and the row inside `renderRow` is
the same row — but all three rules read only the inline form. So a list stopped being checked at
exactly the moment it grew big enough for somebody to extract the row, which is the list most likely
to have a real key fault in it. Measured: four unkeyed rows and one index key, all silent.

- **`row-without-a-key`** and **`index-as-key`** now share one walk, `rules/row-callback.ts`, rather
  than a copy each — two spellings of one question are two answers waiting to disagree about the
  same list. The report lands where the ROW is written, so an extracted callback handed to three
  lists is one report at the element that needs the key.
- **`index-as-key`** also reads a key through a local one line up: `` const rowKey = `row-${i}` ``
  followed by `key={rowKey}` is the same position, moved for readability. A `const` inside a
  function only — a module-level one cannot mention the index at all.
- **`duplicate-key-among-siblings`** compares a key held in a `const`: two siblings written
  `key={FIRST}` claim the same key exactly as two written `key="first"` do.

The reverse lookup is memoised per file on a `WeakMap`. Asked per row it is one walk of the whole
file each time — measured on a file with 400 extracted callbacks, 0.55 s becomes 0.95 s and the
shape is quadratic in the file. Memoised, the same file runs in 0.55 s, which is what it cost before
any of this, while reporting 400 faults that were invisible.

No change to what is reported on any project in this repository.
