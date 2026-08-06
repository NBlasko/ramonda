---
"@ramonda/devtools": minor
---

Diagnostics from every package land in the Logs tab, `installDiagnostics` shares the channel, and a
bundler no longer throws the whole package away

**A bundler was entitled to delete this package, and did.** It declared `"sideEffects": false` while
its entry registers `<ramonda-devtools>` — so the claim was false, and acting on it is correct
behaviour. Measured: bundling a bare `import` of the built entry with esbuild produced **0 bytes**. Not
a missing registration; the whole package, gone, because the package said there was nothing to keep. It
now declares `"sideEffects": ["./dist/index.js"]`, which is what is true.

Nothing caught it because nothing bundles this package that way — Vite's dev server does not
tree-shake, and a production build usually leaves the panel out on purpose. It would have surfaced as
"the devtools do not appear" in one configuration with nothing to blame. There is now a test that asks
a real bundler rather than restating the field, with `@ramonda/lens` as its control: lens genuinely has
no side effects, says so, and must be erased to nothing — otherwise a harness that had stopped
tree-shaking at all would report this package as correct while proving nothing.

Audited the rest with the same oracle: `@ramonda/query`, `@ramonda/router`, `@ramonda/form` and
`@ramonda/lens` do no import-time work, so their `"sideEffects": false` is honest, and `@ramonda/core`
correctly declares no such field at all — its logger attaches a `ramonda:devtools-ready` listener at
module scope.

Importing `@ramonda/devtools` now collects [diagnostic records](https://ramonda.pages.dev/reference/diagnostics#capturing-them)
from any package that reports them and puts each one in the `LOGS` tab, with its `fix` and the values
its message named. Nothing to wire up: the same import that registers the panel subscribes the bridge.

`RML*` from `@ramonda/lens` is the first reporter to arrive this way, and it arrives without
`@ramonda/lens` depending on this package or the other way round — the contract is a record shape and
a global sink, not a module.

**`installDiagnostics(sink)`** is the way for anything else to read the same stream, and it returns the
uninstall:

```tsx
import { installDiagnostics } from "@ramonda/devtools";

const stop = installDiagnostics((record) => {
  if (record.severity === "error") myCollector.alert(record);
});
```

It exists because the sink is one function on `globalThis`, and one function has one owner: assigning
it — which the reference page shows, so somebody will — replaces whoever was there, normally this
panel's bridge, and the Logs tab then quietly stops filling. Subscribing shares it. Several
subscribers, one sink, no ordering to agree on.

Three failure modes the shape was chosen for, each with a test:

- **A hot reload** re-runs the module and subscribes again. A bridge that wrapped whatever it found
  would chain onto its own previous generation, so every record would arrive once per save. The hub is
  recognisable as ours and reused, and the bridge replaces its own predecessor.
- **A foreign sink installed first** is chained rather than dropped. Something was already listening,
  and losing it silently is the class of fault this whole channel exists to make visible.
- **The sink being taken** cannot be noticed from a hook, because overwriting a global calls nothing.
  The panel sends one record round the loop when it mounts and says so in the console if it does not
  come back. That check reads the hub it installed rather than the global it is testing — the first
  version went through `installDiagnostics`, which *repaired* a replaced global by wrapping it and then
  reported success. A check that fixes what it measures always passes.

A record from a package this one has never heard of renders like any other, and there is a test that
holds it there: a `scope` of `acme/store`, no `fix`, no `data`, and the row is still complete. The
moment the panel needs more than the five fields the protocol guarantees, a library that is not
Ramonda's has to pretend to be one to use the channel.

`debug` records are not forwarded to the tab, which has no level control — a collector that wants them
subscribes.

Because the protocol is a shape rather than a module, every package declares it, and copies drift.
Two tests hold the join that no type can:

- **The declarations are compared.** This package's suite reads the record out of each reporter's
  source and fails when the field names or the severities disagree — drift that is otherwise silent in
  both directions, and that TypeScript cannot catch because the copies never meet in one program.
- **A real reporter is driven end to end.** `@ramonda/lens` is a devDependency now, for this and
  nothing else: a genuine `focusOn(state).at(9).get("title").set("x")` has to arrive as a rendered row
  in the Logs tab, with `[RML004]`, the `WARNING` colour, and `{ scope, path, index, length }` in its
  data. Also covered: an `error` severity reaching the badge, the two faults that throw arriving as
  records anyway, a panel that opens *after* the reports being handed the history, and a write that
  lands saying nothing at all.

  Both halves of this protocol can pass while the whole is broken, which is why the whole is tested.
  Verified it can fail: mapping `warn` to the wrong word breaks two cases, and a bridge that stops
  forwarding breaks six.

  The dependency runs one way only — `@ramonda/lens` knows nothing about this package, which is the
  property the design exists to keep — and it is a devDependency, so nothing reaches a consumer's
  install and no lens code enters this package's bundle.
