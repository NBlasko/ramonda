---
"@ramonda/core": minor
---

A production build can now report three faults to a collector, where it previously reported nothing
at all.

Every `diagnose()` call is behind `if (__DEV__)`, so production emits nothing — which is right for
most of what it catches. A mistake in code fires deterministically, on the first render, on the
machine of whoever made it; shipping those would cost every app bytes to be told something
development already said.

Three are not like that. They need the world to go wrong, so they cannot be found before shipping,
and until now nothing said a word about them afterwards either:

- **RMD017** — a deferred hydration that never resumed. The server's markup is still on screen, so
  the page looks finished; the subtree has no listeners and answers nothing.
- **RMD047** — `@memoizedHandler` with an argument it cannot key on. Development throws; a build
  whose affected path nobody ran rebuilds the handler on every render instead, and everything it is
  passed to re-renders with it, for the life of the page.
- **RMD054** — a post-commit callback threw and the failure was swallowed. New code, production
  only: in development the same failure goes to the console with the error object, which is more
  than a record can carry.

It is opt-in with nothing to configure. The record goes to `__RAMONDA_DIAGNOSTICS__` and nowhere
else, so an app that installs no collector behaves exactly as before — including the cost: the
stall watchdog is not even armed without one. The framework sends nothing anywhere; what leaves the
process is the app's decision, made in the collector it wrote.

The records carry what happened and not how to fix it — no `fix` prose, no `data`, no value from the
app, and never the message of a thrown error. Nothing throws to deliver one.

Production core grows 402 bytes gzipped (22,489 → 22,891), and `apps/docs`'s production-build
tripwire now names these three as codes a production bundle may carry.
