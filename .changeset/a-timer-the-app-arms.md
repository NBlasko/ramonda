---
"@ramonda/core": minor
---

`Timer` — a timer the app arms, and the framework still owns.

`@interval` and `@timeout` answer one question: run this on a clock for as long as I am on the page.
They answer it in one line and they are unchanged. `Timer` answers a different one — **start now, and
stop when I say** — which no decorator can express, because a decorator fires relative to MOUNT.

```tsx
private removal = this.use(Timer);

leave() {
  this.leaving = true;
  this.removal.after(3000, () => this.props.onRemove(this.props.id));
}

stay() {
  this.removal.stop();
}
```

**One hook instance is one timer.** So `stop()` never asks which, and no handle travels back to the
caller. Arming an armed timer restarts it — for `every` that is the only correct answer, since two
intervals on one name would both keep firing and nothing could name either, and `after` follows the
same rule rather than having a second one.

**Why a hook rather than making the decorators call-armed.** A decorator cannot add a member
TypeScript can see. Measured: a decorator that replaces the method with a function carrying `stop`
gives `TS2339: Property 'stop' does not exist on type '() => void'` — a decorator may change what
runs, never the declared type. So the stop has to belong to an object, and returning a canceller from
the arming call would put the bookkeeping back at the call site, which is the boilerplate these
decorators exist to delete.

**Arming returns whether it armed**, and a delay is refused in **every build**. Both came out of the
review rather than the writing, and both are about the same thing — a value that arrives at runtime.
A refusal is otherwise indistinguishable from a timer that has not fired yet: the first caller hands
the promise `after` settles straight to `document.startViewTransition`, so a silent refusal left the
browser holding a snapshot over a page nobody could click. And the delay check is unguarded because
`after(this.props.backoffMs, run)` may be handed `undefined` by an API — guarded, development would
throw while production called `setTimeout(fn, NaN)`, which the spec coerces to `0`, so a retry fires
on the next tick and storms in the only build where it matters. That is the shape `useCommon`'s
`RMD055` throw and `@compute`'s `assertNoParameters` are both unguarded for. The ceiling is
`2147483647` ms, about 24.8 days, because `setTimeout` truncates anything larger and fires it at
once — late becoming immediate, which no caller asks for.

**Nothing is armed during a server render.** A timer could not fire before the response is sent, and
the request would be held open by a handle nobody can reach. `after` and `every` return quietly there
rather than throwing, and that is what makes them safe to call from shared code: the same `@created`
runs on both sides, so a throw would force every call site to branch on which side it is — the one
thing the hydration rules tell an author not to do. The side is read off the owner's runtime, not off
a module flag and not off `typeof window`, for the reason `Portal` reads it there.

**Arming after teardown does nothing either**, which is a second leak and not the same one:
`@destroyed` has already run, so nothing would ever clear that timer. A late `await` landing in a
handler is exactly how it happens.

Twenty tests plus three in a production run, and seven of them were planted: teardown, the server,
arming after teardown, re-arming, the ordering inside `after`, a throwing call leaving an armed timer
alone, and the delay check surviving a production build. Two earned their place outright. Clearing the
handle AFTER the body instead of before wipes the one a re-arming body just installed, so the timer
keeps running and teardown finds nothing to clear — **every other test passed under both orderings.**
And putting the delay check back under `__DEV__` fails all three production tests while all twenty
development ones still pass, which is the whole argument for it being unguarded.

`RMD006` and `RMD008` now name it in their fix text, beside the decorators.
