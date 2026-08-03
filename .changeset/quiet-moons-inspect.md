---
"@ramonda/core": minor
"@ramonda/query": patch
---

`INSPECT`: an instance can tell the devtools panel what it actually holds

The inspector reads `@state`, `@persist`, props and context reads — all four about how a value was
**declared**. A hook that keeps its state in plain fields behind a `@state` counter therefore showed
the counter and nothing else. For `@ramonda/form` the whole panel row was `state: { version: 7 }`
and props that never change: a number going up, and nothing anyone would open the panel to look at.

That shape is what the framework recommends rather than an oversight. `@state` means "serialise me
into the hydration blob", so a hook holding a `Date`, a `File` or a class instance keeps them in
ordinary fields and bumps a counter to schedule the render. `Mutation` does the same with `lastData`.

So the instance answers for itself:

```ts
import { INSPECT } from "@ramonda/core";

class Basket extends Hook {
  @state private version = 0;
  private lines: Line[] = [];

  [INSPECT]() {
    return { lines: this.lines, total: this.total };
  }
}
```

The panel shows it under **Holds**, using the value tree it already had — no new tab, no registry, no
versioned panel API. `Mutation` implements it too.

Three properties worth naming, because they are what keep this from becoming a plugin surface by
accident:

- **Per instance, found by the walk that already visits it.** `registerStore` was removed from the
  devtools bridge because it let a module-level singleton publish itself, advertising the global
  pattern this framework steers away from. This has the opposite property: an instance outside the
  tree cannot contribute, and one that unmounts stops contributing with nothing to deregister.
- **Read-only.** This is what the instance *derived*; writing to a copy would change nothing while
  looking as though it had.
- **A throwing `[INSPECT]()` costs its own row and nothing else.** It is code the framework did not
  write, called during a walk whose job is to diagnose an app that may already be broken.

**It must be a pure read**, and that is a contract rather than a suggestion. The panel calls it on
every commit while it is open on the components tab, so writing state from inside it closes a circle:
the write schedules a render, the render commits, the commit pings the panel, and the panel asks
again. Nothing catches that today — measured — and it turns only while somebody is looking, which is
the worst time for an app to start moving under them.

`Symbol.for`, not `Symbol()`, so two copies of core in one app still agree.
