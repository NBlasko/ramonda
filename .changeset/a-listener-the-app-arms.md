---
"@ramonda/core": minor
"@ramonda/check": patch
---

`Listener` — a listener the app arms and disarms, which the framework still removes

`@onWindow` and `@onDocument` attach for the owner's whole life. That is right for most listeners and
wrong for the ones this exists for: a `keydown` while a dialog is open, a `pointermove` while a drag
is happening, a `scroll` armed after something loads.

Written by hand, each of those is an `addEventListener` and a `removeEventListener` that have to
agree with each other AND with teardown — three places for one fact, which is exactly where the leak
lives and why `listener-added-by-hand` reports it.

```tsx
private escape = this.use(Listener, () => ({
  on: "document",
  type: "keydown",
  run: this.onKey,
}));

@mounted open() { this.escape.listen(); }
close() { this.escape.stop(); }
```

One hook instance is one listener, and teardown removes it. Nothing to remember, no handler
reference to keep in step. It is deliberately the shape `Interval` and `Timeout` already have.

**The target is NAMED rather than handed over.** `window` does not exist on the server, so a prop
holding the value would be evaluated where there is nothing to evaluate. `"window"` and `"document"`
are resolved at arm time; a function is the third form, for a target the app owns
(`() => this.box.current`), and a ref that is not attached yet answers `null` so the listener refuses
rather than attaching to nothing. `@onWindow` resolves its target the same way and for the same
reason.

**What is read WHERE.** The type, the target and the options are captured when it arms, because
`removeEventListener` matches on the triple of type, function identity and capture — a `type` re-read
at teardown after a signal changed it would ask the DOM to remove a listener that was never added
and silently leave the real one attached. `run` is read when the event FIRES, so a handler chosen by
a signal takes effect without re-arming. That is the same split `Timeout` and `Interval` keep.

**`Armed` is extracted, not copied.** Knowing whether arming can be made safe right now is forty
lines of measured reasoning — including two earlier attempts that asked which SIDE the render was on
and both had a window where a timer armed in the SSR process and fired there. A second copy of that
for the listener would have been the drift this codebase keeps paying for, so `Timeout`, `Interval`
and `Listener` now share one answer.

`listener-added-by-hand`'s advice named this as a gap in the framework. It now names the hook.
