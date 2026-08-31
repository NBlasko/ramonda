---
"@ramonda/check": minor
---

`function-built-in-the-markup` — a function literal written into a JSX attribute

`RMD020` has reported this at runtime for a long time, as its `handler` verdict: a development
build renders every component twice in one tick, and a function built in place comes back with the
same source and a fresh identity. Nothing said it before the code ran, so the docs shipped a
`reference/api.md` row demonstrating the very pattern the framework reports, and the gate was green
over it.

**Measured on the element, not argued.** `<button onclick={() => this.n} />` under a component
whose state changes makes **3 `addEventListener` and 3 `removeEventListener` calls over three
re-renders** — one pair per render, which is exactly the churn the runtime's message names.

**It agrees with the runtime rather than having its own opinion.** With `strictRender` on,
`<AsyncLoad lazy={() => import(…)} errorFallback={({ retry }) => …} />` makes `RMD020` name
`AsyncLoad.lazy` and `AsyncLoad.errorFallback` — the same two props, at the same sites, this rule
reports.

**It fires on a host element, where `fresh-object-in-props` does not.** Its sibling asks whether a
CHILD can skip a render, so a host hands nothing to a component and is left alone. A listener is
attached to a real node, and `<button onclick={() => …}>` is the commonest spelling of this fault —
a rule silent on host elements would be silent on nearly all of it.

**A CALL is never followed, and that is the rule's most important silence.**
`onclick={this.pickRow(row)}` is the recommended answer: `@memoized` caches by its arguments per
instance. `onclick={debounce(this.save, 200)}` has nowhere else to live. Following either would find
the arrow inside and report the fix — the same trap `arrow-fields` is pinned against one level in.
Also silent: a bound method, a field holding an arrow (that is one identity per INSTANCE, and
`arrow-fields` reports it where it is written), a property read, a prop, a module const in this file
or an imported one, `key` and `ref`, and a prop the child declared with `@StableProps`.

**The spread boundary was written down backwards first, and measuring settled it.** The reading that
what the author WROTE stands whichever side of a spread it is on is true of a misspelling and not of
this. Measured both halves: `<button onclick={written} {...{ onclick: fromSpread }} />` clicked runs
ONLY the spread's handler, and `{...{ onclick: undefined }}` after it runs NEITHER. A listener that
never reaches the element cannot be removed and re-added, so only an attribute after the LAST spread
is reported.

Both spellings of an event name are read through the shared `eventTypeOf`, so `on:my-event` is a
handler exactly as `onclick` is.

A warning: the page is right either way, and what it costs is work. The first thing it found was one
in this repo — `apps/docs`'s `DocPage` built its `errorFallback` in the markup, and it is a bound
method now.
