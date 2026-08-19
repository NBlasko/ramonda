---
"@ramonda/check": patch
---

The command now prints the rule's id above each report.

It appeared nowhere in the output, which left a reader with a sentence and no name. The id **is** the
name: it is the key in `findings`, the row on the reference page, and the thing to search for. With
it, somebody looking at a warning can find the entry that explains it; without it they have prose
and a guess.

```
[ramonda-check] click-with-no-keyboard-path — 1 click handler(s) a keyboard cannot reach:
```

No URL beside it, deliberately. The reference is a table of rules with no per-rule anchor, so a link
would land at the top of a long page — the exact failure the docs' own link test was written about,
where "the docs sent me to the wrong place" reads as a broken site rather than a broken link. The
package's README carries the address once, which is where an address belongs.
