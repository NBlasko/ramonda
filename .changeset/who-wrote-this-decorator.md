---
"@ramonda/check": minor
---

Both decorator rules answer "who wrote this decorator" the same way

`duplicate-decorators` resolved it. `decorator-that-adds-nothing`, which sits on the same line, read
the written IDENTIFIER — and measured on a plant that was wrong three ways at once:

- `import { state as reactive }` beside `@persist` went quiet on the identical pair;
- `@core.state` beside `@core.persist` went quiet too;
- an app's OWN decorator called `persist` beside core's `@state` was **reported** — somebody else's
  code, told one of its lines does nothing, for the framework's rule.

It reads through `lifecycle-env`'s `coreDecorators` now. Two rules answering one question about one
decorator two different ways is the drift a shared reader exists to prevent, and one of the two is
always the wrong one.

**And the namespace half was missing from the resolver itself.** `@core.Host` twice on one class
was invisible to `duplicate-decorators` while the aliased form was reported. `coreExportName` reads
a namespace access directly now — that spelling is the one place the module's own name for a
binding is written down verbatim at the call site. It had been patched inline in `lifecycle-env` an
hour earlier; that copy is gone.
