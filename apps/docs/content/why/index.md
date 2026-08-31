---
title: Why Ramonda
description: The handful of decisions the rest of the framework follows from.
section: Why Ramonda
order: 120
---

# Why Ramonda

Most of what makes Ramonda feel the way it does comes from a few deliberate decisions.
You don't need any of this to build with it — the rest of the docs are the *how*, and
this section is the *why*, for when you're curious about a choice or weighing whether
the framework fits how you think.

The through-line is one goal: **the code should be readable, and its mistakes should
be loud.** A page you can picture from its source, and a framework that tells you when
something is wrong instead of quietly doing the wrong thing.

- **[Classes and decorators](/why/classes)** — why a component is a class, why there
  are no fragments or function components, and why its lifecycle and state are
  decorators.
- **[The reactivity model](/why/reactivity)** — why changing state re-renders the
  whole component, and where fine-grained tracking lives instead.
- **[No global state](/why/no-globals)** — why there are no module-level stores, and
  what that buys on the server.

## The page is what you wrote

Open devtools on a Ramonda page and you will find your own markup. Every element there
is an element you wrote; every element you wrote is there. The framework contributes no
elements of its own — no wrappers, no placeholders. A great deal of debugging is
answering "what is actually on the page?", and this answers it from the source: you can
read a component and know what it produces without running it.

It holds because [a component is not an element](/why/classes#why-no-fragment) — a
component puts what its `render()` returns on the page, one element or several or none
— so nothing has to be wrapped in order to be grouped, and there is nothing left for
the framework to add. The one exception is a server-rendered page, which carries HTML
comments until it hydrates and then does not; [renderToString and
hydrateRoot](/ssr/render) describes them.

## The diagnostics are the other half

Nearly every bug this framework has had produced a *wrong result*, not an error —
state on the wrong row, a click doing nothing, a subtree rendering where no one can
see it. None of them threw. So Ramonda ships [development-time
checks](/reference/diagnostics) that name the mistake and say what to do instead; in
production they compile away to nothing. That "make it loud" instinct shapes the
framework as much as any single rule.
