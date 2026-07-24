---
title: Immutable updates
description: Change something deep in nested state without mutating it — readably.
section: Immutable updates
order: 65
---

# Immutable updates

When your state is a nested object and you need to change something deep inside it,
you can't just mutate it in place — Ramonda compares by reference to decide what
changed (see [state](/concepts/state)), so a mutated object still looks the same. You
have to produce a *new* object: copy the parts that changed, keep the rest. Done by
hand with spread syntax, that gets verbose fast:

```tsx
// change one tag on one post, by hand:
this.data = {
  ...this.data,
  posts: this.data.posts.map((post) =>
    post.id === 102
      ? { ...post, tags: post.tags.map((t) => (t === "draft" ? "published" : t)) }
      : post,
  ),
};
```

`@ramonda/lens` does the same thing, readably:

```tsx
import { focusOn } from "@ramonda/lens";

this.data = focusOn(this.data)
  .get("posts")
  .where((post) => post.id === 102)
  .get("tags")
  .where((tag) => tag === "draft")
  .set("published");
```

You describe the **path** to what you want to change, and the change. `focusOn` copies
exactly the objects along that path and shares everything else untouched. Nothing is
mutated.

## Why the sharing matters

Ramonda's diff skips a branch whose object reference didn't change — so keeping the
untouched parts *identical* is what makes re-renders cheap. That is exactly what
`focusOn` guarantees, which is why it lives next to the framework rather than being
just any helper.

```demo:LensSharing
```

Press the buttons and watch which rows say **same object** — those are the branches
the diff will skip. A write whose value is already there produces no copies at all and
returns the original:

```tsx
focusOn(state).get("title").set(state.title) === state; // true
```

## It pairs with `list()`

An immutable edit gives the edited item a **new object**. In a [`list()`](/lists)
without a `key`, that edited row counts as a new entity, so its component state resets
(every other row is untouched — [state is never wrong, only reset](/lists/nested)).
When a row owns state you care about, add a `key`:

```tsx
list({ each: this.posts, key: (post) => post.id, as: PostRow });
```

`focusOn` and `key` belong together whenever list items own state.

## Small and dependency-free

It's about 1.2 KB, has no dependencies, and uses no proxies — nothing is copied or
wrapped until a final operation runs; the chain just records where to go.

## Next

- [Walking a path](/lens/paths) — `get`, `at`, `where`, and reading.
- [Updating](/lens/updating) — the operations, and forking a path with `and`.
