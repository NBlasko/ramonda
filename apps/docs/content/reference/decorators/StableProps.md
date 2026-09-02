---
title: StableProps
description: Declares which props are values rather than identities, so a rebuilt literal stops counting as a change.
section: Reference
order: 133
---

# `@StableProps`

Names the props that are **values** rather than references. The framework then hands back the same
identity for as long as their contents are equal, and the call site can write the plain literal.

```tsx
@StableProps("key")
class Lookup extends Hook<{ key: readonly unknown[] }> {}

class UserCard extends Component<{ id: number }> {
  private user = this.use(Lookup, (self: UserCard) => ({ key: ["user", self.props.id] }));
}
```

Without it, `["user", 7]` built again is a **new array**, so it is a changed prop every time the
callback runs: a `@compute` reading it recomputes, a `@watchProp` on it fires, a subscription
reconnects. Measured across three renders of the owner, a compute reading a rebuilt array runs three
times where one reading a scalar runs once.

## Why the receiver declares it, and not the call site

That a query key is a value — `["user", 7]` built again is the same question — is the **hook's**
knowledge. Declaring it once settles every call site instead of asking each one to know.

It takes **names**, not a predicate, and that is deliberate:
[`@ShouldUpdateOnPropsChange`](/reference/decorators/ShouldUpdateOnPropsChange) takes a rule an app
can get wrong in the direction that matters — a component that stops rendering when it should. The
worst a wrong name here can do is fail to type-check.

**The names are checked** against the props of whatever it is on, with no type argument to write:
`@StableProps("kye")` is a compile error that names `"kye"`.

## Components too, by the same sentence

A component's props arrive from the parent's JSX, where an object literal is a fresh reference every
render. `<Panel filter={{ q }} />` hands the child a changed prop every time. Declaring `filter` a
value settles it there exactly as it settles a hook's.

## A context says it at its creation

`createContext` hands back a class rather than a declaration site, so a Provider takes the same
declaration where the context is made:

```tsx
const [ConfProvider, ConfConsumer] = createContext(
  { conf: { dense: false } },
  { stableProps: ["conf"] },
);
```

It is the same list on the same class, and the context can do one thing the decorator cannot: its
keys are the default value's keys, so a name that is not one of them is refused rather than ignored.

## What it refuses, and what it will not cover

**No names at all.** `@StableProps()` is a compile error.

**Functions.** Two closures with the same body are not equal by any comparison that is safe to make,
so a listed function prop is left exactly as it came and [`RMD022`](/reference/diagnostics/rmd022)
still reports it. Pass a bound method, or [`@memoized`](/reference/decorators/memoized) when it has
to be built per argument.

**Two declarations on one class** are merged rather than refused — the decorator names a set, and
the union is the unambiguous reading — but it is reported as
[`RMD046`](/reference/diagnostics/rmd046) so the awkward spelling does not stay.

## What it costs

A contents comparison to a **bounded depth** on every prop update, per listed name. A deeply nested
literal gets a fresh reference rather than a wrong one, which is the safe direction.

## Next

- [Props](/concepts/props) — why every prop is a signal.
- [Context](/composition/context) — the `stableProps` option, in place.
- [Writing a hook](/hooks/writing) — where the declaration usually belongs.
