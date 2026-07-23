---
title: Props
description: Props are read-only, reactive per key, and @watchProp reacts to one changing.
section: Core concepts
order: 33
---

# Props

Props are what a parent passes in. They arrive on `this.props`.

```tsx
export class Greeting extends Component<{ name: string }> {
  render() {
    return <p>Hello {this.props.name}</p>;
  }
}
```

```tsx
<Greeting name="Ada" />
```

The type parameter is the props type. It is not optional in practice — it is what makes the
call site check.

## They are read-only, and they throw

```tsx
this.props.name = "Grace";   // TypeError, RMD004
```

Not a warning. Assigning throws in **every** build, development and production alike, because
the alternative was worse: the write used to land nowhere and vanish, so reading the value back
gave the old one and nothing ever said the assignment had been dropped.

If you need to change it, you have two options and they are the honest ones:

- **Copy it into your own state.** `@state name = this.props.name` in `@create`, then it is
  yours.
- **Ask the parent.** Take a callback prop and call it.

```tsx
export class Row extends Component<{ item: Item; onRemove: (id: string) => void }> {
  render() {
    return <button onClick={() => this.props.onRemove(this.props.item.id)}>remove</button>;
  }
}
```

Hook options work the same way and throw the same way (`RMD015`) — one rule for read-only
inputs, not two.

## Reads are per key

`this.props.name` subscribes to `name`, not to the whole props object. A component that reads
only `name` does not re-render when the parent passes a new `title`.

## Reacting to a prop changing

Sometimes derived state has to be recomputed when a specific prop moves. `@watchProp` does that
**before** the render, so the derived value is already correct when `render()` runs — with no
second pass.

```tsx
@watchProp((props: UserProps) => props.userId)
reload(next: string, previous: string) {
  this.data = undefined;
  void this.fetch(next);
}
```

```demo:WatchPropDemo
```

Three things about it:

**It does not fire on mount.** Only on a change. Use `@create` for the initial case — which is
usually what you want anyway, since the two do different work.

**Type it by annotating the selector's parameter**, as above. That fills in both the props type
and the value type by inference. An explicit generic (`watchProp<UserProps>(...)`) does *not*
work: TypeScript has no partial inference, so naming one drops the other and the method's
parameters fall back to `unknown`.

**A selector, not a string.** It can reach as deep as you like — `p => p.filters[0].value` — and
it is checked by the compiler, which a string could never be.

### `@watchProp` or `@effect`?

Both can respond to a change. They differ in when.

| | runs | costs |
|---|---|---|
| `@watchProp` | before the render | nothing extra |
| `@effect` | after the commit | its write causes another render |

Use `@watchProp` for derived state. Use [`@effect`](/guide/examples) when the response is a side
effect — a subscription, a fetch, a measurement.

## Children

`children` is an ordinary prop.

```tsx
export class Panel extends Component<{ children?: RamondaNode }> {
  render() {
    return <section className="panel">{this.props.children}</section>;
  }
}
```

## Next

- [Lifecycle](/concepts/lifecycle) — `@create`, `@mount`, `@destroy`, and their order.
