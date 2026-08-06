---
"@ramonda/docs": patch
---

The copy button no longer sits on the first line of a code block

It is absolutely positioned at `top: 8px` and stands 23.5px tall, so it reaches 31.5px down — while
the first line of code started at the 16px of padding every side gets. A first line long enough to
reach the corner ran underneath it and was hidden by the button's own background, which is exactly
when you are hovering to click it.

Code blocks that carry a button now have `padding-top: 34px`, derived from the button's own geometry
rather than guessed, so the two move together if either changes. Blocks without one are untouched.
