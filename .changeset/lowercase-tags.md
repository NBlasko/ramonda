---
"@ramonda/core": patch
---

Server-rendered HTML no longer depends on the DOM to lowercase our tag names

`h` uppercases an HTML tag on purpose: a real node reports `nodeName` in uppercase, the diff compares
against it on every pass, and converting once at construction beats converting on every comparison.
So `createElement` has always been called with `"DIV"`.

A browser and jsdom lowercase a created element's local name in an HTML document, so that was
invisible — every test passed either way. It is a dependency on the DOM normalising for us, and a
partial DOM does not: linkedom keeps what it is handed and serves `<DIV id="page">`. Valid HTML, and
identical once parsed (measured), but not what anyone should find in view-source on a page we served.

`createElement` is now handed the lowercase name. It is the right side to pay on: an element is built
once and diffed many times, so the hot path is untouched.

**The SVG branch is deliberately excluded.** SVG names are case-sensitive — `linearGradient`,
`clipPath`, `foreignObject` — and `h` never uppercases them for that reason. Lowercasing there would
turn `linearGradient` into a different element that renders nothing, on any page that happens to have
a gradient.

Asserted at the CALL rather than at the result, because the result is exactly what hid this: the
tests spy on `createElement`/`createElementNS` and check the names we ask for. Both halves are
verified load-bearing — reverting the lowercase fails two, and extending it to SVG fails two others.
