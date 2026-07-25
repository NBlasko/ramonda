---
"@ramonda/core": patch
---

**Breaking:** unify hook input on `props`, and rename `@shouldUpdateProps`.

A hook's input is now called **props**, the same word (and idea) as a component's —
read from `this.props`, not `this.options`. One concept, one name. The `HookOptions`
type is now `HookProps`, and a write to a hook's props throws `RMD015` worded around
`props`.

```ts
// before
class Counter extends Hook<CounterOptions> { @state n = this.options.start; }
// after
class Counter extends Hook<CounterProps> { @state n = this.props.start; }
```

The `@shouldUpdateProps` decorator is now **`@shouldUpdateOnPropsChange`**. The old
name read like "should the props update" — but props always update; the decorator
decides whether new props from the parent are *taken up at all* (their signals update
and a render is scheduled). Returning `false` drops the whole update, props included —
this is now documented accurately. It runs only on prop changes, never on the
component's own `@state` writes. It is **components only** and now throws if placed on
a hook (a hook has no parent-driven prop update to gate), instead of silently doing
nothing.
