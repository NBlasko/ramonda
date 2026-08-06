---
"@ramonda/core": patch
---

A memoized handler no longer takes the page down over one argument

`@memoizedHandler` builds its cache key from the arguments, and only a string, a number or a boolean
can be part of one — an object cannot be compared by value, and keying on its identity would miss
every time. So an object argument is a mistake. It was a mistake that THREW, outside any `__DEV__`
guard and from inside a render, so one handler receiving an object took the whole page down in
production. Nothing else in the framework answers a runtime mistake that way: a list item that is not
an element is skipped so the list keeps rendering, a function in tag position is called rather than
crashing the page, a corrupt hydration blob is ignored so the page still renders.

Development still throws — the handler would be rebuilt on every render, so everything it is passed
to would re-render with it, silently, for the life of the page — and the message now names the
component, the method, and which argument it was: `#3 (object)`, `#1 (null)`. It also says what to
pass instead: the primitive the object stands for, `row.id` rather than `row`.

Production builds the handler and moves on without caching that call. The page keeps working; the
cost is the identity churn memoization exists to prevent, which is a slower page rather than a broken
one.
