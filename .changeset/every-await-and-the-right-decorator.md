---
"@ramonda/check": minor
---

`unguarded-async-lifecycle` asks both of its questions properly

The rule asks WHICH decorator a member carries and WHETHER its awaits are caught. Both were
answered by matching text, and measured on a plant both were wrong — five real faults reported by
nothing.

**Identity.** The decorator was compared as a bare name, so `import { created as onCreate }` and
`@core.created()` both went quiet on the identical fault, and an app's own function called
`created` would have been judged as the framework's. It now reads through `lifecycle-env`'s own
`coreDecorators`, so the two rules cannot answer one question about one decorator two different
ways. The NAMESPACE form was missing there too, and fixing it in the shared reader fixed it for
both.

**The guard.** It was satisfied by any `try` anywhere in the method, or by any property called
`catch`. Four faults hid behind that:

- a `try` around something else entirely, with the fetch below it bare;
- `await a().catch(…)` followed by a second, unhandled `await`;
- `try { await … } finally { … }` — a `finally` runs on the way PAST a rejection and does not stop
  one;
- an await inside a `catch` clause, which its own `try` does not protect.

The question is about the AWAITS, so it is asked of each one: an await is handled when it sits in
the TRY BLOCK of a `try` that has a `catch`, or when what it awaits ends in `.catch(…)`. One
unhandled await is the report, because one is all it takes. A nested function is its own timeline,
the same line `late-request-read` draws.

`async-render` was walked and left alone. `render() { return aPromise; }` is the same crash, and
reading it needs the RETURN TYPE of a call — the dataflow this analyzer refuses, and the type
system refuses that spelling exactly as hard as it refuses `async render()`.
