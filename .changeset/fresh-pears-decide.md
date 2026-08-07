---
"@ramonda/core": patch
---

`RMD043` and `RMD044`, and a reason written beside every message that keeps no code

Two more misuses become codes. `RMD043` — a `<meta>` passed to `Head` with no `name`, `property` or
`http-equiv`, which cannot be matched again and so would be appended on every update; it is skipped,
and now says so with a fix. `RMD044` — a tag that is neither a string, a component class nor a
function, which renders an empty host where something was meant to be.

**A tag that is `undefined` renders that empty host rather than throwing**, which is the fix half of
`RMD044` and matters in production, where there is no report at all. `<Thing />` whose import failed
arrives at the JSX factory as `undefined` — the first case `RMD044` names — and the factory read
`.__isComponent` off it, so it raised a `TypeError` from inside itself and took down the whole render
for a fault it is written to survive. One missing element now costs one element.

More useful than either: **every message that deliberately keeps no code now says why, where it is.**
There are four, and each is somebody else's fault surfaced with context rather than a mistake this
framework can advise on — `bootstrap`'s "App crashed", a lazily loaded component that never arrived, a
cleanup that threw during destroy, and the crash that follows `RMD011` after it has already been
named. A code that promises advice it cannot give is worse than a sentence.

One of those five was genuinely poor and is fixed rather than excused: a failed lazy load logged a bare
`console.error(e)`, which in a page full of chunks names nothing. It now names the module it was
loading. Still unconditional, because a failed lazy route is exactly what somebody needs to see in a
production log, and still not a diagnostic, because the failure is the network's answer.
