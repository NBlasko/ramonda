---
title: Core concepts
description: What a component is, where a value lives, and when the page catches up — the eleven pages that cover Ramonda's whole model.
section: Core concepts
order: 19
---

# Core concepts

Everything a component is made of. A reader who has finished these can build a page without looking
anything else up.

## What you write

- **[Components](/concepts/components)** — a class with a `render()`. What it puts on the page is
  what that returns, which is why a component is not an element.
- **[JSX](/concepts/jsx)** — the markup syntax: values, attributes, children, and what is refused.

## Where a value lives

- **[State](/concepts/state)** — a field the render reads, so changing it redraws.
- **[Props](/concepts/props)** — what a parent hands down, read-only and reactive.
- **[Derived values](/concepts/compute)** — worked out from the two above, cached until they move.
- **[One per component, or one per item](/concepts/caching)** — `@compute` or `@memoized`, and the
  question that decides.

## When things happen

- **[Events](/concepts/events)** — handlers on your own elements, and decorators for the window and
  the document.
- **[Lifecycle](/concepts/lifecycle)** — created, mounted, updated, destroyed, and what belongs in
  each.
- **[Timers](/concepts/timers)** — a clock or a delay, cleared for you.
- **[Subscriptions](/concepts/subscriptions)** — a store, a socket, an observer, and the cleanup
  that comes with it.

## Reaching the page itself

- **[Refs](/concepts/refs)** — the real element, to focus, measure, or hand to a library.

## Next

- [Components](/concepts/components) — if you are starting here.
- [Composition](/composition) — putting components together once each one works.
- [Every decorator, at a glance](/reference/decorators) — the table, once the names are familiar.
