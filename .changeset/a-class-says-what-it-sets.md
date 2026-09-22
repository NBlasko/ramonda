---
"@ramonda/css": minor
---

**Every class name now says what its declaration sets**, and no name is only a hash.

```
padding: 12px                  r-p-12px
outline-offset: 4px            r-outline_offset-4px       (was r-outline-offset-4px)
&:hover { color: red }         r-:hover.c-red             (was r-:hover-c-red)
content: "a b"                 r-content-5dEHlFqj2        (was r-5dEHlFqj2)
&[data-on] { color: red }      r-0W6pfz.c-red             (was r-QbofRLj5j)
```

A class is two halves with a `-` between them: **what the declaration sets** — its context and its
property — and the value. The first `-` is the boundary, so nothing in the first half may be one: a
property's own dashes are written `_`, and the context joins the property with a `.`.

**Why it has to be in the name.** Composing two blocks keeps, per thing set, the one written later.
A block handed to another component arrives as classes and nothing else, so what a class sets has to
be readable out of the class itself or a merge has nothing to decide with.

Each half falls back on its own now, and the other one still reads. A hashed context is marked by a
leading `0`, which nothing an author wrote can start with — no CSS property may begin with a digit,
and every context begins with `:`, `.`, `_`, `@` or `[`. What still hashes a context is a selector
list, a quote, and a `-`, which is what `[data-on]` and every `@media (min-width: …)` cost.

Measured on this repository: 23 of 91 class names had nothing readable in them, and none do now. The
class attribute grew 17% for it.

**A key collision is a build failure**, asserted where the sheet is assembled, with both texts and
both files named. Two hashed keys colliding would look to a merge like one thing set twice, and the
earlier rule would be dropped from a page that renders — the one failure mode that is silent.
