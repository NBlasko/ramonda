---
"@ramonda/css": patch
---

A failing run no longer explains style blocks when there are none.

Every failure printed *N of those file(s) carry a style block. A position inside one is the author's
own — the block is checked through a virtual file…*. That answers a real question, and it is noise
about nothing when `N` is zero — which is now an ordinary outcome, because a typed rule reports on a
prop's declaration and a component can declare one without holding a block at all.

It is printed when a block is involved and not otherwise.
