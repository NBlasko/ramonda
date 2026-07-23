---
title: Immutable updates
description: focusOn describes a path, copies only what is on it, and leaves every other reference untouched.
section: Immutable updates
order: 65
---

# Immutable updates

```tsx
import { focusOn } from "@ramonda/lens";

this.data = focusOn(this.data)
  .get("posts")
  .where((post) => post.id === 102)
  .get("tags")
  .where((tag) => tag === "draft")
  .set("published");
```

Nothing is mutated. The result shares every object that was **not** on that path — the other
users, the other post, the untouched tag — and has a new object for each of the four levels that
were: the root, `posts`, `posts[1]`, and `posts[1].tags`.

No proxies. Nothing is read, copied or wrapped until a terminal operation runs; the chain only
records where to go.

## Why the shape of the result matters

Ramonda's diff shallow-compares. A branch whose reference did not change is rejected on a `===`
and never walked into. That only works if *untouched* really means *identical* — which is the
guarantee this package exists to provide, and the reason it lives next to the framework rather
than being any immutable-update helper.

```demo:LensSharing
```

Press the buttons and watch which rows say **same object**. Those are the branches the diff will
skip.

The guarantee holds in the other direction too. A write whose value is already there produces
**no copies at all** and returns the original root:

```tsx
focusOn(state).get("title").set(state.title) === state; // true
```

So does a `merge` of unchanged fields, and an `update` that returns its input. A no-op cannot
invalidate the path above it.

## The pairing with `list()`

[`list()`](/lists) binds an item's identity to its object. An immutable edit gives the edited item
a **new object** — which is exactly right for the diff, and has one consequence worth knowing
before you meet it:

> In a list **without** `key`, the edited row is a new entity, so that row's component state
> resets. Every other row is untouched.

Nothing lands on the wrong row — [state is never wrong, only reset](/lists/nested) — but when a
row owns state you care about, that is when `key` earns its place:

```tsx
list({
  each: this.posts,
  key: (post) => post.id,   // "this is still the same entity"
  as: PostRow,
})
```

`focusOn` and `key` belong together whenever list items own state. Neither is needed for a list of
plain markup.

## Why not a draft-mutating library

The usual alternative hands you a proxied draft to mutate. It produces the same structural
sharing, so the difference is not correctness:

- **No proxy means no draft that can escape its producer**, and no finalize pass over the result.
- **Scanning is not pathological.** Searching a draft drafts every element it touches, so
  `draft.posts.find(…)` over 5000 records allocates 5000 proxies. Describing the search as part of
  the path does not.
- It is about **1.2 KB**, and has no dependencies.

On like-for-like paths the speed difference is modest — both approaches copy only what is on the
path, and that costs the same. The numbers, including the ones that flatter neither side, are in
the package README.

## Next

- [Walking a path](/lens/paths) — `get`, `at`, `where`, and reading.
- [Updating](/lens/updating) — the operations, and forking a path with `and`.
