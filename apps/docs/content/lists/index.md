---
title: Rendering lists
description: Draw a list from an array with list() — lazy, and identified by the item itself.
section: Rendering lists
order: 40
---

# Rendering lists

To draw a list from an array — rows of tasks, a set of cards — use `list()`:

```tsx
class TaskList extends Component {
  @state tasks: Task[] = [];

  render() {
    return <ul>{list(this.tasks, (item) => <TaskRow item={item} />)}</ul>;
  }
}
```

```demo:ListDemo
```

Two arguments: the array, and the one way to turn an item into markup — a component
(it receives the item as its `item` prop) or a function. Click a few counters, then
reverse the list — each count stays with its task.

## Which row is which

A list has to answer one question whenever the array changes: which row on screen is
which row in the new array. Get it wrong and a row's state lands on its neighbour — a
half-typed input, an open menu, a scroll position, all one row off, while the page
still looks right.

There are three answers, tried in this order, and the first two are exact.

**The object.** While a row is the same object it is the same row. Nothing is declared
and nothing can be got wrong. This covers every update that keeps its references —
`filter`, a spread that touches one row, a [lens](/lens) write. A repeated primitive is
told apart by which occurrence it is, so `["a", "a", "b"]` is three stable rows.

**Your key.** The moment an object is *new* — data from a refetch, a `JSON.parse`, an
array built fresh in a `@compute` — the object cannot answer, because nothing here has
seen it before. A `key` is what still can:

```tsx
list(this.users, (user) => <UserRow key={user.id} item={user} />);
```

Write it from your data, never from the array index — the index *is* the position, so
keying by it says "this is the second row", which is exactly what stops being true when
rows move. Two rows under one key are reported ([`RMD002`](/reference/diagnostics)).

