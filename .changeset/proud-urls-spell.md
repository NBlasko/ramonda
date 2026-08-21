---
"@ramonda/check": minor
---

`browser-url` finds the same read spelled three other ways.

- **`self.location.pathname`.** `self` is the third name for the global object and the package's
  other rules about one already list it; this had `window`, `globalThis` and `document` only.
- **`const { pathname } = window.location`.** A read of exactly that member, with the member's own
  name on the left of it. The report quotes the line rather than rewriting it into
  `window.location.pathname`, which is text the reader would go looking for and not find.
- **`window.location["hash"]`.** The dotted read with brackets round it.

All three are reads the router already answers, in a project that has one, and all three were
silent. A write and a method call are still not reads, and a local called `location` is still not
the global.

No change to what is reported on any project in this repository.
