---
"@ramonda/core": patch
---

The third `false` a `Listener` promises now has a test

`listen()` documents three ways it returns `false`: on the server, once the owner is gone, and when
the target resolves to nothing. The first two had tests. The third had none, and it is the one a
caller most easily meets — `on` is a function, and a function reaching for a ref before the node
exists, or for an element a branch has not rendered, answers `null`.

The test pins both halves of that promise: the return value is `false`, and the refusal is SILENT,
because a missing target is a state rather than a fault. It fails if the guard returns `true` instead,
and it fails if the refusal throws.

Found by measuring rather than guessing: `base/Listener.ts` had the weakest branch coverage in the
package at 50%, and this was the only unhit branch of the three that can actually be reached.

A `Portal` target that arrives late is tested too, and the page says what it takes

The class doc promises that "a `target` absent at mount and supplied later is placed then, not lost",
and nothing measured it — the guard that makes it true was the only unhit branch on that path.

It holds, and the test says what it depends on: the target has to be read from a SIGNAL. `reconcile`
runs again on `@watchProp(props.children)`, and `children` only gets a new identity when the props
factory re-runs, which it does when a signal it read has moved. A factory that reads none is built
once — so `target: document.getElementById("x")!` with nothing reactive around it places nothing and
then never tries again.

The class doc called that "the uncommon case, worth knowing". The portal page, whose own example uses
exactly that lookup, did not mention it. It does now, with the shape that recovers.

The Firefox and Safari stack shape is parsed by something now

`sourceLocation` reads where a class is defined out of the first construction's stack, so devtools can
open your editor on it. Its parser handles two engine shapes and says so in its own note — V8's
`at new Foo (file:line:col)` and Firefox/Safari's `Foo@file:line:col`. The tests run on V8, so only the
first was ever exercised. The second is not an edge case; it is half the browsers somebody opens
devtools in.

Six more shapes come with it, each one a promise the file already makes: a V8 frame through the same
entry point, a frame that names the class but carries no position (skipped rather than reported as
`line: NaN` at a file an editor cannot open), a stack that names nothing, no stack at all, an
anonymous class, and `definitionOf` asked about something that is not a class.
