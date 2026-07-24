---
title: Updating
description: The operations, forking a path with and, and one chain per write.
section: Immutable updates
order: 67
---

# Updating

Every write returns the **new root**, which is what you assign back:

```tsx
this.data = focusOn(this.data).get("title").set("Renamed");
```

| | |
|---|---|
| `.set(value)` | replace the focused value |
| `.update(fn)` | replace it with `fn(current)` |
| `.merge(partial)` | copy the focused object and assign over it |
| `.remove()` | drop the property or element |
| `.push(...items)` | append to the focused array |
| `.insert(i, ...items)` | insert at a position (`i === length` appends) |
| `.and(...branches)` | fork the path — several edits, one walk |

Setting a key that isn't there yet **creates it**.

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

## Diagnostics

In development, a path that can't be reached reports itself and changes nothing — a
missing property, a `null` on the way down, an out-of-range index, a `where` that
matched nothing. All of it, and the double-write guard, is compiled out of production.

## Next

- [Rendering lists](/lists) — where the new object an edit produces starts to matter.
