---
title: Components
description: What a component is, how you use one, and what it puts on the page.
section: Core concepts
order: 20
---

# Components

A component is a small class that draws one piece of the page and knows how to react
to what happens on it. You write one by extending `Component` and giving it a
`render()`.

```tsx
export class Card extends Component {
  render() {
    return <div className="card">…</div>;
  }
}
```

You build a whole app out of components: small ones — a button, an avatar — combined
into bigger ones — a card, a page.

## Using a component

Write its name as a tag:

```tsx
<Card />
```

A component can take input from whoever uses it (see [props](/concepts/props)) and
keep its own memory (see [state](/concepts/state)).

## What ends up on the page

A component puts exactly what its `render()` returns on the page, and nothing else.
There is no wrapper around it.

```tsx
export class Card extends Component {
  render() {
    return <div className="card">Hello</div>;
  }
}
```

`<Card />` gives you `<div class="card">Hello</div>`. One element, because that is what
the render says — not because a component has to be one.

That is the promise worth holding on to: **the page is what you wrote.** Every element
in the DOM is an element you can point at in your JSX, and every element in your JSX is
in the DOM. Once you can picture the page from the code, a lot of guesswork goes away.

## Showing one thing or another

Return `null` to draw nothing. A `? :` (ternary) picks between two things to show.

```tsx
render() {
  return (
    <div>
      {this.loading ? <Spinner /> : <p>Ready.</p>}
      <p>Always here.</p>
    </div>
  );
}
```

Prefer a ternary to `&&` for showing and hiding: `{count && <p>…</p>}` prints a
stray `0` when `count` is `0`, because a leftover number draws itself.

## Returning several elements

Sometimes a component needs to place several elements at its spot rather than wrap
them in a container. `render()` may return an array:

```tsx
class Cells extends Component<{ name: string; score: number }> {
  render() {
    return [<td>{this.props.name}</td>, <td>{this.props.score}</td>];
  }
}

class Table extends Component {
  render() {
    return (
      <table>
        <tbody>
          <tr>
            <Cells name="Ada" score={9} />
          </tr>
        </tbody>
      </table>
    );
  }
}
```

Used inside a row, that is two cells and nothing between them:

```html
<tr><td>Ada</td><td>9</td></tr>
```

This is the case a wrapper cannot serve at all: a `<tr>` accepts `<td>` and nothing
else, so an element around the cells is not just untidy — the HTML parser moves it out
of the table and the row falls apart.

## Reusing a component

You reuse a component by **using** it — inside another component's render, with props:

```tsx
class Cell extends Component<{ value: string }> {
  render() {
    return <td>{this.props.value}</td>;
  }
}

class NameCell extends Component<{ contact: { name: string } }> {
  render() {
    return <Cell value={this.props.contact.name} />;
  }
}
```

The outer component adds **nothing of its own to the page**: what lands in the DOM is
exactly what `Cell`'s render returned. So a component that exists only to fill in a prop,
or to put a context or a boundary around something, is free — there is no wrapper element
to pay for and no `<div>` to work around.

That is reuse of *markup*. Reusing **behaviour** — state, a lifecycle, a subscription —
is a different question with its own answer: a [hook](/hooks), which is a class exactly
like a component with everything except a `render()`.

## Why there is no fragment (optional)

Other frameworks need a *fragment* — an invisible tag that groups children without
being an element — and Ramonda has none, because a component already does the job. A
component may return several elements, or one, or nothing, and it can hold state and a
lifecycle while doing it. A fragment cannot: it takes no state, so a flag that decides
what to show has to live somewhere else.

A plain function as a tag is refused, and that is a different refusal. A function has
no state, no lifecycle and nothing to construct, so as a tag it names nothing the
framework can keep. TypeScript rejects it; if one reaches the runtime it is reported as
`RMD011`. When you want markup you reuse, call the function in an expression slot —
`{sideBar()}` — where it reads as the value it is.

## Next

- [JSX](/concepts/jsx) — the HTML-like syntax, up close.
- [Refs](/concepts/refs) — reaching an element you rendered.
