---
"@ramonda/core": patch
---

`Head` keeps two `<link>`s that share `rel` and `href` but differ in `hreflang` or `sizes`. The language alternates of a page are one link per language plus `hreflang="x-default"`, which points at the same address as the default language's page; the two used to collapse into one, and the page lost a language with no message. An icon in several sizes from one file is kept whole the same way.
