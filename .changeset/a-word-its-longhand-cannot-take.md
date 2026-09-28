---
"@ramonda/css": minor
---

**A word one longhand of a shorthand has no place for is reported, and `!important` stopped being
counted as a value.**

CSS drops a whole declaration when any part of it is invalid; a split drops only the part. That rule
was already here for negatives — `padding: 10px -5px` sets nothing in a browser and would have set
the top and bottom. It is the same rule for WORDS, and nothing was checking them.

Two things changed together, because the answer is one measurement:

- the splitter refuses such a value, so a family keeps its shorthand rather than writing half of it.
  **`place-items` and `place-self` split for the first time** because of it — they had never been in
  the table, `place-items: start space-between` being a value no engine accepts and nothing
  refusing it.
- the checker names it. `word-out-of-its-longhand` says which word, which longhand, and that the
  browser drops the whole line. It stays quiet where `unknown-value` already names the word, which
  is most of them; what is left is the word the property DOES take and the longhand it lands on does
  not. Measured over every family in the table: five values, `place-items: left anchor-center` among
  them, ignored by Chromium, Firefox and WebKit and named by nothing until now.

**And a bug it uncovered.** `too-many-values` counted `!important` as a value, so
`padding: 4px 0 0 0 !important` — four values and a flag — was reported as five, and every finding
these rules produce refuses the BUILD. A page every browser renders did not compile. It had been
invisible because the families whose maximum is four had room for the flag underneath it;
`place-items`, which takes two, showed it the day it entered the table. All three spellings the
engines honour are handled: `!important`, `! important`, `!IMPORTANT`.

Run over `apps/docs`, both playgrounds, `packages/router`, `packages/query` and `packages/form`:
no findings.
