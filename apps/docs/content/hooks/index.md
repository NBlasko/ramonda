---
title: Hooks
description: Reuse stateful logic across components — state, lifecycle and subscriptions with no element of their own.
section: Hooks
order: 60
---

# Hooks

## The point: reuse stateful logic

Sometimes the interesting part of a component isn't its markup — it's its *behaviour*:
fetching data and tracking whether it has arrived, following the window size, running
a countdown. When several components need the same behaviour, you don't want to copy
it into each one. A **hook** is that behaviour pulled out into one reusable place:
state, lifecycle and subscriptions together, with **no element of its own**.

```tsx
import { Hook, state } from "@ramonda/core";

export class Toggle extends Hook {
  @state open = false;

  toggle() {
    this.open = !this.open;
  }
}
```

Any component uses it with `this.use()`:

```tsx
export class Menu extends Component {
  menu = this.use(Toggle);

  render() {
    return (
      <div>
        <button onClick={this.menu.toggle}>{this.menu.open ? "Close" : "Open"}</button>
        {this.menu.open ? <ul>…</ul> : null}
      </div>
    );
  }
}
```

A `Dialog`, a `Dropdown` and an `Accordion` can all `this.use(Toggle)` — the
open/close logic lives in one class instead of being copied three times. **That reuse
is the whole reason hooks exist.**

## Why not just a component?

A component is always exactly one element, so "state and lifecycle but no markup"
can't be a component — it would still be an element. That is the gap a hook fills.
(If a wrapper element wouldn't bother you, an ordinary component works too — its
default element takes up no space. Reach for a hook when you want *no* element, or
when the goal is to share the behaviour itself.)

## Synchronising with the owner

A hook often needs a value from the component using it — the id to fetch, the size to
paginate by. You pass it as **props**. Pass a **callback**, and it re-runs every
time the owner re-renders, so the hook stays in step with the owner's data.

```tsx
export class Resource<T> extends Hook<{ url: string }> {
  @state data: T | null = null;

  @create
  first() {
    void this.load(this.props.url);
  }

  // Runs when `url` changes, before the render — so the "loading" state is on screen in
  // the same pass rather than one frame later.
  @watchProp((props) => props.url)
  reload(next: string) {
    void this.load(next);
  }

  private async load(url: string) {
    this.data = null;
    const response = await fetch(url);
    // `@destroy` is where a real one would cancel; RMD008 reports a write after unmount.
    this.data = await response.json();
  }
}
```

```tsx
export class UserCard extends Component<{ id: string }> {
  // The callback re-runs when this component re-renders, so `url` follows `id`.
  user = this.use(Resource, (self: UserCard) => ({ url: `/api/users/${self.props.id}` }));

  render() {
    return this.user.data ? <p>{this.user.data.name}</p> : <p>Loading…</p>;
  }
}
```

When the parent passes a new `id`, the callback produces a new `url`, and the
`@watchProp` on it refetches — with no wiring on your part.
Props are tracked **per key** (exactly like [props](/concepts/props)), so the hook
reacts to the prop that changed and not to the others. Authoring them in detail is
[writing a hook](/hooks/writing).

## A hook can use another hook

Hooks compose: a hook can `this.use()` another, building bigger behaviour out of
smaller pieces.

```tsx
export class UserProfile extends Hook<{ id: string }> {
  private user = this.use(Resource, (self: UserProfile) => ({ url: `/api/users/${self.props.id}` }));
  private posts = this.use(Resource, (self: UserProfile) => ({ url: `/api/users/${self.props.id}/posts` }));

  get ready() {
    return this.user.data !== null && this.posts.data !== null;
  }
}
```

The whole chain shares one owner and updates together — when the owner re-renders,
each hook's props are re-evaluated in turn, down through the nested ones.

## When things fire

- **A hook is created the moment `this.use()` runs** — while the owner itself is
  being built, before the owner's own `@create`. Hooks are built in `this.use()`
  order.
- **Its lifecycle is part of the owner's, not a separate pass.** A hook has no
  element, so there's no separate mount for it: its `@create` runs as the owner is
  built, its `@mount` once the owner's DOM is on the page, its `@destroy` when the
  owner is removed. You can watch the exact interleaving in the
  [lifecycle](/concepts/lifecycle) demo.
- **On every re-render of the owner**, each hook's props callback re-runs, in
  `use()` order, and the new values flow into the hook — cascading down through any
  nested hooks.

## The one cost to know

A hook shares its owner's re-rendering: when a hook's state changes, the **owner**
re-renders — the hook has no smaller boundary of its own. That is the one thing a
child component gives you that a hook doesn't. If a hook's state changes very often
and the owner is expensive to draw, a child component may be the better shape.

## A hook can return markup

A hook has no element, but it can still produce markup for the owner to place — useful
when a group of elements needs shared state but no wrapper (inside a `<tr>` or
`<select>`, where an extra element is illegal):

```tsx
class Toolbar extends Hook<{ actions: Action[] }> {
  @state busy = false;

  // Cached by its argument, per instance — so each button keeps one handler across
  // renders instead of getting a fresh closure (which RMD020 reports).
  @memoizedHandler
  runner(id: string) {
    return () => this.run(id);
  }

  buttons() {
    return this.props.actions.map((action) => (
      <button disabled={this.busy} onClick={this.runner(action.id)}>{action.label}</button>
    ));
  }
}

// in the owner:
private toolbar = this.use(Toolbar, () => ({ actions: this.actions }));
render() {
  return <div>{this.toolbar.buttons()}</div>;
}
```

For an actual list of data, use [`list()`](/lists) instead — it brings identity,
which a plain `.map()` like this one doesn't.

## Next

- [Writing a hook](/hooks/writing) — props in depth, and keeping them reactive.
