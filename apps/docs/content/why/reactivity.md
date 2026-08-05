---
title: The reactivity model
description: Why changing state re-renders the whole component, and where fine-grained tracking lives.
section: Why Ramonda
order: 123
---

# The reactivity model

When you change a `@state` field, Ramonda re-runs the **whole component's** `render()`
and updates the page to match. It does *not* track which field each line of your render
read and update only the part that used the changed value. This page is why that's a
deliberate choice, not a missing feature.

## Coarse on purpose

Ramonda could track every read in `render()` and update surgically. It doesn't, because
the bookkeeping rarely pays. When you change a component's state, you almost always
change what it shows — that is usually *why* you changed it — so asking "did this
particular field matter to this particular line?" mostly answers "yes". Re-running one
`render()` and patching only the DOM that actually differs is already cheap, and it is
simpler to hold in your head: a component re-renders on any of its own state changes,
full stop, with no dependency graph to track.

So the mental model stays small. You don't wire fields to pieces of the screen, and you
don't get caught out by a change that "should" have updated something but didn't
because a tracker missed a read.

## Where fine-grained tracking *does* live

The framework does track individual reads — just not in `render()`.
[`@compute`](/concepts/compute) and [a subscription](/concepts/subscriptions) watch exactly the
signals their body reads and re-run only when one of those changes. That is where
precise tracking earns its keep: a derived total that is expensive to recompute, or a
subscription that should only reconnect when its channel changes. Reach for them when
you need to react to one specific value; use plain `@state` for everything else.

## Props are coarse like state; context is per-key

It is worth being precise about two things that look alike but aren't.

**Props are coarse, like `@state`.** A component re-renders whenever its parent hands it
a shallowly-different set of [props](/concepts/props) — regardless of which props
`render()` actually reads. A change to a prop the component never touches still
re-renders it. (A signal per prop does exist, and it serves whatever READS that prop under
tracking — a `@compute`, a subscription's `connect`, a hook's props callback. The component's
own render is not one of those: it re-renders on the props bag, not on the keys it read.) To
skip a prop-driven re-render in the rare case it matters, gate it with
`@shouldUpdateOnPropsChange`.

**[Context](/composition/context) is per-key** — and this one is free. A consumer reacts
only to the keys it reads: read `ctx.theme` and it re-renders when `theme` changes, but
not when a sibling `accent` does. That falls out of how context is published — each key
is its own signal a consumer subscribes to *directly*, with no parent-to-child pass in
between. It is why a `Navigator` reading only `pathname` doesn't re-render when a query
parameter changes.

The division of labour, then: **`@state` and props are coarse and simple; `@compute`,
`@watchProp`, subscriptions and context are fine-grained where it matters.**
