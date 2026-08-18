---
"@ramonda/core": patch
---

A diagnostic compares to the end — RMD020, RMD022 and RMD027 stop reading a bound as a finding.

`valueEqual` is bounded at a depth of two and at fifty entries of an array, and past either it
answers "different". That is the right answer for `resolveStable`, which runs per declared prop per
render and only has to CHOOSE a reference: a fresh one is correct, merely not optimal. Three
diagnostics were reading that same answer as evidence, and each of them says something to an app.

Two of them were saying it falsely:

- **A JSX value in a props bag was reported as "does not come from state".** A two-level subtree —
  `() => ({ children: <div><h2 /></div> })`, which is what a `Portal` is handed — is past the depth,
  so RMD022 called two identical trees non-deterministic and put advice about `Math.random()`
  underneath. RMD020 did the same for an element attribute holding a nested object.
- **RMD020's churn wording asserted contents it had not compared.** "Builds a new object with the
  same contents, hold it in a `@compute`" is the wrong sentence for a value that is genuinely not a
  function of state, and there is no run counter in front of RMD020 to soften it.

And two were silent where they should have spoken, both once an array passed fifty entries — the
width cap answers "different" without comparing a single element:

- **RMD027 stopped reporting a stale wide array**: `rows` held in a plain field, reassigned with no
  signal write, is the shape its own documentation is written about, and a table with 51 rows was
  past the cap.
- **RMD022 could not report a wide array that churned for real.** The cross-run gate needs the value
  to compare EQUAL across runs to count a run; the cap made that impossible, so neither half of the
  check could ever speak.

`valueEqualThorough` is the entry point for a caller that reports — depth 24, width 1000, the same
recursion. Measured per comparison: a two-level JSX tree **1.31 ns → 3.15 ns**, a sixty-row array
**0.55 ns → 34.88 ns**, where the cheap answer was the cap bailing out without looking. It is paid in
a development build, under the double render, on a pair already known to differ by reference.

Five cases are pinned now, in `PropsStability.test.tsx` and `RenderStability.test.tsx`. The one that
would have caught the JSX report is the plainest of them: mount a component with a JSX bag and assert
nothing is reported.

What a development build costs a props callback is measured rather than assumed, in
`PropsBagRuns.test.tsx`'s second suite: with `strictRender` on — the default, and off in core's own
test setup — a bag of constants is called **twice at mount** (RMD022's comparison) and **once per
render of the owner** (RMD027's freshness probe), and every one of those results is discarded. The
hook is handed one bag, and the functions in it keep one identity, in every build.
