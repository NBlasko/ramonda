---
"@ramonda/check": patch
---

`--fix` no longer shifts every edit in a file that starts with a BOM

A byte-order mark is the one place the two readers of a file disagree. TypeScript **strips** it, so
every offset a rule produces is relative to the text without it; `readFileSync` keeps it, as a single
`﻿`. Slicing the kept text with the stripped text's offsets put every edit one character early.

Measured on a real file: `<div class="card">` came back `<divclassNames="card">`, having eaten the
space and left the `s` behind. Silent, valid-looking, and in a tool that writes somebody's source.

The mark is stripped before the offsets are used and put back on write, so the file keeps whatever it
had. CRLF needed no such handling and was checked at the same time: TypeScript keeps `\r\n` in its
text, so those offsets already agree.

Pinned by a test that asserts the whole resulting string rather than that something changed — a
regression here corrupts a file rather than failing loudly.
