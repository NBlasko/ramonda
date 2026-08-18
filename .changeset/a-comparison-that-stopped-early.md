---
"@ramonda/core": patch
---

A comparison that stopped early has not found a difference — RMD022 and RMD027 stop saying it has.

Both read `valueEqual`, which is bounded and answers "different" past its depth or an array's width.
That is the right answer for `resolveStable`, which has to CHOOSE a reference and is safe handing
back a fresh one. It is the wrong answer for a diagnostic, which has to SPEAK: a comparison that
stopped early establishes nothing about the contents it never reached.

Measured, on the shape that made this worth finding: `() => ({ children: <div><h2 /></div> })` is
two levels past the default bound, so **every JSX value handed to a hook** was reported as RMD022 —
*"produced a different value … so the value does not come from state"* — with advice about moving a
`Math.random()` underneath it. Nothing was random and nothing was stale; the callback is called
twice by the check itself, and the two JSX trees compare as "different" for being deeper than two.

- **A bound-limited pair is called REBUILT, not non-deterministic.** The half that is established is
  that two identities differ; the half that is not is anything about the contents. What it costs is
  a deep value that genuinely moves between two calls in one tick: it is now reported through the
  run counter as churn rather than immediately. The usual sources of that are caught anyway and
  separately — randomness and a clock read while a bag is being built are RMD021.
- **RMD027 stays silent when its comparison stopped at the bound.** It tells an app a prop is stale;
  it now does so only where it can show the value moved.
- **A callback that read no signal is exempt from the CHURN half of RMD022.** Nothing can mark that
  cache dirty, so the callback is never called again and the bag it built is the one the hook keeps
  — the only rebuild is the second call the check makes itself. The reference already promised this
  ("a callback that is never invalidated cannot be reported"); now the code does it.
- **The non-determinism half is deliberately NOT exempt.** An untracked bag is where a value that is
  not a function of state does its worst: it is frozen into the cache at mount and served for the
  life of the hook. Exempting it too was the first spelling of this fix, and it silenced two of
  core's own tests — which is why both cases are pinned now.

`valueEqual` gained an optional `Bound` recorder, so one comparison serves both kinds of caller: the
one that must choose still gets "different", and the one that must speak can ask how the answer was
reached.

What a development build costs a props callback is now measured rather than assumed, in
`PropsBagRuns.test.tsx`'s second suite: with `strictRender` on — the default — a bag of constants is
called **twice at mount** (RMD022's comparison) and **once per render of the owner** (RMD027's
freshness probe), and every one of those results is discarded. The hook is handed one bag, and the
functions in it keep one identity, in every build.
