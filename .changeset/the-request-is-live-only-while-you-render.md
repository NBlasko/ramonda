---
"@ramonda/core": minor
"@ramonda/check": minor
---

The request is live only while you render, and now two things say so.

**The question first, because the answer is the reassuring half.** Can `requestContext()` hand one
visitor another visitor's data? No — and it is not the variable that saves it. The scope IS one
module-level value shared by every request the server is handling at once. What makes it safe is the
WINDOW: `renderToString` installs it, mounts synchronously, and clears it in a `finally` before its
first `await`. Node runs that section to completion, so no second request can be inside it.

Measured rather than argued, and now pinned by
`packages/core/src/__tests__/hydration/RequestConcurrency.test.tsx`: ten interleaved renders each
read their own user, two concurrent ones never see each other's. Delete the one line that clears the
scope and both requests read `["read:bob","read:bob"]` — Ada's component serving Bob's user. Three of
the tests fail on it. There was no test for any of this before.

**The defect that came out of it: breaking the rule was silent.** A read below the first `await`
throws, but the throw does not always arrive anywhere. Measured with no `try`/`catch`, which is what
an app actually writes: `renderToString` **resolves normally**, the page is served, `console.error`
is called **zero** times, and the component is quietly missing its value. The rejection goes into the
server's work drain and is swallowed — exactly what `RequestScope.read`'s docstring already says
happens in build mode, which is why `guardBuild` records IN ADDITION to throwing. Server mode had no
counterpart.

**`RMD053`** is that counterpart. `requireScope()` now reports before it throws, so the record
survives the swallowed rejection, and the throw's message says the third way to arrive: a read below
a yield, not only a call at module top level. Deduped on the FIELD rather than the component, and not
by preference — by the time it fires the render is over and `renderingOwner()` is already empty.
Production is unchanged: every `diagnose` call site in the package is behind `__DEV__`.

**`ramonda-check` reports the same read from the source**, as `findings["late-request-read"]`, a
WARNING under this repository's rule for a new rule. Zero reports across all three apps; verified not to be
silently dead by planting a real late read into a real component in `playground-ssr` and watching the
CLI name it through the repo's own source alias.

The two are not redundant and not symmetric, which is the same shape the duplicate-decorator work
settled. The static rule speaks before anything runs, including for a branch nobody has opened.
`RMD053` catches the read that left the static rule's reach — through a variable, a helper, or a
build with no types.

What the rule judges, each half planted and caught:

- **A late read through a same-scope local** (`const ctx = requestContext()` above the await, used
  below) is reported. One hop in one function is a declaration, not the general dataflow this
  analyzer refuses.
- **`for await`** raises the flag too. It is a `ForOfStatement` carrying an await token, so the
  check for an `AwaitExpression` never sees it.
- **A read inside the await's own operand** — `await requestContext().get(key)` — is NOT late. The
  operand is evaluated before the suspension, so the walk descends into an await before raising its
  flag.
- **A nested callback starts a clean timeline.** Whether it runs before or after the enclosing yield
  is dataflow, and guessing would report `items.map(…)` called synchronously above the await.
- **One mistake gets one report.** A context TAKEN below the await is the failure — that line
  throws, so the line reading through the local never runs. Only a local taken before the yield is
  followed, or the reader would be sent to the second of two reports, on dead code.
- **Identity is the import specifier, not the name.** An app is entitled to its own function called
  `requestContext`. This is stricter than the sibling `document` rule on purpose: nobody writes
  `const document = …` and reaches for `.body`, but a same-named local here is plausible.

Two fixture gaps were found the same way and are worth recording, because both tests passed while
proving nothing: the "app's own helper" case had been written as `requestContext2`, so the NAME check
rejected it and the identity check was never reached; and nothing covered a read inside an await's
operand, so reversing the walk order went unnoticed.
