---
"@ramonda/css": minor
---

A split shorthand now puts one more class in front of its pieces: the family's own key with an empty value,
and no rule behind it. `padding: 8px` is `r-p- r-pt-8px r-pr-8px r-pb-8px r-pl-8px`.

It tells the merge that a whole `padding` was written there, so everything `padding` covers, written
earlier, is cleared before the pieces land. Two cases were wrong without it, both against a package
built by an older release:

- a longhand CSS added to a family after that release — its split has no piece for it, so nothing
  cleared it;
- a property that was one longhand then and is a shorthand now, like `overflow` — the old class for
  the whole property survived a split written after it, and won.
