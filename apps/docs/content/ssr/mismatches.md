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

Compute these in `@create({ env: "server" })` and mark them [`@persist`](/ssr/env) so
the client restores rather than recomputes — or use the client-only pattern below.

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

  @mount({ env: "client" })
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
