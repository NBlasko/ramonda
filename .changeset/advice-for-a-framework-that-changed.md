---
"@ramonda/core": patch
"@ramonda/check": patch
"@ramonda/form": patch
"@ramonda/router": patch
---

Nothing a reader is shown names a decorator this framework no longer has

The first release without `@Host` was about to ship text that still sends people looking for it.

**RMD041's advice described a feature that was removed**, and the docs page for it described a
different one that never existed. The runtime message blamed `@onElement` on a component whose host
element was missing; the reference page blamed a selector that matched nothing, and there has never
been a selector. Both now say what is actually true: a listener decorator resolves its target when its
effect runs on mount, `@onWindow` and `@onDocument` are the only two and they answer with `window` and
`document`, so reaching this means an effect ran where there is no DOM at all.

**`@ramonda/form` shipped a `@Host` example in its published types** — the first example a reader of
`Field` meets, using a decorator that is gone. It writes its own `<label>` now, which is what the
framework asks for.

The same sweep over every surface a reader can see: five more places in `@ramonda/core`'s published
`.d.ts`, a `flushSync` error naming `@onElement` among the things that might be writing state, and
ten spots in `@ramonda/check` and `@ramonda/router`. One was not prose: core's DOM-nesting check
still stepped around a `RAMONDA-HOST` parent, which no longer exists, so the branch is gone.

`@ramonda/check` no longer knows the name either. Its `CLIENT_ONLY_DECORATORS` entry for
`@onElement` is gone, and so is the reason for keeping it: the fixtures declare their OWN stub of
`@ramonda/core`, so the decorator there was a specimen rather than a migration being tested. The stub
stops declaring it, the fixture that used it uses `@onWindow` — a decorator that exists, and the same
thing to the rule under test — and `fixtures/host-listeners/`, seven uses of it that no test loads at
all, is deleted.

**And the same question asked of every diagnostic, not just this one.** Comparing all 53 shipped
messages against their reference entries turned up no other contradiction — RMD041 was the outlier —
but three entries had gone stale in the same way a rename does. RMD047's heading still said "memoized
handler"; `@memoized` takes any method, and its own shipped title already says "member". RMD021's
heading said the same thing, and so did a runtime message from the purity guard and the label
`@ramonda/check` prints for the decorator. RMD006 predates the `Timeout` and `Interval` hooks and only
offered the mount-armed decorators.

Nothing checks that a diagnostic's `fix` and its reference entry agree, which is how RMD041 came to
have two different wrong explanations of itself. A gate for that is not in here — it is worth
deciding on separately.
