---
title: Rendering lists
description: list() derives identity from the items, so there is no key to write and none to get wrong.
section: Lists
order: 60
---

# Rendering lists

```tsx
render() {
  return <ul>{list({ each: this.tasks, as: TaskRow })}</ul>;
}
```

```demo:ListDemo
```

Click a few of the counters, then reverse the list. Each count stays with its task.

## Why `list()` takes the key away

Other frameworks ask you for a `key`, and the ask is the problem.

**A wrong key is an accident; `.map()` is a decision.** You can teach a decision. You cannot
defend against an accident — a key derived from the index moves with the position instead of the
item, and the symptom is not an error but state appearing on the wrong row. It can be typed
wrong, forgotten, or collide, and a runtime check only catches it if that branch happens to run.

So `list()` does not take a key. **Identity is the item** — its object reference, or its value
for primitives. There is nothing to write, so there is nothing to get wrong.

## It is a function, not a component

`<List>` cannot be a component, because a component is exactly one element and a list needs to
put N siblings into the parent. So it is a plain function call in an expression slot — the same
thing Ramonda already tells you to do when you need vnodes from a function.

That shape is the point. It is an **expression**, so:

```tsx
// A list that may never exist costs nothing until it does.
{this.open ? list({ each: this.results, as: ResultRow }) : null}

// Several lists are several calls, each next to the markup it produces.
<ul>{list({ each: this.todo, as: TaskRow })}</ul>
<ul>{list({ each: this.done, as: TaskRow })}</ul>
```

Nothing is declared, nothing runs unless the call is reached, and `each` is read at the moment
the list is built — so it is always the current array.

## The same item twice

`[tag, tag]` works. Each occurrence gets its own identity, and both rows keep their own state.
Reference identity cannot tell two occurrences apart — and neither could a hand-written key.

## Arrays of primitives

`string[]`, `number[]` — a list of primitives needs no key either, and reaching for one is a
mistake. Identity is the value, and repeated values are told apart by **which occurrence** they
are: `["a", "a", "b"]` gives the first `"a"` and the second `"a"` their own stable rows.

A key here could only be the value, and two equal strings return the same key — exactly the
collision reported as `RMD013`. That is the point turned around: *because* two primitives can be
equal, a key is the wrong tool, not the right one. Nothing a key computes can distinguish two
equal values, because there is nothing to distinguish them by.

That indistinguishability is the one limit worth knowing. If those rows own state and you remove
or reorder a duplicate, the state stays with the **position** of the occurrence, not with "that
particular `"a"`" — equal values are genuinely interchangeable. When you truly need to tell two
of them apart, they are not really primitives: model them as objects with an id, and the id is the
identity.

## `key` as an override

There is exactly one case a list cannot see: objects **re-created** as fresh instances that mean
the same entity — a refetch, a deserialize, a round trip through JSON.

```tsx
list({
  each: this.users,
  key: (user) => user.id,
  as: UserRow,
})
```

Reach for it only then. When you do, collisions **are** checked (`RMD013`), because that is the
one place a mistake is possible again.

The same situation arrives from a different direction whenever you update state immutably:
replacing an item gives it a **new object**, so an unkeyed list sees a new entity and that row
resets. Nothing lands on the wrong row — state is reset, never wrong — but when a row owns state
you care about, `key` is how you say "this is still the same thing".

## What `.map()` costs you

`.map()` still works, and for a static list — a nav bar, a set of tabs you never reorder — it is
fine.

What it costs is identity. Without keys the diff matches children by position, so a list that
reorders or has items removed from the middle moves component state to the wrong row:

```
before   a#0   b#0   c#0        (each with its own state)
remove b, unkeyed
after    a#0   c#0              — c inherited b's node and b's state
```

The DOM looks right. It is the state inside those components that moved.

There is a second, subtler cost. An unkeyed list with **siblings after it** lets the diff claim
the wrong node when the list grows — a component's own chrome can be mistaken for a list item.
Development reports it; `list()` prevents it, because the vnodes come out with identity and the
diff claims by identity rather than by position.

## Next

- [`as` and `render`](/lists/as-and-render) — the two ways to map an item.
