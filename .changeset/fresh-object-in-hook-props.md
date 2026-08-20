---
"@ramonda/check": minor
---

New rule: `fresh-object-in-hook-props` — an object or array literal written into a hook's props,
which is where a context value is written.

`fresh-object-in-props` reports the literal a PARENT writes in JSX. This is the same fault one door
along: `this.use(ThemeProvider, () => ({ conf: { dense: true }, tick: this.tick }))`. Every prop is
a signal, so a rebuilt object is a changed prop — and for a Provider that reaches every consumer of
the key, however far down the tree it sits.

Measured in `ContextValueIdentity.test.tsx`, counting a consumer that reads only `conf` while a
DIFFERENT key of the same provider moves three times:

| the callback | renders after mount | after three changes |
|---|---|---|
| `() => ({ conf: { dense: true }, tick: this.tick })` | 1 | **4** |
| the same, with `@StableProps("conf")` on the provider | 1 | **1** |
| `() => ({ conf: { dense: true }, tick: 0 })` — reads nothing | 1 | **1** |

The third row is the shape of the rule. The props callback is cached on the signals it read, so one
that reads none is called once at mount and the literal inside it keeps one identity for the life of
the component — which is not a fault, and is what `apps/playground-core` relies on for its query
defaults. So the rule asks for two things and needs both: a literal among the props, and a reactive
read that can make the callback run again — `@state`, a `@compute`, anything under `this.props`, or
a field holding another hook. All four are measured; a read it cannot classify is silence.

Two more silences: a key the hook DECLARED with `@StableProps` (a Provider takes the declaration on
a subclass, since `createContext` hands back a class), and any hook reached through a `.d.ts` —
declaration files carry no decorators, so `@StableProps` on an installed hook is invisible from
outside its own source, and a rule that cannot tell a missing declaration from an invisible one may
not report either.
