---
"@ramonda/core": minor
---

`@watchProp` on a **hook** now watches the hook's own props, not the owner component's.

A hook shares its owner's runtime, so `runtime.watchProps` holds the component's entries and every hook's in one list — and running that list handed all of them the COMPONENT's `rawProps`. A hook watching its own prop therefore never fired, while its selector was quietly reading a bag it has no relationship to:

```ts
class Loader extends Hook<{ target: string }> {
  @watchProp((p: { target: string }) => p.target)
  reload(next: string) { … }   // never ran — the selector was given the owner's props
}
```

Each entry now records the instance it was declared on, and the runtime reads that instance's props (`WatchPropEntry.owner`). Components are unaffected: they were always given their own props, and still are.

**Breaking only for code that relied on the old reading** — a hook using `@watchProp` to observe the *owner's* props. Pass the value into the hook instead, which is what the props callback is for:

```ts
loader = this.use(Loader, (self: Panel) => ({ target: self.props.userId }));
```
