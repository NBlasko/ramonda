---
title: Conditional and filtered
description: A list that only sometimes exists, and one whose items are a filter — bound to a derived array, not rebuilt with .map().
section: Lists
order: 63
---

# Conditional and filtered lists

A list is rarely the whole array. It appears only when a panel is open, or it is the part of the
data that matched a filter. Both are the case `list()` was shaped for, because it is an
**expression**, not a component.

```demo:FilteredList
```

Star a row, then narrow the filter. Every row that stays keeps its own star — none slides onto a
neighbour, and none inherits the star of a row the filter just removed. That is the whole point,
and the rest of this page is why.

(A row filtered away *entirely* is unmounted, so its star goes with it — bring it back and it
returns fresh. That is not a lost update; it is a component that stopped existing and started
again. The identity that `list()` protects is the identity of the rows that **stay**.)

## The filter is a derived value, not stored state

The mistake is to keep a second array in state and update it from the search box:

```tsx
// ✗ Two sources of truth. Now every edit to `people` has to remember to redo
//   the filter, and a missed one shows stale rows with no error.
@state people: Person[] = [...];
@state visible: Person[] = [...];

onInput(event: Event) {
  this.query = (event.target as HTMLInputElement).value;
  this.visible = this.people.filter(match);   // and again on every add, remove, edit…
}
```

The filtered list is **derived** from the data and the query, so it is a [`@compute`](/concepts/compute):

```tsx
@state people: Person[] = [...];
@state query = "";

@compute get visible() {
  const q = this.query.trim().toLowerCase();
  if (!q) return this.people;
  return this.people.filter((p) => p.name.toLowerCase().includes(q));
}
```

There is one source of truth. `visible` recomputes only when `people` or `query` changes, and it
can never disagree with them, because it is not stored anywhere to fall behind.

## `each` binds to the derived array

```tsx
<ul>{list({ each: this.visible, as: PersonRow })}</ul>
```

`each` is read at the moment the list is built, so it is always the current filter. Nothing
declares a dependency on `query`: the read of `this.visible` in render is the dependency, and the
list is rebuilt from whatever that returns this time.

## Why not `this.visible.map(...)`

Because a filter is exactly where `.map()` costs you. Filtering removes items from the *middle* of
the list, and an unkeyed `.map()` matches the survivors to nodes by **position**:

```
before   Ada#0   Grace★#1   Edsger#2      (Grace is starred)
filter out Grace, with .map()
after    Ada#0   Edsger★#1               — Edsger took Grace's slot, and her star
```

The DOM looks right — three names became two. But Edsger's row is now sitting on Grace's old
component instance, so it shows *her* star. `list()` claims nodes by **identity** instead, so the
survivors stay themselves:

```
before   Ada#0   Grace★#1   Edsger#2
filter out Grace, with list()
after    Ada#0   Edsger#2               — Edsger is still Edsger, unstarred
```

That is what you just watched the demo do: remove the starred row from the middle, and no one else
lights up.

**No key is needed for this**, because filtering returns the *same objects* it selected from, and
identity is the object. A key earns its place only when the objects are re-created as fresh
instances for the same entity — a refetch, a deserialize — the case [the intro](/lists) covers.

## When the list is absent entirely

The conditional case is the same shape. Because `list()` is a call in an expression slot, a list
that may never exist costs nothing until it does:

```tsx
{this.query ? <ul>{list({ each: this.visible, as: PersonRow })}</ul> : null}
```

And an empty result is just an empty array — the list renders no rows, and the surrounding markup
decides what to show instead:

```tsx
{this.visible.length === 0 ? <p>No matches.</p> : null}
```

Nothing special happens for zero items. There is no list to tear down and none to declare, because
there was never a list — only a call that returned nothing this time.

## Next

- [Extending components](/composition/inheritance) — the unit of reuse.
