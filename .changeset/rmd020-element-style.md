---
"@ramonda/core": patch
---

RMD020 no longer reports an element's `style` object rebuilt with the same contents — `<div style={{ color: "red" }}>`. The diff writes a style as text and compares the text, so no DOM write follows (measured: none over ten renders), and an element has no render to repeat; the report sent a reader to a `@compute` for nothing. A style whose contents differ between the two calls is still reported.