**A guess.** With no key and a new object, the incoming array is aligned against the one
on screen by what the rows still have in common. It is right for the shapes data takes —
see [refetched data](#refetched-data-and-objects-that-are-re-created) — and it is a
guess, which is why a key beats it.

## It does not iterate where you write it

This is the one thing that separates `list()` from a `.map()`, and it is the one
thing you cannot see:

```tsx
list(this.tasks, (task) => <li>{task.title}</li>)
```

**Nothing has run when that line finishes.** The callback has not been called once.
What comes back is a *description* — the array, and the way to turn one item into
markup — and the framework calls your callback later, while it is reconciling the
place the rows live in.

That is what pays for itself. When the array has not changed, the framework already
knows nothing about the list can differ, so **the callback is never called at all**
and not one row is touched. A `.map()` cannot do that: by the time anything can ask
whether the work was needed, every row has already been built.

## Skipping the callback needs a callback it can skip

The rule above has one condition, and it follows from what skipping means: to hand back last render's
rows, the framework has to be sure the callback would produce the same ones. It knows every value the
callback **read** — reads are tracked wherever they happen, however many helpers deep, in whatever
module. What it cannot know is a value read *outside* the callback and closed over:

```tsx
const label = this.label;
list(this.tasks, (task: Task) => <li>{task.title} {label}</li>)   // the row reads nothing
```

Nothing can look inside a closure and list what it captured. So the framework goes by the one thing it
can see: **an inline callback is a new function every render, and a new function might have captured
anything — so its rows are rebuilt.** A callback that *cannot* capture a render's locals has a stable
reference, and its rows are reused:

```tsx
class Board extends Component {
  @state tasks: Task[] = [];
  @state label = "";

  row(task: Task) {
    return <li>{task.title} {this.label}</li>;    // reads its state INSIDE — tracked
  }

  render() {
    return <ul>{list(this.tasks, this.row)}</ul>;
  }
}
```

**A method is the form to reach for when a list is large.** A module-level function counts too, for the
same reason — it cannot see any render either.

**And an inline callback is not wrong, it is just not skipped.** It costs the callback call and a fresh
vnode per row per render, and — measured at 10 000 rows over five re-renders — **no extra DOM work at
all**: the diff finds the rows identical and touches nothing. So a short list keeps every guarantee and
pays nothing you can notice, and only a very large one is worth moving to a method.

What you never get is a stale row. That was the alternative, and it is the reason the rule is the
callback's shape rather than a promise to be careful.

It follows that the description is not a list of things you can look at:

```tsx
const rows = list(this.tasks, (task) => <li>{task.title}</li>);

rows.length      // no
rows.map(...)    // no
[...rows]        // no
```

TypeScript refuses all three, and development throws with an explanation if the types
were bypassed. **If what you want is an array of values rather than a rendered list,
that is `.map()`** — and `.map()` is a perfectly good way to render one too, as long
as you give the rows a key.

## It's a function, not a `<List>` tag

A component is one element, but a list drops several siblings into the parent — so
`list()` is a plain function call in a `{ }` slot, not a tag. That is what lets a list
sit anywhere an expression can:

```tsx
{this.open ? list(this.results, (item) => <ResultRow item={item} />) : null}

<ul>{list(this.todo, (item) => <TaskRow item={item} />)}</ul>
<ul>{list(this.done, (item) => <TaskRow item={item} />)}</ul>
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

No field is special by NAME. An `id` counts for exactly as much as a `title`,
because a framework cannot know which of your fields is an identity — you may well
build one array from another and repeat an id, and a rule that trusted `id` would
quietly merge two rows.

What does count is how much a field distinguishes. A value several rows share
identifies none of them and is ignored, and so is a field that merely restates the
row's position (an `index`), because position is not identity.

### What is deliberately not carried

**A list replaced with different data.** A pair is only made when two rows still
agree on a field that tells rows APART. A `done: false` shared by every row says
nothing about which row it is, so it does not count — which is why page 2 of a
table inherits nothing from page 1, even though both pages are full of the same
flags. The guard is per row, and it is about how much a field distinguishes
rather than how many fields match.

**A copy.** `{ ...row }` gives you a new row, not a second claim on an old one.
Identity is a non-enumerable symbol, so a spread, a `JSON.stringify` and every
equality check you write are all blind to it. (`Object.freeze` is fine — a frozen
row keeps its identity too, just somewhere the freeze cannot reach.)

**A row with nothing to identify it.** `{ tags: [...] }` and nothing else: there is
no field to pair it on, so a change to one of them rebuilds that row. This is the
case `merge` is for.

## When you know better than the inference

`list()` reads your rows and decides. For the shapes data takes that is right — but
it *is* inference, and it has no way to be told otherwise. `merge` is that way, and
it sits where the data arrives rather than on the list:

```tsx
this.rows = merge(this.rows, await api.getRows(), (row) => row.id);
```

Said once, at the boundary — not on every list that renders those rows.

With an identity, rows are paired by what you named. An unchanged row comes back as
the **same object** wherever it moved to, and a changed one comes back carrying its
predecessor's identity, so the row updates in place instead of being rebuilt.

Without one, `merge` still earns its place: it hands back the previous value
wherever the new one equals it, so a refetch that changed nothing is not a change
at all and nothing re-renders.

```tsx
this.rows = merge(this.rows, await api.getRows());
```

[`@ramonda/query`](/query) does this for you on every fetch — there is nothing to
turn on.

## What about `.map()`?

`.map()` renders a list perfectly well, and it is not discouraged. What it needs is a
key on every row ([`RMD023`](/reference/diagnostics) asks for one), because a `.map()`
has no identity of its own — without a key the rows are matched by position, so a
reorder or a removal from the middle hands every row below it the previous row's state
and DOM.

Plain markup looks like it gets away with that, because the diff patches the text and the
result reads correctly. It does not: an `<input>` inside that `<li>` holds a caret, a
selection and whatever the user typed, and those follow the **node** rather than the text.

One thing a missing key does *not* cost you is the boundary. Rows built from an array
cannot be confused with the siblings around them, keyed or not — every array in JSX
becomes its own group with its own key space, so an element toggling in or out beside the
array never reaches into it, and the array never reaches out.

**What `list()` adds is laziness.** It does not iterate where you write it, so a list
whose array did not change costs nothing at all — a 500-row table's render is 0.04% of its
commit. It also gives each row its own reactive scope, so a signal one row reads
invalidates that row and no other, and it identifies rows by the item itself, so a key is
something you reach for rather than something you must remember.

Either is a fine choice. `list()` is the one that scales.

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

- [The row callback](/lists/row-callback) — how an item becomes markup, and where the key goes.
