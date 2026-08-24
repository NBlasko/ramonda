---
title: The page is what you wrote
description: Every element in the DOM is one you can point at in your JSX, and the framework adds none of its own.
section: Why Ramonda
order: 121
---

# The page is what you wrote

Open devtools on a Ramonda page and you will find your own markup. Every element there
is an element you wrote; every element you wrote is there. The framework contributes
nothing of its own — no wrappers, no placeholders, no marker nodes.

That is worth more than it sounds. A great deal of debugging is answering "what is
actually on the page?", and this answers it from the source. You can read a component
and know what it produces without running it.

## A component is not an element

A component puts what its `render()` returns on the page. One element, several, or
none — whatever the render says.

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

Two cells, from one component, with nothing between them. The component is still a
real component while it does this: it can hold [state](/concepts/state), a
[lifecycle](/concepts/lifecycle) and [hooks](/hooks), and there may be many instances
of it.

## Which means there is no fragment

Other frameworks need one — an invisible tag whose job is to group children without
being an element. A component covers every case a fragment does, and one it does not: a
fragment holds no state, so a component that exists only to decide what to show is
something a fragment cannot be.

```tsx
class WhenOpen extends Component<{ children?: RamondaNode }> {
  @state open = false;

  toggle() {
    this.open = !this.open;
  }

  render() {
    return [
      <button onclick={this.toggle}>{this.open ? "hide" : "show"}</button>,
      this.open ? this.props.children : null,
    ];
  }
}
```

That is a button and, sometimes, whatever it was given. Closed, it is a live component
with state and no nodes at all.

## And no function components

A plain function in tag position is refused, and for a different reason than a fragment
was. A function has nothing to construct, no state, and no lifecycle — so as a tag it
names nothing the framework can keep hold of, and `<Thing />` and `Thing()` would mean
the same thing written two ways.

Ramonda's unit is the **class**, and that has a pleasant consequence: classes *extend*
each other, so reuse does not mean nesting and nesting costs nothing. See
[extending components](/composition/inheritance).

For markup you want to reuse without state, call the function in an expression slot —
`{sideBar()}` — where it reads as the value it is. TypeScript rejects a function as a
tag; if one reaches the runtime it is reported as `RMD011`.

## What the server sends is not quite this

A server-rendered page carries one thing your JSX does not: a pair of HTML comments
around each component's markup, with its state on the opening one.

```html
<tr><!--c7 {"state":{"open":true}}--><td>Ada</td><td>9</td><!--/c7--></tr>
```

They are there because served markup is text. A component owns a run of nodes, and
nothing in plain HTML says where one component's run ends and the next one's begins —
so the server says it, in comments, because a comment is the only thing the HTML parser
leaves alone inside a `<tr>`.

Hydration reads them, uses them, and takes them out. By the time the page is
interactive it holds exactly what a client-side render would have produced, which is
the page you wrote. See [renderToString and hydrateRoot](/ssr/render).
