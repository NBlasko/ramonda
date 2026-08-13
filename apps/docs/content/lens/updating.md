---
title: Updating
description: The operations, forking a path with and, and one chain per write.
section: Immutable updates
order: 92
---

# Updating

Every write returns the **new root**, which is what you assign back:

```tsx
this.data = focusOn(this.data).get("title").set("Renamed");
```

| | |
|---|---|
| `.set(value, opts?)` | replace the focused value |
| `.update(fn)` | replace it with `fn(current)` |
| `.merge(partial)` | copy the focused object and assign over it |
| `.remove()` | drop the property or element |
| `.push(...items)` | append to the focused array |
| `.insert(i, ...items)` | insert at a position (`i === length` appends, negative counts from the end) |
| `.and(...branches)` | fork the path — several edits, one walk |

With no hops at all the focused value *is* the root, so `focusOn(state).set(other)` replaces
the whole tree and `focusOn(state).merge({ … })` rewrites its top level.

`set` is the only one that REPLACES rather than derives, and that costs the value anything a
library had attached to it under a hidden symbol — which for an item in a
[`list()`](/lists) is what that item's component state is following. When the value you
are handing it is the same thing rebuilt, say so:

```tsx
import { SAME_ITEM } from "@ramonda/core";

this.posts = focusOn(this.posts).at(0).set(fromTheForm, SAME_ITEM);
```

## Don't mutate the result either

A write copies only what was on the path, so everything else in the result is **the same
object** it was in the input — see [the sharing](/lens#the-result-shares-objects-with-the-input).
Mutating either value changes both. Go through `focusOn` for every change, including the
one you make to a value that just came out of it.

## Writing where there is nothing yet

An optional property is a property TypeScript accepts, and the operations offered on it write
where nothing is:

```tsx
focusOn(state).get("posts").at(0).get("draft").set(true); // an absent key is created
focusOn(state).get("posts").at(0).get("labels").push("todo"); // labels?: string[] → ["todo"]
```

`set`, `update`, `push` and `insert` all create what the last hop names — for the array
operations, a missing or `null` value counts as an empty array. Pushing *nothing* creates
nothing: `push()` with no items is a no-op rather than an empty array.

`merge` is the one exception, and the line between them is what the operation can supply:
`push` hands over a complete array, while `merge` has only a `Partial`, so creating from it
would produce a half-built object typed as a whole one. Use `set` where the object itself
might be missing.

A hop in the **middle** of a path is different: a `null` or missing value there can't be
descended into at all, so the write changes nothing and development says which hop stopped it.

## Several edits in one pass

A chain describes one path. `and` forks it — each branch continues from that value:

```tsx
focusOn(state)
  .get("posts")
  .where((post) => post.id === 102)
  .and(
    (post) => post.get("title").set("Renamed"),
    (post) => post.get("tags").push("published"),
  );
```

Everything above the fork is copied **once**, not once per branch — that's the whole
reason `and` exists rather than chaining separate `focusOn` calls. Branches run in
order, each seeing the previous one's result.

### A branch has to return

What a branch returns *is* the new value of the forked node. A block body without `return`
hands back `undefined`, so the branch is skipped:

```tsx expect-error
focusOn(state)
  .get("posts")
  .at(0)
  .and((post) => {
    post.get("title").set("Renamed"); // ✗ returns nothing, so nothing happens
  });
```

TypeScript rejects it, and development reports it if the types were loose enough to let it
through. Write the expression form instead — `(post) => post.get("title").set("Renamed")`.

For the same reason a branch that ends in a **read** replaces the node with what it read.
`(post) => post.get("title").value()` returns a string where a post was expected, so the
types normally catch it; where the two happen to have the same type, they can't. Branches
are for writing.

### Or use `merge`

For several fields of the *same* object, `merge` is shorter:

```tsx
focusOn(state).get("posts").at(0).merge({ title: "Renamed", draft: true });
```

Reach for `and` when the branches go to different depths or need different operations.

## One chain, one write

Sharing a prefix to **read** is fine — hops return new chain objects, nothing is
mutated. But writing through the same `focusOn` twice throws in development:

```tsx
const posts = focusOn(state).get("posts");
posts.at(0).get("title").set("one");
posts.at(1).get("title").set("two"); // ✗ throws
```

`focusOn(root)` captures `root` once, so the second write would compute from the
*original* value and silently discard the first. Fork instead, or feed the result back
in:

```tsx
const next = focusOn(state).get("posts").at(0).get("title").set("one");
const after = focusOn(next).get("posts").at(1).get("title").set("two");
```

## What can't be walked into

`Map`, `Set` and `Date` are fine as *values* (`set(new Date())` stores one like any
leaf), but a path can't descend *into* one — their contents live in internal slots a
copy can't reach. Class instances are walked normally: copies keep the prototype, so
an instance stays an instance.

`__proto__`, `constructor` and `prototype` are refused as keys. A key can come from data —
a field name, a key off a parsed request body — and a write through one of those reaches an
object's own machinery rather than its data. That guard is in the production build too.

## Diagnostics

In development, a path that can't be reached reports itself and changes nothing — a
missing property, a `null` on the way down, an out-of-range index, a `where` that
matched nothing. [Messages you might see](/lens/messages) lists them all.

Production strips them, and that includes **behaviour**, not just the text: the
double-write guard above and `focusOn(root).remove()` throw in development and do nothing
at all in production. Neither is control flow to rely on — don't wrap either in a `try`
expecting to catch something in a shipped build.

## Next

- [Messages you might see](/lens/messages) — every development message, and its cause.
- [Rendering lists](/lists) — where the new object an edit produces starts to matter.
