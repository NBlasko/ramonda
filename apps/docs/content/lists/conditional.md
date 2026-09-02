---
title: Conditional and filtered
description: A list that only sometimes exists, or that shows a filtered slice — done right.
section: Rendering lists
order: 43
---

# Conditional and filtered lists

A list is rarely the whole array. It shows up only when a panel is open, or it is the
part of the data that matched a filter. Both fit `list()` naturally, because it is an
expression, not a component.

```demo:FilteredList
```

Star a row, then narrow the filter. Every row that stays keeps its own star — none
slides onto a neighbour, and none inherits the star of a row the filter removed.

(A row filtered out entirely is removed, so its star goes with it — bring it back and
it returns fresh. That is not a lost update; it is a component that stopped existing
and started again. `list()` protects the identity of the rows that *stay*.)

## The filtered list is a derived value, not stored state

The tempting mistake is to keep a second array in state and update it from the search
box — now every edit to the data has to remember to redo the filter, and a missed one
shows stale rows with no error.

Instead, the filtered list is *derived* from the data and the query, so it is a
[`@compute`](/concepts/compute):

```tsx
@state people: Person[] = [...];
@state query = "";

@compute get visible() {
  const q = this.query.trim().toLowerCase();
  if (!q) return this.people;
  return this.people.filter((p) => p.name.toLowerCase().includes(q));
}
```

One source of truth. `visible` recomputes when `people` or `query` changes and can
never fall out of step, because it isn't stored anywhere to go stale.

## Bind the list to the derived value

```tsx
<ul>{list(this.visible, (item) => <PersonRow item={item} />)}</ul>
```

`each` is read as the list is built, so it is always the current filter. You don't
declare a dependency on `query` — the read of `this.visible` in render *is* the
dependency.

## Why not `this.visible.map(...)`

Because filtering removes items from the *middle*, and a bare `.map()` matches survivors by
POSITION. Here is the whole fault in three lines. Three people, and Bo's row has a star toggled on
it — a `@state` on `PersonRow`, so it lives in the row's component and not in the data:

```
before      Ada          Bo ★         Cy
components  [ row 0 ]    [ row 1 ]    [ row 2 ]
```

Now the filter drops Bo. With `.map()` the survivors are `[Ada, Cy]`, and position is all the diff
has to go on:

```
after       Ada          Cy
components  [ row 0 ]    [ row 1 ]   ← Bo's component, and Bo's star
```

`Cy` is now rendered by the component that was Bo's, so **Cy shows Bo's star** — and nothing on the
page looks broken, which is what makes it expensive to find. The same happens to a half-typed input,
an open menu, a scroll position.

`list()` matches by identity instead, so `Ada` and `Cy` keep their own components and the one that
was Bo's is destroyed. No key is needed, because filtering returns the same objects it selected
from.

## When the list isn't there at all

Same shape — it is a call in an expression slot, so a list that may never exist costs
nothing until it does, and an empty result is just an empty array:

```tsx
{this.query ? <ul>{list(this.visible, (item: Person) => <PersonRow key={item.id} item={item} />)}</ul> : null}
{this.visible.length === 0 ? <p>No matches.</p> : null}
```

## Next

- [Hooks](/hooks) — reusable state and lifecycle with no element.
