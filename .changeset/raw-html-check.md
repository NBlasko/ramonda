---
"@ramonda/docs": patch
---

The docs build fails on raw HTML in prose, instead of showing it to the reader.

`/devtools` shipped telling people to press `<kbd>Alt</kbd>+<kbd>D</kbd>` — in those exact characters.
The content pipeline runs markdown with `html: false` on purpose (a documentation page has no business
injecting markup), and the consequence is that a tag written in prose is escaped and rendered verbatim.
Nothing said so, and a page cannot fail a build.

Now it can. The check walks the tree that is already built, so it costs nothing, and code is exempt —
inside a fence or backticks a tag is the subject rather than a mistake. Every existing page passes, which
is what made failing safe to turn on: the scan found nothing once `/devtools` was fixed by hand.

It has a self-test (`DOCS_SELFTEST=rawhtml`) and was checked against a real page edit as well, because a
check that has only ever been tried on synthetic input is a check nobody has tried.
