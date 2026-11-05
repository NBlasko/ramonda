---
"@ramonda/core": patch
---

Removing rows walks what they hold by their siblings

A node taken out of the page is walked first for what its subtree holds — a ref to clear, a block to
tell, a field to let go. The walk read each node's `childNodes`, a list per node; it now steps by
`firstChild` and `nextSibling`. Measured in Chromium on 1000 js-framework-benchmark rows: the walk
went from 7.3 ms to 2.3 ms. Nothing it releases changed.
