---
title: One tag, one element
description: The rule the whole framework rests on, and what it rules out.
section: Why Ramonda
order: 121
---

# One tag, one element

Every JSX tag in Ramonda becomes exactly one element on the page. A `<div>` is one
`<div>`; your `<Card />` is one element (its [host](/concepts/host)). Nothing
collapses into several elements, and nothing disappears.

The payoff is simple and large: **you can read the page off the code.** The shape of
your JSX is the shape of the DOM — so when you are looking at a component, you already
know what it produces, without running it or opening devtools. A lot of debugging is
just answering "what is actually on the page?", and this rule answers it for free.

Two things fall out of it, and both are refusals.

## No fragments

Frameworks that let a tag mean "several elements here, or none" need a fragment — an
invisible tag that groups children without being an element. Ramonda has none, because
an invisible-but-grouping tag is exactly the thing that breaks the one-tag-one-element
promise.

When you genuinely need several elements at one spot, `render()` can return an
**array** — those become children of the component's host. And when you reach for a
fragment because you want state and lifecycle *without* an element, that is a
[Hook](/hooks), which is the better fit anyway.

## No function components

A plain function used as a tag is a tag that is not an element — the same problem. So
Ramonda's unit is the **class**, not the function. That has a pleasant consequence:
classes *extend* each other, so reuse doesn't mean nesting, nesting doesn't cost a
wrapper element, and there is no wrapper for a fragment to hide. See
[extending components](/composition/inheritance).

TypeScript rejects a function in tag position; if one reaches the runtime anyway, it
is reported as `RMD011`.

## Isn't the wrapper element a cost?

Rarely. A component with no `@Host` gets an invisible host that takes part in no
layout — see [the host element](/concepts/host) — so adding a component doesn't push
anything around. When even an inert element is illegal (inside a `<table>`, say), you
either name the right element with `@Host` or reach for a Hook.
