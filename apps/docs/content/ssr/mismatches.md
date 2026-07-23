---
title: Hydration mismatches
description: RMD007, what causes it, and the two-pass pattern for client-only UI.
section: Server rendering
order: 96
---

# Hydration mismatches

A mismatch is the client rendering something different from what the server sent. Development
reports it as **`RMD007`**, naming the component and both values.

The client wins — the DOM is patched — so the page is correct afterwards. What you lose is the
adoption: nodes get replaced instead of reused, and whatever was attached to them goes with them.

## The usual causes

**A value that differs by nature.**

```tsx
@state now = new Date().toLocaleTimeString();   // ✗ different on each side
@state id = Math.random();                      // ✗
```

Both produce one value on the server and another on the client. Compute them in
`@create({ env: "server" })` and mark them [`@persist`](/ssr/env) so the client restores rather
than recomputes.

**Branching on the environment in `render()`.**

```tsx
render() {
  return typeof window === "undefined" ? <Skeleton /> : <Chart />;   // ✗
}
```

This *guarantees* divergence. The framework deliberately offers no `isServer()` helper, because
calling it in `render()` is the bug rather than the fix.

**Browser-only APIs read during a render.** `window.innerWidth`, `localStorage`,
`matchMedia` — none exist on the server.

## The prescribed pattern for client-only UI

Render something stable, then fill it in once the client is running:

```tsx
export class Chart extends Component {
  @state isClient = false;

  @mount({ env: "client" })
  ready() {
    this.isClient = true;
  }

  render() {
    return this.isClient ? <RealChart /> : <Skeleton />;
  }
}
```

The hydrating render still sees `false`, so it matches the server exactly. The switch happens on
the commit after.

Two passes is the cost, and it is the honest one: something genuinely cannot be rendered on the
server, so it is rendered afterwards.

```demo:IntervalClock
```

That clock uses the same pattern — its first value is read in `@mount({ env: "client" })`, not in
a field initializer, because a time rendered on the server would not match the time here.

## Text is not a mismatch

`<span>Hello {name}!</span>` is three text children on the client and one node in the HTML,
because HTML cannot record the boundaries. That is handled — hydration splits the run apart — and
it is not reported.

## Assert state, not just markup

When you are checking hydration behaviour in a test, **read the state**, not only the DOM.

That is a lesson from a real one: removing the router's URL re-read left every test green,
because the first render was correct anyway — the route context had captured its options before
the state blob was restored. The markup was right while the state was wrong, and only the state
showed it.

## Next

- [Testing](/testing) — including testing a hydrated page.
