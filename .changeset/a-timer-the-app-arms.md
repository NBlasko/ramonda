---
"@ramonda/core": minor
---

`Timeout` and `Interval` — a scheduled call the app starts, and the framework still owns.

`@interval` and `@timeout` answer one question: run this on a clock for as long as I am on the page.
They answer it in one line and they are unchanged. These answer a different one — **start now, and stop
when I say** — which no decorator can express, because a decorator fires relative to MOUNT.

```tsx
private removal = this.use(Timeout, () => ({ run: this.dropRow }));

leave() {
  this.leaving = true;
  this.removal.start(3000);
}

stay() {
  this.removal.stop();
}
```

**`run` belongs to the hook, `ms` to the start**, split by how long each one lives. An API that takes
the body per call reads as "order as many as you like" while behaving as "only the last survives" — and
it invites a fresh function at every call site, where nothing then says whether that function captured
a local or reads `this.props`. Measured, because the difference is invisible: `() => this.props.id`
reads the id when it FIRES, so after a reorder it is a different row's, while a captured argument is
frozen at start. Declared once, there is nothing to capture.

`run` is read **when the call fires**, so a `run` chosen by a signal takes effect on a call already
waiting, without restarting the countdown — and it cancels nothing. Cancelling is `stop()`, always
explicit: the props callback re-runs whenever any signal it read changes, including one read for
something else, so a timer that cancelled itself on that would be one an unrelated re-render could
kill. `ms` is read at `start`, because a delay is a property of that start — a retry's backoff differs
every time — and that keeps a signal out of it entirely.

**One instance is one timer.** Starting a running one restarts it, so `stop()` never asks which and no
handle travels back to the caller. Two timers means two hooks. The verb is in the NAME rather than at
the call site, which is why this is two hooks and not one: with only `start()`, the name is the only
place left to say whether it repeats.

**Why hooks rather than making the decorators call-armed.** A decorator cannot add a member TypeScript
can see. Measured: a decorator that replaces the method with a function carrying `stop` gives
`TS2339: Property 'stop' does not exist on type '() => void'` — a decorator may change what runs, never
the declared type.

**Nothing starts during a server render**, and `start` returns `false` rather than throwing. Quietly,
because that is what makes it safe to call from shared code: the same `@created` runs on both sides, so
a throw would force every call site to branch on which side it is — the one thing the hydration rules
tell an author not to do. It returns `false` once the owner is gone too, which is a second leak and not
the same one: `@destroyed` has already run, so nothing would ever clear that timer. A caller that has
promised somebody an answer must check it — measured on the first caller, where a silent refusal left a
view transition holding a snapshot over the page for ever.

**A delay is refused in every build**, not only in development, because it arrives at runtime:
`start(this.props.backoffMs)` may be handed `undefined` by an API, and guarded, development would throw
while production called `setTimeout(fn, NaN)` and coerced it to `0` — a retry storm in the only build
where it matters. That is the shape `useCommon`'s `RMD055` throw and `@compute`'s `assertNoParameters`
are both unguarded for. The ceiling is `2147483647` ms, about 24.8 days, because `setTimeout` truncates
anything larger and fires it at once.

Twenty-two tests plus three in a production run, and the planted ones earned their place. Clearing the
handle after the body instead of before wipes the one a re-starting body just installed, and every other
test passed under both orderings; putting the delay check back under `__DEV__` fails all three
production tests while all twenty-two development ones pass.

`RMD006` and `RMD008` name these in their fix text now, beside the decorators.
