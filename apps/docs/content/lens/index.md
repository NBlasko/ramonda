---
title: Immutable updates
description: Change something deep in nested state without mutating it — readably.
section: Immutable updates
order: 90
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

```sh
pnpm add @ramonda/lens
```

```tsx
import { focusOn } from "@ramonda/lens";

const updated = focusOn(state)
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

Anything that compares by reference gets the same benefit: a memo, a store subscriber,
an equality check in a test.

## The result shares objects with the input

Keeping the untouched parts identical means the result and the input hold **the same
objects** wherever nothing changed. So mutating one of them changes the other:

```tsx
const updated = focusOn(state).get("home").get("city").set("Niš");

// `posts` was off the path, so `updated.posts` IS `state.posts`.
updated.posts.push(newPost); // ✗ this also changes state.posts
```

Treat both values as read-only and go through `focusOn` for every change — that is
what keeps a reference that didn't change meaning a value that didn't change:

```tsx
const withPost = focusOn(updated).get("posts").push(newPost);
```

## It pairs with `list()`

An immutable edit gives the edited item a **new object**. In a [`list()`](/lists)
without a `key`, that edited row counts as a new entity, so its component state resets
(every other row is untouched — [state is never wrong, only reset](/lists/nested)).
When a row owns state you care about, add a `key`:

```tsx
list(this.posts, (item) => <PostRow item={item} />);
```

`focusOn` and `key` belong together whenever list items own state.

## Small, and usable on its own

It's about 1.3 KB, has no dependencies, and uses no proxies — nothing is copied or
wrapped until a final operation runs; the chain just records where to go.

Nothing in it knows about Ramonda, either. It's a standalone package for immutable
updates: import it into any TypeScript or JavaScript project, in the browser or on the
server, wherever a deep value has to change without the old one moving. It lives here
because the framework's diff depends on exactly the guarantee it makes.

## Next

- [Walking a path](/lens/paths) — `get`, `at`, `where`, and reading.
- [Updating](/lens/updating) — the operations, and forking a path with `and`.
- [Messages you might see](/lens/messages) — every development message, and its cause.
