---
"@ramonda/css": patch
---

A vendor prefix and the standard property it renames are ordered, not left to build order.

They are one property to the engine and two names to the model, so both landed in the same cascade
layer — and inside a layer the winner was whichever the build emitted first. Measured in Chromium
through a real Vite build, the same block each time:

```
-webkit-box-shadow: 0 0 1px red; box-shadow: 0 0 9px blue;

alone in the file                            blue   — what plain CSS says
after a block naming `box-shadow` first      RED
after a block with the same two, reversed    RED
```

The page depended on what another component wrote. The prefixed form now sorts first, so the
standard property wins wherever both appear and wins the same way in every build — which is also
what every author means by a prefixed fallback. Writing them the other way round is an override the
sheet cannot honour, and `override-out-of-order` says so with this pair's own reason.

A prefixed shorthand borrows its standard form's breadth too: `-webkit-border-radius` sat in the
longhands' own layer and lost to them.
