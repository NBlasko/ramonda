---
title: Lifecycle
description: Run code when a component is created, shown on the page, and removed.
section: Lifecycle and subscriptions
order: 30
---

# Lifecycle

A component has three moments in its life: it is **created**, it is **shown** on the
page, and later it is **removed**. You can run code at each one by putting a decorator
on a method.

```tsx
export class Panel extends Component {
  @create
  init() {} // being created

  @mount
  ready() {} // now on the page

  @destroy
  bye() {} // being removed
}
```

```demo:LifecycleLog
```

## `@create` — being built

Runs while the component is being created, *before* its element exists. This is where
you set up from your props and seed your state.

Two things are deliberately off-limits here:

- **There is no element yet.** Don't try to find or measure this component's DOM in
  `@create` — it isn't on the page. That is what `@mount` is for.
- **Keep it to setup.** Read props, set state, compute. Leave subscriptions, focus,
  and measurements for `@mount`.

## `@mount` — on the page

Runs once the component's DOM is in the document. This is where you reach the real
page: focus an input, measure an element, hand a node to a chart library.

Children mount before their parent, so by the time a parent's `@mount` runs, its
children are already on the page.

## `@updated` — after an update is committed

`@mount` runs once. `@updated` runs after **every commit after that**, with the new
DOM already in place — so it is where you read or correct the page once it has
changed.

```tsx
class Row extends Component<{ selected: boolean }> {
  private scrolled = false;
  private element!: HTMLElement;

  @updated
  keepVisible() {
    if (!this.props.selected || this.scrolled) return;
    this.scrolled = true;
    this.element.scrollIntoView({ block: "nearest" });
  }
}
```

**Why it has to exist.** You cannot do this where the state changed: updates are
batched, so when your handler returns the DOM has not been touched yet. And not every
update *has* a place of yours to stand in — a parent re-renders you with new props, a
context value changes, a hook you use writes its state. Your code never ran, so only
the framework can tell you that you just committed.

**It has no dependencies, no previous values, and no cleanup**, and each of those is
deliberate:

- It fires on **every** update, so guard the body if the body is expensive. A
  `getBoundingClientRect` forces a layout; one field comparison in front of it pays
  for itself many times over.
- The `if` that wants previous props — `if (previous.id !== this.props.id)` — is
  reconstructing what changed, and that is [`@watchProp`](/concepts/props)'s job,
  done *before* the render. The `if` that belongs here asks something else: **is the
  DOM already how I want it?**
- Cleanup belongs to `@destroy`; a subscription belongs to
  [your own decorator](/hooks/own-decorators).

So the division is: **reacting to a value → `@watchProp`. Touching the DOM afterwards
→ `@updated`.**

**There is no post-commit `@watchProp`,** and knowing why keeps you from looking for it.
It is the obvious sugar — "run this method after the commit, but only when
`props.selectedId` changed" — and three things are wrong with it:

- **It would be strictly narrower than `@updated`.** It sees props, and props only. Not
  the state of a hook you use (the list came from a query), not a context value, not any
  other cause of a commit. The cases that need the DOM *are* usually those.
- **Its write could not fold.** `@watchProp` runs inside the build, so state it writes
  lands in the same render — measured, no extra pass. A post-commit version writes after
  the DOM exists, which schedules another render, which rebuilds the props bag, which runs
  the selector again. The framework would have to compare values to stop that, and
  comparing a prop for you is exactly what Ramonda does not do.
- **The `if` it would replace is not the framework's to write.** `@watchProp` answers
  *what changed*; the guard that belongs in an `@updated` body answers *is the DOM already
  how I want it* — and only you know that.

So the pair above is the whole story, and one field comparison is the price of the
post-commit case.

**Children before parents**, so a parent measuring its own subtree finds it updated.
It runs after this commit's `@mount`s and subscriptions, and **never on the server** —
there is no layout and no paint there to correct.

Writing state here schedules another render, and that is the point for the
measure-store-render pattern. Guard it, or it loops (reported as `RMD009` in
development).

## `@destroy` — being removed

Runs when the component is removed. Your state and computed values are still readable,
so you can clean up based on them. It runs exactly once — even for a component that
failed while building — so write it to tolerate a half-set-up instance.

## Server vs. browser: `env`

`@create`, `@mount` and `@destroy` can be limited to one side with `env`:

```tsx
@create({ env: "client" })
startPolling() {} // only in the browser

@create({ env: "server" })
stampBuildTime() {} // only during a server render

@create
init() {} // both — the default
```

| | server render | browser |
|---|---|---|
| `"shared"` (default) | yes | yes |
| `"client"` | no | yes |
| `"server"` | yes | no |

Anything that touches `window`, starts a timer, or opens a connection belongs on the
client. (Effects — the next page — are always client-only, so you rarely need `env`
for them.)

### The method also receives `env`

When a method needs to know which side it is on — rather than skip a side entirely —
it is handed `env` as an argument, `"client"` or `"server"`:

```tsx
@mount
setup(env: RenderEnv) {
  if (env === "server") return; // nothing to wire up during a server render
  this.observer = new IntersectionObserver(() => {});
}
```

Prefer this to a `typeof window` check: a server render runs under a DOM shim where
`window` exists, so that check cannot tell the two sides apart — `env` always can.
The parameter is optional; a method that ignores it is unaffected. More in
[client / server / shared](/ssr/env).

## Timers are lifecycle too

`@interval(ms)` and `@timeout(ms)` start when the component mounts and stop when it is
removed — no cleanup to remember:

```tsx
@state now = "";

@interval(1000)
tick() {
  this.now = new Date().toLocaleTimeString();
}
```

```demo:IntervalClock
```

See [timers](/concepts/timers).

## Next

- [Subscriptions](/concepts/subscriptions) — reacting to state, with cleanup.
- [The host element](/concepts/host) — the element `@mount` is talking about.
- [The decorator table](/reference/decorators) — where each phase runs, and whether a hook gets it.
