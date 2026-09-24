---
"@ramonda/css": patch
---

**Two registrations of one shorthand are merged, not overwritten.** A shorter list registered second
used to take the first one's longhands away, and a `padding-left` then survived a `padding` written
after it — silently, and decided by whichever module the bundler put last.

`shorthands` is documented as idempotent, and `CLEARS.set` was idempotent only while the two lists
matched. One build never produces two different lists for a key, because the emitter writes the whole
family. Two builds do: a library shipping blocks compiled against another version of this package
carries its own `_clears({ … })`, and an application on a newer one has both.

| registered | `padding-left` then `padding` |
|---|---|
| the full family | `r-p-8px` |
| the full family, then a shorter list | `r-pl-40px r-p-8px` — the clearing was gone |
| an empty list after a full one | `r-pl-40px r-p-8px` |

It takes the union now. First-wins would have the same problem from the other end, and these are one
family described twice: clearing a longhand a newer version has dropped costs nothing, because no
class carries it.
