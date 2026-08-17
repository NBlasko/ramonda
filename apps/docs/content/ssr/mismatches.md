---
title: Hydration mismatches
description: When the browser renders something different from the server — what causes it, and the fix.
section: Server rendering
order: 86
---

# Hydration mismatches

A **mismatch** is the browser rendering something different from what the server sent.
Development reports it as **`RMD007`**, naming the component and both values. The
browser wins — the DOM is corrected — so the page ends up right, but you lose the
adoption: those nodes are rebuilt instead of reused, and whatever was attached to them
goes too.

## The usual causes

**A value that is naturally different on each side.**

```tsx
@state now = new Date().toLocaleTimeString(); // ✗ a different time on each side
@state id = Math.random(); // ✗
```

Compute these in `@created({ env: "server" })` and mark them [`@persist`](/ssr/env) so
the client restores rather than recomputes — or use the client-only pattern below.

The blob does not rescue the first spelling, and it is worth knowing why. A field still
holding the primitive its own initializer produced is left out of the page: the browser
runs the same initializer and arrives at the same value, so writing it down would be bytes
for nothing. `Date.now()` is exactly where "the same initializer" stops being the same
value — the browser's call answers later, and there is no server number in the page to
overrule it. Computing in `@created({ env: "server" })` is what puts a real value in the
blob, because a computed value is not the one the initializer produced.

**A value the server EMPTIES does travel.** `this.user = undefined`, where the initializer
gave something else, is carried as a *cleared* field rather than an absent one, so the
browser does not put the default back. That distinction is deliberate: `undefined` cannot
ride in JSON, and without it a signed-out visitor would see the signed-in name.

**Branching on the environment in `render()`.**

```tsx
render() {
  return typeof window === "undefined" ? <Skeleton /> : <Chart />; // ✗
}
```

This *guarantees* divergence. (There is deliberately no `isServer()` helper — calling
it in `render()` is the bug, not the fix.)

**Browser-only APIs read during a render** — `window.innerWidth`, `localStorage`,
`matchMedia` — none exist on the server.

## The pattern for client-only UI

Render something stable, then fill it in once the browser is running:

```tsx
export class Chart extends Component {
  @state isClient = false;

  @mounted({ env: "client" })
  ready() {
    this.isClient = true;
  }

  render() {
    return this.isClient ? <RealChart /> : <Skeleton />;
  }
}
```

The hydrating render still sees `false`, so it matches the server exactly; the switch
happens on the next commit. Two passes is the honest cost of something that genuinely
can't be rendered on the server.

## Text is not a mismatch

`<span>Hello {name}!</span>` is three text pieces in your code but one text node in
the HTML (HTML can't record the boundaries). Ramonda splits it back apart on
hydration — it is handled, and not reported.

## Next

- [Testing](/testing) — including a hydrated page.
