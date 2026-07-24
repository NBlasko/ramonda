---
title: Props
description: Props are the input a component gets from its parent — read-only, and reactive.
section: Core concepts
order: 23
---

# Props

**Props are the input a component gets from whoever uses it.** The parent passes them
in like attributes, and they arrive on `this.props`.

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

The `<{ name: string }>` after `Component` describes the props this component expects,
so using it without `name`, or with the wrong type, is caught as you type.

## Props are read-only

A component may read its props but not change them — they belong to the parent.
Assigning to one throws:

```tsx
this.props.name = "Grace";   // ✗ throws (RMD004)
```

It throws in every build, on purpose. The alternative — quietly ignoring the write —
let bugs hide: you would assign, read back the old value, and get no hint why.

If you need to change something a prop gave you, there are two honest ways:

- **Make it your own state.** Copy it in `@create`: `@state name = this.props.name`.
  Now it is yours to change.
- **Ask the parent.** Take a callback prop and call it — the parent owns the data, so
  the parent changes it.

```tsx
export class Row extends Component<{ item: Item; onRemove: (id: string) => void }> {
  render() {
    return <button onClick={() => this.props.onRemove(this.props.item.id)}>remove</button>;
  }
}
```

## A component reacts to the props it reads

Reading `this.props.name` ties this component to `name`: if the parent later passes a
new `name`, the component re-renders to match. A prop it never reads — say `title` —
does not trigger a re-render when it changes. You get this for free; there is nothing
to declare.

## Reacting to a specific prop changing

Sometimes you need to *do* something when one prop changes — refetch when an `id`
changes, say. `@watchProp` runs a method just before the render, whenever the prop
you name changes:

```tsx
@watchProp((props: UserProps) => props.userId)
reload(next: string, previous: string) {
  this.data = undefined;
  void this.fetch(next);
}
```

```demo:WatchPropDemo
```

- **It doesn't run on the first render** — only on a later change. Use `@create` for
  the initial load.
- **Type it by annotating the selector's parameter** (`props: UserProps` above); that
  infers the rest. An explicit `watchProp<UserProps>(...)` does *not* work.
- **It's a selector function, not a string** — so it can go as deep as
  `p => p.filters[0].value`, and the compiler checks it.

### `@watchProp` or `@effect`? (optional)

Both react to a change; they differ in *when*. `@watchProp` runs **before** the
render, so derived state is ready with no extra pass. [`@effect`](/concepts/effects)
runs **after** the page updates — the place for side effects like a fetch, a
subscription, or a measurement, not for working out what to show.

## `children` is a prop

The content between a component's tags arrives as the `children` prop:

```tsx
export class Panel extends Component<{ children?: RamondaNode }> {
  render() {
    return <section className="panel">{this.props.children}</section>;
  }
}
```

## Next

- [Lifecycle](/concepts/lifecycle) — `@create`, `@mount`, `@destroy`, and their order.
