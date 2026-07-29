---
title: Rendering lists
description: Draw a list from an array with list() — no keys to write, and none to get wrong.
section: Rendering lists
order: 40
---

# Rendering lists

To draw a list from an array — rows of tasks, a set of cards — use `list()`:

```tsx
render() {
  return <ul>{list({ each: this.tasks, as: TaskRow })}</ul>;
}
```

```demo:ListDemo
```

`each` is the array; `as` is the component to render for each item (it receives the
item as its `item` prop). Click a few counters, then reverse the list — each count
stays with its task.

## No keys to write

If you've used another framework, you may expect to pass a `key` for each item.
Ramonda doesn't ask for one, on purpose.

The trouble with a key is that a wrong one doesn't error — it quietly moves state to
the wrong row (a key made from the array index follows the *position*, not the item).
So `list()` takes identity from the items themselves — an object is identified by
itself, a value like a string by its value — and there is nothing for you to write or
get wrong.

## It's a function, not a `<List>` tag

A component is one element, but a list drops several siblings into the parent — so
`list()` is a plain function call in a `{ }` slot, not a tag. That is what lets a list
sit anywhere an expression can:

```tsx
{this.open ? list({ each: this.results, as: ResultRow }) : null}

<ul>{list({ each: this.todo, as: TaskRow })}</ul>
<ul>{list({ each: this.done, as: TaskRow })}</ul>
```

`each` is read when the list is built, so it is always the current array. **It accepts
`null` and `undefined`** and renders nothing for them, which is what data that has not
arrived yet looks like:

```tsx
list({ each: this.query.data, render: this.renderRow })   // no `?? []`
```

That is not politeness — `each: this.query.data ?? []` builds a fresh empty array on every
render, and a changed `each` costs the list its item scopes. RMD020 reports it.

## Lists of primitives, and repeated values

`["a", "a", "b"]` is fine — repeated values are told apart by which occurrence they
are, so each gets its own stable row. You don't need (and shouldn't add) a key for a
`string[]` or `number[]`: two equal strings would produce the same key, which is
exactly the collision `list()` exists to avoid. (If you genuinely need to tell two
apart, they aren't really interchangeable values — model them as objects with an id.)

## When you *do* want a key

There is one case `list()` can't see: objects **re-created** as fresh instances that
mean the same thing — data that was refetched, or round-tripped through JSON. Then
give it a `key`:

```tsx
list({ each: this.users, key: (user) => user.id, as: UserRow });
```

Only then. Here collisions *are* checked (`RMD013`), because it is the one place a
mistake is possible again.

## `.map()` still works — for static lists

For a list that never reorders — a nav bar, a fixed set of tabs — `.map()` is fine.
Where it costs you is any list that reorders or drops items from the middle: without
identity the diff matches by position, and component state slides onto the wrong row.
The page *looks* right; the state moved. `list()` is what prevents that.

## Next

- [`as` and `render`](/lists/as-and-render) — two ways to turn an item into markup.
