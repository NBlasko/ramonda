---
title: Your first component
description: What a component is, and how to give one state and handle a click — from scratch.
section: Guide
order: 11
---

# Your first component

A component is a piece of a web page you build once and can reuse — a button, a
card, a whole screen. In Ramonda a component is a **class**: a bundle of code that
keeps some data and the things you can do with it together, under one name.

Here is the smallest one that works.

```tsx
import { Component } from "@ramonda/core";

export class Hello extends Component {
  render() {
    return <p>Hello.</p>;
  }
}
```

Two things are doing the work:

- **`extends Component`** — this is what makes the class a Ramonda component.
- **`render()`** — a method that returns what to show. Here it is a paragraph with
  the word *Hello*. The `<p>…</p>` is **JSX**: an HTML-like syntax you write right
  in your code.

## Put it on the page

A component is only a description until you **mount** it — attach it to a real spot
on the page.

```tsx
import { bootstrap } from "@ramonda/core";

bootstrap(<Hello />, document.getElementById("app")!);
```

`document.getElementById("app")` finds the element on the page whose id is `app` —
an empty `<div id="app"></div>` in your HTML. `bootstrap` draws your component
inside it. That is the whole setup: no wrapper to configure, no root API.

And `<Hello />` is how you use a component you wrote — the class name, as a tag.

## Make it remember something

A fixed paragraph is not very interesting. Let's build a button that counts.

For a component to remember something, give it a field marked **`@state`**.

```tsx
import { Component, state } from "@ramonda/core";

export class Counter extends Component {
  @state count = 0;

  increment() {
    this.count = this.count + 1;
  }

  render() {
    return <button onClick={this.increment}>count is {this.count}</button>;
  }
}
```

```demo:Counter
```

Walk through it:

- **`@state count = 0`** — `count` starts at `0`. The `@state` mark is what makes it
  special: change it, and Ramonda updates the page to match.
- **`increment()`** — a method that adds one. `this.count` is how a class refers to
  its own field.
- **`onClick={this.increment}`** — run `increment` when the button is clicked.
- **`{this.count}`** — inside JSX, curly braces drop a value into the text, so the
  button always shows the current number.

Click it: the number goes up. You changed a field, and Ramonda updated the button to
match. You never wrote a line that finds the button and rewrites its text.

## Three things that just worked

**Changing the field is the whole update.** `this.count = this.count + 1` is an
ordinary assignment — no special setter, no function to call. `@state` turns the
field into something Ramonda watches, so assigning to it is enough.

**Changing state updates the page.** Whenever a `@state` field changes, Ramonda
calls this component's `render()` again — the component describes what it should
look like now — and updates the page to match, changing only the parts that
actually differ. The component is not rebuilt; it just describes itself anew.
(Several changes in one go become a single update, so it stays fast — but that is
Ramonda's job, not yours.)

**Handing over the method works.** `onClick={this.increment}` keeps working because
Ramonda ties your methods to the component for you. No extra ceremony to wire up a
click.

## Why a class? (optional)

You can skip this and come back. A component keeps three things together: the data
it remembers, the code that changes that data, and the code that draws it. A class
is a natural home for all three — they share one `this`, so they can reach each
other without being passed around. That is the whole reason Ramonda components are
classes.

## Next

- **[Components](/concepts/components)** — the one rule the framework is built on.
- **[State](/concepts/state)** — what changing a field really does, and when.
