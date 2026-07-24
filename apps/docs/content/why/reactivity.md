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
[`@compute`](/concepts/compute) and [`@effect`](/concepts/effects) watch exactly the
signals their body reads and re-run only when one of those changes. That is where
precise tracking earns its keep: a derived total that is expensive to recompute, or a
subscription that should only reconnect when its channel changes. Reach for them when
you need to react to one specific value; use plain `@state` for everything else.

## Props and context are per-key

There is one more piece of fine-grained behaviour, and it is free. A component reacts
to the [props](/concepts/props) and [context](/composition/context) keys it actually
reads: read `this.props.name` and the component re-renders when `name` changes, but not
when a sibling prop `title` does. That falls out of how props and context are published
— each key is its own signal — and it is why a plain `<Link href>` that reads none of
the route state doesn't re-render on every navigation.

The division of labour, then: **`@state` is coarse and simple; compute, effects, props
and context are fine-grained where it matters.**
