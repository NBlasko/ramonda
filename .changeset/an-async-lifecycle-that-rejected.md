---
"@ramonda/core": minor
"@ramonda/check": minor
---

An `async` lifecycle that rejects now says so — at build time and at runtime.

**The finding.** An `async` `@created` or `@mounted` that rejects is not caught by an error
boundary, reports nothing, and becomes an unhandled rejection. Measured against a boundary that
catches the synchronous version of the same throw:

| lifecycle | boundary catches | reported |
|---|---|---|
| sync `@mounted` throws | yes — the fallback renders | — |
| `async @mounted` rejects | **no** — the page renders as though it succeeded | **nothing** |

`@mounted async load()` fetching data is a documented pattern, so this is the commonest async path
there is: the fetch fails, the `@state` it meant to fill stays at its initial value, the empty state
shows, and nothing anywhere says the method ran and failed.

**The boundary not catching it is deliberate and has not changed.** The rejection arrives at an
arbitrary later moment, when the page is already interactive and there is no render left to fail;
replacing what the reader is using with a fallback then is the worse outcome. What changed is the
silence.

- **`RMD059`** reports it at runtime, naming the component, the member and the phase. The handler
  is attached to a separate branch and the original promise is returned untouched, so the server's
  work drain sees exactly what it saw before and nothing is swallowed — the rejection is still
  unhandled, which is honest, and now it arrives with an explanation.
- **`unguarded-async-lifecycle`** reports it before it ships: an `async` lifecycle that awaits with
  no `try` and no `.catch` anywhere in its body. Zero reports across every app and package here.

The rule is deliberately coarse about what counts as handled — any `try`, any `.catch`. Whether the
`try` actually covers the awaits is a control-flow question, and being wrong about it means
reporting a method that handles its own failure, which is the one kind of mistake this package
treats as fatal. A method that never awaits is not reported either: it can only throw
synchronously, and that the lifecycle runner already catches.

The fix both of them point at is the same, and it is not a bigger boundary: catch it where it
happens and put the failure in `@state`, which is the only way to tell the reader anything.
