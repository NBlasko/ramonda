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
lets bugs hide: you would assign, read back the old value, and get no hint why.

If you need to change something a prop gave you, there are two honest ways:

- **Make it your own state.** Copy it in `@create`: `@state name = this.props.name`.
  Now it is yours to change.
- **Ask the parent.** Take a callback prop and call it — the parent owns the data, so
  the parent changes it.

```tsx
export class Row extends Component<{ item: Item; onRemove: (id: string) => void }> {
  remove() {
    this.props.onRemove(this.props.item.id);
  }

  render() {
    return <button onClick={this.remove}>remove</button>;
  }
}
```

## A prop change re-renders the component

When the parent re-renders and passes a new set of props, Ramonda compares it to the
old set. If **any** prop differs, it re-renders the whole component — the same coarse
rule as [state](/concepts/state), and for the same reason: a changed prop almost
always changes what the component shows. It does not matter which props `render()`
actually reads; a change to any of them re-renders.

The comparison is shallow — each prop by `===` — so passing the same values again
costs nothing, and re-renders only when something really changed. Two ways to go
finer when you need to:

- To **skip** the re-render for some prop changes, gate it with
  [`@ShouldUpdateOnPropsChange`](/reference/api) — a rare tool, for a prop that is
  rebuilt every parent render but rarely matters.
- To **react to one specific prop** — recompute a total, refetch when an `id`
  changes — read it inside a [`@compute`](/concepts/compute), a `@watchProp` (below),
  or an [a subscription](/concepts/subscriptions); those *do* track the individual props they
  read, exactly like state.

## Reacting to a specific prop changing

Sometimes you need to *do* something when one prop changes — refetch when an `id`
changes, say. `@watchProp` runs a method just before the render, whenever a prop
you name changes:

```tsx
@watchProp((props) => props.userId)
reload([next]: [string], [previous]: [string]) {
  this.data = undefined;
  void this.fetch(next);
}
```

The values arrive as a **tuple**, one entry per selector, which is why the parameters above are
destructured. Name several selectors and the method runs **once** when any of them changed:

```tsx
@watchProp((props) => props.page, (props) => props.term)
reload(next: [number, string], previous: [number, string]) {
  void this.fetch(next[0], next[1]);
}
```

Not once per changed prop — once per update in which at least one moved. A selector whose value did not
change keeps it in both arrays, so `previous[i] === next[i]` tells you which one moved.

```demo:WatchPropDemo
```

- **It doesn't run on the first render** — only on a later change. Use `@create` for
  the initial load.
- **The selector needs no annotation.** `props` is typed from the class the decorator is
  on, so `props.usreId` is a compile error. (The method's `next` / `previous` do still need
  annotating — a decorator cannot type the signature it decorates, which is a TypeScript
  limitation rather than a choice.)
- **It's a selector function, not a string** — so it can go as deep as
  `p => p.filters[0].value`, and the compiler checks it.
- **On a hook it watches the HOOK's props** — the bag its `this.use()` callback produced,
  not the owner's.

### `@watchProp` or `@updated`? (optional)

Both react to a change; they differ in *when*. `@watchProp` runs **before** the render,
so what it derives is on screen in the same pass. [`@updated`](/concepts/lifecycle) runs
**after** the page updates — the place for reading or correcting the DOM, not for working
out what to show.

There is no post-commit `@watchProp`, and that is a decision rather than a gap:
[the lifecycle page explains it](/concepts/lifecycle). Short version — a post-commit
reaction cannot fold its state write into the render, so the framework would have to start
comparing your props for you, and `@updated` plus one field comparison already does the
job without that.

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
- [The decorator table](/reference/decorators) — `@watchProp` works on a hook; `@ShouldUpdateOnPropsChange` does not.
