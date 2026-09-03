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

## A hook's props callback is fine-grained

A hook's props are a callback — `this.use(Chart, () => ({ range: this.range }))` — and the framework
tracks it the way it tracks a `@compute`: the callback is cached on the signals it reads, re-run on a
render where one of them moved, and skipped on a render where none did. [Writing a
hook](/hooks/writing) has the shape; what belongs here is what it means for the model.

**The owner's render and a hook's props are two different questions.** The owner re-renders on any of
its own state, coarsely, as above. Each `use()` on it then asks the narrow one: did anything *this*
bag reads move? Ten hooks on a component and one changed signal is one render and one rebuilt bag.

**A bag of constants is built once** — a callback that reads no signal runs at mount and never again,
and the functions inside it keep their identity. So a hook is not disturbed by its owner re-rendering
for an unrelated reason. (A development build calls it more than that: a second time at mount, to
catch a value that is not a function of state, and once per render to check the cache has not gone
stale. Both results are thrown away — the hook is handed the one bag either way.)

**Inside the hook, each prop is its own signal**, so only the keys whose values actually moved wake
anything — the per-key behaviour context has, one level down.

The trade is not free, and it is worth knowing which way it runs. A skipped call is one boolean; a
re-run detaches, re-tracks and re-attaches the callback's dependency set, which is more work than
calling it unconditionally was. It pays when hooks outnumber the signals that changed, which is the
shape of a hook-heavy component.

The one way this cache can hand a hook a stale value is a bag that reads something no signal backs —
a module-level variable, an object mutated in place — because nothing marks the cache dirty. Under the
[double render](/reference/diagnostics/rmd020) a
development build does, the framework calls the callback anyway and compares, and reports the
difference as [`RMD027`](/reference/diagnostics/rmd027).
Keep what a bag reads in `@state`, a `@compute`, or props.

## Props are coarse like state; context is per-key

It is worth being precise about two things that look alike but aren't.

**Props are coarse, like `@state`.** A component re-renders whenever its parent hands it
a shallowly-different set of [props](/concepts/props) — regardless of which props
`render()` actually reads. A change to a prop the component never touches still
re-renders it. (A signal per prop does exist, and it serves whatever READS that prop under
tracking — a `@compute`, a subscription's `connect`, [a hook's props
callback](#a-hooks-props-callback-is-fine-grained). The component's own render is not one of those:
it re-renders on the props bag, not on the keys it read.) To
skip a prop-driven re-render in the rare case it matters, gate it with
`@ShouldUpdateOnPropsChange`.

**[Context](/composition/context) is per-key** — and this one is free. A consumer reacts
only to the keys it reads: read `ctx.theme` and it re-renders when `theme` changes, but
not when a sibling `accent` does. That falls out of how context is published — each key
is its own signal a consumer subscribes to *directly*, with no parent-to-child pass in
between. It is why a `Navigator` reading only `pathname` doesn't re-render when a query
parameter changes.

The division of labour, then: **`@state` and a component's props are coarse and simple; `@compute`,
`@watchProp`, subscriptions, context and a hook's props callback are fine-grained where it matters.**

## Next

- [No global state](/why/no-globals) — the third of these arguments, and the one the server forces.
- [State](/concepts/state) and [Derived values](/concepts/compute) — the model above, as the two
  decorators you actually write.
- [One per component, or one per item](/concepts/caching) — where the granularity here starts to
  matter in practice.
