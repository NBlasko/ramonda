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

- **Make it your own state.** Copy it in `@created`: `@state name = this.props.name`.
  Now it is yours to change.
- **Ask the parent.** Take a callback prop and call it — the parent owns the data, so
  the parent changes it.

```tsx
export class Row extends Component<{ item: Item; onRemove: (id: string) => void }> {
  remove() {
    this.props.onRemove(this.props.item.id);
  }

  render() {
    return <button onclick={this.remove}>remove</button>;
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
costs nothing, and re-renders only when something really changed. Three ways to go
finer when you need to:

- To pass an **object or an array written in the JSX**, declare it a value with
  `@StableProps` — see below.
- To **ignore a change that really happened**, gate it with
  [`@ShouldUpdateOnPropsChange`](/reference/api). That is a narrower thing than it
  sounds, and narrower than it used to be: a prop merely REBUILT with the same
  contents is `@StableProps`' job above, and this one is for the case where the
  contents genuinely moved and you still do not want the update. Refusing it
  **drops it whole**: the props are not taken either, so a later render caused by
  this component's own state still shows the props it last accepted, until the
  parent sends an update the rule agrees to.

  It takes a predicate rather than names, which is why it is the last thing to
  reach for: a rule can be wrong in the direction that matters — a component that
  stops rendering when it should — and nothing will report it.
- To **react to one specific prop** — recompute a total, refetch when an `id`
  changes — read it inside a [`@compute`](/concepts/compute), a `@watchProp` (below),
  or an [a subscription](/concepts/subscriptions); those *do* track the individual props they
  read, exactly like state.

## A prop that is a value

An object written in the JSX is a **new object every render**, so a shallow comparison sees a
change every time and the child re-renders forever:

```tsx
<Panel filter={{ q: "open" }} />
```

The component that RECEIVES it can say that the prop is a value rather than an identity, and the
framework then hands it back the object it already had for as long as the contents match:

```tsx
@StableProps("filter")
export class Panel extends Component<{ filter: { q: string } }> {}
```

Now the call site writes the plain literal and the child is not re-rendered at all. Contents that
really move still reach it — a declaration is not a freeze.

It takes as many names as you like — `@StableProps("filter", "flags")`. A
[context](/composition/context) says the same thing where it is created, because a Provider is a
class the framework hands you rather than one you wrote: `createContext(defaults, { stableProps:
["conf"] })`.

**Why the receiving component declares it, and not the call site.** Whether a prop is a value or an
identity is that component's knowledge, and declaring it once settles every call site. It is also
why this takes NAMES rather than a rule: `@ShouldUpdateOnPropsChange` takes a predicate, and a
predicate is a thing an app can get wrong in the direction that matters — a component that stops
rendering when it should. The worst a wrong name here can do is fail to type-check.

**A function is not settled by it.** Two closures with the same body are not equal by any
comparison that is safe to make, so a listed function prop is left exactly as it came. Pass a bound
method — `onSelect={this.select}` — or `@memoized` when it has to be built per row.

**Children are a prop, and they can be declared too.** A rendered node is built during the render,
so anything a parent writes between the tags is a fresh value every time — a component given
children re-renders whenever its parent does, even when the children are a piece of static text.
The same goes for a node handed over as a prop, `header={<Header />}`. Both are named like any
other prop:

```tsx
@StableProps("children", "header")
export class Panel extends Component<{ header?: unknown; children?: unknown }> {}
```

A slot that takes the component CLASS rather than a rendered node — `view={Header}` — costs nothing
to begin with, because a class is the same reference for the life of the module.

**Contents are compared to a bounded depth**, so a deeply nested literal gets a fresh reference
rather than a wrong one, which is the safe direction: it re-renders, exactly as it does today.

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

- **It doesn't run on the first render** — only on a later change. Use `@created` for
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

- [Lifecycle](/concepts/lifecycle) — `@created`, `@mounted`, `@destroyed`, and their order.
- [The decorator table](/reference/decorators) — `@watchProp` works on a hook; `@ShouldUpdateOnPropsChange` does not.
