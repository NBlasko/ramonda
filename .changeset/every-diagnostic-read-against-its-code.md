---
"@ramonda/core": patch
"@ramonda/check": minor
---

Every diagnostic's prose read against the code that raises it. Six were saying something the code
does not do, and one of them was reporting working code.

**`RMD039` had it backwards.** It said `class` "is passed through to the element as an unknown
attribute and the styling it names never applies". `class` has been renamed to `className` before
the vnode is built since the first commit, so the element is styled and the page is fine — measured:
`<p class="lead">` renders `class="lead"`. What the rename cannot save is the two cases the
diagnostic never mentioned, and the report now says which one it found:

- `className` on the same element wins, and the `class` is **dropped** without a word.
- A COMPONENT is renamed too, so `<Panel class="muted" />` arrives as `className` — a `class` prop
  that component declared reads `undefined` on every render, for ever.

`@ramonda/check`'s `class-instead-of-classname` repeated the false claim three times and skipped
components on the reasoning that "what it does with it is its own business". **It now reports a
component as well**, and `ClassInsteadOfClassNameIssue` carries `onComponent` and `dropped` so the
report can say which of the three it is.

**`RMD021` promised a clock it has never watched.** The guard patches `Math.random`,
`crypto.randomUUID` and `crypto.getRandomValues`, and deliberately nothing else — the platform reads
the clock behind your back, so a guard on it reports calls the app never made. The title said "A
clock or a random number" and the fix was half about clocks. It now names the randomness it watches,
the FOUR phases it fires in (render, `@compute`, a `@memoizedHandler` builder, a hook's props
callback — the prose named two), and where the clock is actually caught. `clock-read-while-rendering`
says the same from its side, because the client-only clock gap is the reason that rule exists.

**`RMD010` named a parent it deliberately does not report.** "list elements" were in its list of
parents that accept only specific children; `<ul>`, `<ol>`, `<dl>` and `<p>` are exactly the ones it
stays quiet about, because the parser leaves an unknown element inside them alone.

**`RMD033` gave one outcome for three.** A function is dropped, a bigint or a cycle never reaches the
blob, and a `Date` or a `Map` SURVIVES as a string or a plain object — so the field is not missing,
it is the wrong type, and the first method call on it throws.

**`RMD003` never mentioned its own opt-out** — `createContext(value, { optional: true })`, for a
context whose default is the answer rather than a stand-in.

**`RMD015` and `RMD004` called a hook's props "options"**, a word that appears nowhere else in the
API, the docs, or the `TypeError` the write throws.

Three stale docstrings went with them: a props write "is always a no-op" (it throws in every build),
`RMD023` needing "at least one component" (it asks any unkeyed element for a key), and the two above.
A fix text is prose nothing asserts, so `DiagnosticProse.test.tsx` now pins the claims that can be:
the rename styles the element, `Date.now()` raises no `RMD021`, and a default host in a `<ul>` is
silent while one in a `<table>` is not.
