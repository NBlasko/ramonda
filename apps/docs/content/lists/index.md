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
  return <ul>{list(this.tasks, TaskRow)}</ul>;
}
```

```demo:ListDemo
```

Two arguments: the array, and the one way to turn an item into markup — a component
(it receives the item as its `item` prop) or a function. Click a few counters, then
reverse the list — each count stays with its task.

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
{this.open ? list(this.results, ResultRow) : null}

<ul>{list(this.todo, TaskRow)}</ul>
<ul>{list(this.done, TaskRow)}</ul>
```

`each` is read when the list is built, so it is always the current array. **It accepts
`null` and `undefined`** and renders nothing for them, which is what data that has not
arrived yet looks like:

```tsx
list(this.query.data, this.renderRow)   // no `?? []`
```

That is not politeness — `this.query.data ?? []` builds a fresh empty array on every
render, and a changed array costs the list its item scopes. RMD020 reports it.

## Lists of primitives, and repeated values

`["a", "a", "b"]` is fine — repeated values are told apart by which occurrence they
are, so each gets its own stable row. (If you genuinely need to tell two apart, they
aren't really interchangeable values — model them as objects with an id.)

## Refetched data, and objects that are re-created

Data from outside is the hard case. A refetch, a `JSON.parse`, anything
round-tripped through the network hands you **fresh objects meaning the same
rows** — nothing shares a reference with what is on screen. Matching by reference
finds none of them.

`list()` handles this for you. When it meets an array whose objects it has not
seen, it aligns the new array against the one it is showing and carries each row's
identity across. So a refetch **updates** its rows instead of destroying and
rebuilding them:

```tsx
this.users = await api.getUsers();   // every object is new
```

A row whose `name` changed keeps its DOM node, its component instance, and
whatever that component was holding — a half-typed input, an open menu, a scroll
position. Nothing to write, nothing to get wrong.

### How the alignment works

Rows that are **equal by content** are matched first — those are the anchors.
Whatever sits between two anchors in the old array is then paired with whatever
sits between the same two anchors in the new one, by how much the two still have
in common. That is what carries a row that *changed*: its unchanged neighbours
place it, and what it still shares with them decides which one it is.

No field is special. An `id` counts for exactly as much as a `title`, because a
framework cannot know which of your fields is an identity — you may well build one
array from another and repeat an id, and a rule that trusted `id` would quietly
merge two rows. The one exception cuts the other way: a field that merely restates
the row's position (an `index`) is ignored, because position is not identity and
counting it would let it outvote a field that is.

### What is deliberately not carried

**A list replaced with different data.** A pair is only made when two rows still
have a field in common, so page 2 of a table shares nothing with page 1 and
inherits none of it. That is the guard, and it is per row — not a ratio, not a
threshold.

**A copy.** `{ ...row }` gives you a new row, not a second claim on an old one.
Identity is a non-enumerable symbol, so a spread, a `JSON.stringify` and every
equality check you write are all blind to it.

**A frozen row.** `Object.freeze` leaves nothing to write identity onto, so those
rows fall back to matching by reference.

There is no `key` option to reach for. There is nothing to write.

## What about `.map()`?

**Use `list()` for anything built from an array.** One rule, and it is the one worth
learning: `.map()` has no identity, so the diff matches rows by position. Reorder, or
remove from the middle, and every row after the change takes the previous row's place —
component state and DOM go with it. Focus, scroll position, an open menu, a half-typed
input, all one row off. The page *looks* right.

You will still meet `.map()` in code, so it is worth knowing exactly when it bites:

- **Plain markup** — `{items.map((i) => <li>{i}</li>)}` — survives, because the diff
  patches the text and the result is correct. The framework does not report it.
- **Components** — `{items.map((i) => <Row item={i} />)}` — does not, and that one *is*
  reported ([`RMD023`](/reference/diagnostics)).

So `.map()` is not always wrong. It is just never *better*: `list()` is correct in both
cases, and on top of that it is lazy — the descriptor is built in `render()` and the rows
by the diff, so a 500-row table's render is 0.04% of its commit. And `each` accepts
`null` and `undefined`, so there is no `?? []` rebuilt every render.

Knowing one rule beats knowing when the exception applies.

```tsx
// A fixed set of tabs is a list too.
const TABS = ["overview", "activity", "settings"];

class Panel extends Component {
  @memoizedHandler
  select(name: string) {
    return () => {
      this.active = name;
    };
  }

  @state active = TABS[0];

  renderTab(name: string) {
    return <button type="button" onClick={this.select(name)}>{name}</button>;
  }
  render() {
    return <nav>{list(TABS, this.renderTab)}</nav>;
  }
}
```

`TABS` lives outside the class on purpose: a fresh array literal every render is a new
value every render, and identity is minted from the items.

## Next

- [A component or a function](/lists/as-and-render) — two ways to turn an item into markup.
