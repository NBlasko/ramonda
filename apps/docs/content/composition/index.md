---
title: Composition
description: Six ways components fit together — sharing a value down a subtree, wrapping markup you did not write, and reaching the page outside your own.
section: Composition
order: 50
---

# Composition

One component works. These are the six things you need once several of them have to fit together.

**A component is not an element**, and that is what makes all of this cheap: what lands on the page
is what a `render()` returns, so a component wrapped around another contributes no node of its own.
Composing is free rather than something to ration.

## Passing something down

- **[Context](/composition/context)** — a value every component in a subtree can read, without
  threading it through the ones in between. Per-key, so a consumer wakes only for what it reads.
- **[Children](/composition/children)** — a component that wraps markup it did not write, and where
  that markup reads its context from.

## When something goes wrong, or arrives late

- **[Error boundaries](/composition/error-boundaries)** — catch a failure from part of the page and
  keep the rest working.
- **[Lazy loading](/composition/lazy)** — a heavy component in its own chunk, fetched the first time
  it is shown.

## Putting markup somewhere else

- **[Portal](/composition/portal)** — a subtree rendered into a DOM element elsewhere — a modal
  root, a toast layer — while its state and context stay where you wrote it.
- **[Reaching the document](/composition/document)** — the page outside your own subtree: a class on
  `<body>`, the `<head>`, and which of the two to reach for.

## What is NOT here

**Inheritance.** Reuse is composition: a component is reused by being used, and behaviour that has
to be shared between components with no markup in common is a [hook](/hooks).

## Next

- [Context](/composition/context) — the one most apps need first.
- [Hooks](/hooks) — reusing behaviour rather than markup.
