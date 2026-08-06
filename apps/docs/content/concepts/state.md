---
title: State
description: What @state is, what changing it does, and when the page catches up.
section: Core concepts
order: 22
---

# State

**State is the data a component remembers from one moment to the next** — a count, a
name, whether a panel is open. You mark a field with `@state`, and from then on
changing that field updates the page.

```tsx
export class Counter extends Component {
  @state count = 0;
}
```

`count` is now part of this component's state. Change it, and Ramonda calls the
component's `render()` again and updates the page to match.

```demo:Counter
```

## Changing it is the whole update

Assigning to a `@state` field is how you update it — no setter to call, no list of
dependencies to keep in step.

```tsx
this.count = this.count + 1;          // ✓
this.items = [...this.items, next];   // ✓
```

## What a change re-renders

When you change any `@state` field, Ramonda re-runs **this component's** `render()`
— the whole component, not just the line that happened to use the field. It then
updates the page to match what `render()` returns, changing only the parts of the
page that actually differ.

So you never have to wire a field to a piece of the screen. Change the data; the
component describes itself again; Ramonda applies the difference. (Set a field to the
value it already holds and nothing happens — there is nothing to change.)

This is deliberately simple: a component re-renders on any of its own state changes,
full stop. When you need to react to one *specific* value — recompute a total, run a
side effect — that is what [compute](/concepts/compute) and [subscriptions](/concepts/subscriptions)
are for, and those *do* track the individual values they read.

## Replace, don't change in place

To decide whether to re-render, Ramonda compares the old value with the new one. So
you have to give it a **new** value. Pushing into the same array leaves it the same
array, and nothing happens.

```tsx
this.items.push(next);               // ✗ same array — no update
this.items = [...this.items, next];  // ✓ a new array
this.user = { ...this.user, name };  // ✓ a new object
```

In development both are caught and reported — an array as `RMD005`, an object as
`RMD034`, and a nested change is named by its path (`user.address.city`). In the
finished app the check is gone and the change is silent, which is exactly why it
exists.

For something nested, rebuild the path:

```tsx
this.user.address.city = "paris";   // ✗ reported, and nothing renders
this.user = { ...this.user, address: { ...this.user.address, city: "paris" } };  // ✓
```

[`@ramonda/lens`](/lens) does the same thing with less typing:
`this.user = focusOn(this.user).get("address").get("city").set(city)`.

## Don't change state while rendering

`render()` is where a component *describes* what it should look like. It should not
change anything. Changing state during a render asks for another render from inside
the one already running.

```tsx
render() {
  this.seen = true;   // ✗ reported as RMD001
  return <p>…</p>;
}
```

Setting something up? Put it in [`@create`](/concepts/lifecycle). Reacting to
something? Put it in an event handler.

## When the page catches up

Changes are batched. Several assignments in the same moment produce **one** render,
on the next tick.

```tsx
this.a = 1;
this.b = 2;
this.c = 3;
// one render, with the final values
```

In an app this is invisible and exactly what you want. It surfaces in one place: a
test that checks the page immediately after a change.

### Testing a change

```ts
import { render, act } from "@ramonda/testing-library";

const { instance, getByText } = render<Counter>(<Counter />);

act(() => {
  instance.count = 5;
});
expect(getByText("count is 5")).toBeTruthy();
```

`act` makes the change and then lets everything it caused settle — every pending
render and effect — before the next line runs. Without it, the assertion reads the
page as it was *before* the change.

(You can set `instance.count` directly because state is an ordinary field on an
object. A test can put the component straight into a state that would otherwise take
six clicks to reach.)

## After a component is gone

If something changes a component's state after the component has been removed from
the page — a network response that lands once the user has already navigated away —
the change is dropped, not applied. There is no page left to update. In development
this is reported as `RMD008`; the drop happens in production too.

## Fields that aren't state

Not every field needs `@state`. A plain field is fine for anything `render()` never
shows and nothing needs to react to — marking it reactive would only cost memory for
no gain.

`@persist` is an in-between: a plain field whose value is carried over when a
server-rendered page comes alive in the browser, without making it reactive. See
[server rendering](/ssr).

## Why it's this simple (optional)

Ramonda *could* track which field each render read and re-render only when that exact
field changes. It deliberately doesn't. When you change a component's state, you
almost always change what it shows — so the bookkeeping to ask "did this particular
change matter?" usually costs more than re-running one `render()` and updating only
the DOM that differs, which is already cheap. The fine-grained tracking lives where
it earns its keep: [compute](/concepts/compute) and [subscriptions](/concepts/subscriptions).

## Next

- [Props](/concepts/props) — data a component gets from its parent.
- [Lifecycle](/concepts/lifecycle) — where setup goes.
