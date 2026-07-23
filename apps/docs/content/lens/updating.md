---
title: Updating
description: The operations, forking a path with and, and why one chain does one write.
section: Immutable updates
order: 67
---

# Updating

Every write returns the **new root**, so the result is what you assign back:

```tsx
this.data = focusOn(this.data).get("title").set("Renamed");
```

| | |
|---|---|
| `.set(value)` | Replaces the focused value. |
| `.update(fn)` | Replaces it with `fn(current)`. |
| `.merge(partial)` | Copies the focused object and assigns over it. |
| `.remove()` | Drops the property or element from its container. |
| `.push(...items)` | Appends to the focused array. |
| `.insert(i, ...items)` | Inserts at a position. `i === length` appends. |
| `.and(...branches)` | Forks the path — several edits, one walk. |

Setting a key that is not there yet **creates it**. `draft?: boolean` is a key TypeScript accepts,
so refusing it at runtime would make the API disagree with its own types — and with `merge`, which
would have added the same field. A typo in the *middle* of a path is still reported and still
changes nothing, because there the value cannot be descended into at all.

## Several edits in one pass

A chain describes one path. `and` forks it: each branch walks on from that value and returns the
new version of it.

```tsx
focusOn(state)
  .get("posts")
  .where((post) => post.id === 102)
  .and(
    (post) => post.get("title").set("Renamed"),
    (post) => post.get("tags").push("published"),
  );
```

**Everything above the fork is copied once, not once per branch.** That is the whole reason it
exists rather than feeding each result into a new `focusOn` — the shared prefix is walked a single
time. On a 5000-post state, three edits through one fork measured **7.9 µs against 21.7 µs** for
three separate chains.

Three details worth knowing:

- **Branches run in order**, and each sees the previous one's result. Applying them all to the
  original and combining afterwards would let the last branch silently discard the others.
- **A branch receives a focus rooted at the forked value**, so its terminal operation returns the
  new value of *that* node. That is why the types line up with no new concept to learn.
- **Forks nest**, and a fork under `where` applies to every match.

For several fields of the **same** object, `merge` is shorter:

```tsx
focusOn(state).get("posts").at(0).merge({ title: "Renamed", draft: true });
```

Reach for `and` when the branches go to different depths, or need different operations.

## One chain, one write

Sharing a prefix to **read** is fine — hops return new chain objects, so nothing is mutated:

```tsx
const posts = focusOn(state).get("posts");
posts.where((p) => p.draft).values();
posts.where((p) => p.id === 1).value();
```

Writing through the same `focusOn` twice is not, and throws in development:

```tsx
const posts = focusOn(state).get("posts");
posts.at(0).get("title").set("one");
posts.at(1).get("title").set("two"); // throws
```

`focusOn(root)` captures `root` once, so the second write would be computed from the **original**
value and would silently discard the first edit. The result looks plausible and is missing a
change, which is far harder to find than a throw.

Fork instead, or feed the result back in:

```tsx
const next = focusOn(state).get("posts").at(0).get("title").set("one");
const after = focusOn(next).get("posts").at(1).get("title").set("two");
```

## What cannot be traversed

`Map`, `Set` and `Date` are fine as **values** — `set(new Date())` stores one like any other leaf.
A path cannot descend *into* one: their contents live in internal slots that a copy cannot reach,
so a chain that tries reports it and changes nothing.

Class instances are traversed normally. Copies preserve the prototype and copy descriptors, so an
instance stays an instance and a getter stays a getter.

## Diagnostics

In development, a path that cannot be reached reports itself and changes nothing: a missing
property mid-path, a `null` on the way down, an index out of range, a `where` that matched nothing,
a branch that forgot to return. All of it is compiled out of the production build, along with the
double-write guard.

## Next

- [Rendering lists](/lists) — where the new object identity an edit produces starts to matter.
