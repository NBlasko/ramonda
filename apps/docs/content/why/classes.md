---
title: Classes and decorators
description: Why a component is a class, why there are no fragments or function components, and why lifecycle and state are decorators.
section: Why Ramonda
order: 122
---

# Classes and decorators

## Why a class

A component keeps three things together: the data it remembers, the code that changes
that data, and the code that draws it. A class is a natural home for all three — they
share one `this`, so they can reach each other without being passed around, and the
component has a real identity that survives re-renders. State is just a field; there
is no separate place for it to live and no rules about when you may read it.

It also makes reuse cheap. A component is not an element — it puts on the page exactly what its
`render()` returns — so a component wrapped around another contributes no node of its own, and
composing is free rather than something to ration. And because behaviour lives on a class, the
same class shape carries it without a render at all: that is a [hook](/hooks), and it is how state,
a lifecycle or a subscription is reused between components that share no markup.

## Why no fragment

There is nothing to group with, because **a component is not an element**. What its `render()`
returns goes on the page as it stands — one element, several, or none, whatever the render says — so
there is no wrapper to avoid and no invisible tag to reach for.

```tsx
class Cells extends Component<{ name: string; score: number }> {
  render() {
    return [<td>{this.props.name}</td>, <td>{this.props.score}</td>];
  }
}
```

```html
<tr><td>Ada</td><td>9</td></tr>
```

Two cells, from one component, with nothing between them. It is still a real component
while it does this: it can hold [state](/concepts/state), a
[lifecycle](/concepts/lifecycle) and [hooks](/hooks), and there may be many instances
of it.

So a component covers every case a fragment does, and one it does not: a fragment holds
no state, so a component that exists only to decide what to show is something a fragment
cannot be.

```tsx
class WhenOpen extends Component {
  @state open = false;

  toggle() {
    this.open = !this.open;
  }

  render() {
    return [
      <button onclick={this.toggle}>{this.open ? "hide" : "show"}</button>,
      this.open ? <p>Now you see it.</p> : null,
    ];
  }
}
```

That is a button and, sometimes, a paragraph. Closed, it is a live component with state
and one node; open, two — and either way there is nothing of the framework's around it.

## Why not a function component

A plain function in tag position is refused, and for a different reason than a fragment
was. A function has nothing to construct, no state, and no lifecycle — so as a tag it
names nothing the framework can keep hold of, and `<Thing />` and `Thing()` would mean
the same thing written two ways.

For markup you want to reuse without state, call the function in an expression slot —
`{sideBar()}` — where it reads as the value it is.

TypeScript catches most of this on its own: `JSX.ElementType` is deliberately left undeclared, so
the compiler's default rule applies — a tag must return one `JSX.Element` — and a function
returning several nodes, or anything that is not a node, is refused (`TS2786`). The one it lets
through is a function returning exactly ONE element, which is also the way somebody writes a
function component out of habit. That one is [`RMD011`](/reference/diagnostics/rmd011).

## Why decorators, not reserved method names

Lifecycle and state are decorators — `@state`, `@created`, `@mounted`, `@updated` — rather
than special method names you are expected to implement.

The reason is collisions. If "the method named `mount` runs on mount", then `mount` is
a name you can never use for anything else, on any component, ever — and nothing warns
you when you shadow it by accident. A decorator attaches the behaviour without claiming
the name: `@mounted ready()` runs on mount, and `ready` is still just a method you named.
(`render` is the one exception — it is abstract, so the compiler forces exactly one and
the collision can't happen.)

## Why your methods are already bound

`onclick={this.increment}` works — you don't write a constructor or an arrow-field to
keep `this`. Ramonda binds your methods to the instance when the component is built.

That is not only convenience: a decorator can't be applied to an arrow-function field,
so if the way to keep `this` were an arrow field, you couldn't decorate your handlers.
Binding ordinary methods is what keeps `@memoized` and the event decorators
usable on them.

## Why TC39 decorators

Ramonda uses the standard (TC39 stage-3) decorators — the ones on their way into
JavaScript itself — not the older experimental TypeScript ones. That is why
[installation](/guide/installation) asks your bundler to transpile them: they are new
enough that not every runtime parses them yet, but they are the version with a future.

## Next

- [The reactivity model](/why/reactivity) — the other half of the design: what a class buys is
  identity, and this is what identity buys.
- [Components](/concepts/components) — the same subject as something to write rather than to argue
  about.
- [Every decorator, at a glance](/reference/decorators) — the whole set, once the reasoning has
  landed.
