---
"@ramonda/css": patch
---

Two conditions that can both hold, setting one property, are refused instead of ordered by the build.

`widthSlot` ranks a breakpoint by its width and everything else by a small table of bands — and two
different conditions inside one band tie. A tie is settled by the sheet's position, which is the
order the build happened to meet them. Measured in Chromium through a real Vite build, the same
block each time:

```
@supports (display: grid) { color: red; } @supports (display: flex) { color: blue; }

alone in the file                            blue — what plain CSS says
interfering block in ANOTHER file            RED
interfering block in the SAME file           RED
```

Both queries are true in every browser that can read the sheet, so the page depended on what another
component wrote. There is no order to give the pair that is CSS's — one sheet, one position, and two
blocks each wanting a different one — so the shape is refused with the fix in the message.

Conditions that exclude each other still tie and still say nothing: a colour scheme, an orientation
and a medium are most of what anybody writes, and no element is ever matched by both.
