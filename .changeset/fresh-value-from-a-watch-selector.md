---
"@ramonda/check": minor
---

New rule: `fresh-value-from-a-watch-selector` — a `@watchProp` selector that builds the value it
returns.

A selector's value is compared with `Object.is`, so an object or an array built inside the selector
is never equal to the one before it and the watcher fires on every props change, with `previous` and
`next` holding the same contents. Measured in `WatchSelectorIdentity.test.tsx`, two watchers on one
child while an UNRELATED prop moved three times:

| the selector | fired |
|---|---|
| `(p) => p.q` | **0** |
| `(p) => ({ q: p.q })` | **3** |

`q` never changed once. `@watchProp`'s own documentation warned about this shape; nothing reported
it.

**It is an error rather than a warning**, unlike `fresh-object-in-props`, which costs work while the
page stays right. A `@watchProp` body is where an app refetches, resets a form, cancels a request —
firing it when nothing changed is wrong, not slow. And there is no reading of a built selector value
that was intended: one that always says CHANGED is one that does nothing, which is why `arrow-fields`
is an error for the same sentence.

Two silences: a selector that READS an object (`(p) => p.filter`) hands back whatever the parent gave
it, and if the parent rebuilds it that is `fresh-object-in-props` at the call site; and a
subscription's ARGUMENTS, which look like the same shape and are not — a decorator's arguments are
evaluated once when the class is defined, measured as one object shared by every instance for the
life of the class, so this never asks about them.
