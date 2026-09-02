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
the diff will skip.

**A write of the value that is already there copies nothing at all.** Not the object it lands in, not
the ones above it — the root that comes back IS the root that went in:

```tsx
focusOn(state).get("title").set(state.title) === state; // true
```

Read the line inside out: `state.title` is what is already at `title`, so the write puts the same
value in the same place. Nothing about the state differs afterwards, so there is nothing to copy, and
`===` on the root says so.

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

An immutable edit gives the edited item a **new object**, and a
[`list()`](/lists) recognises an item by the object it holds. So without help, the
item you just edited looks like one it has never seen: it is torn down and built
again, and whatever its component was holding — a half-typed input, an open menu —
goes with it.

A lens write does not need that help. At the moment it replaces a value it is
holding both versions, so it knows which item this is and says so. Edit an item and
it keeps its element and its component:

```tsx
this.posts = focusOn(this.posts).where((p) => p.id === id).merge({ title });
```

### Editing an item, and replacing one

The three that DERIVE the new item from the old one say "this item, changed", and it
keeps everything it had:

```tsx
focusOn(state.posts).at(0).merge({ title: "New" });                 // edit some fields
focusOn(state.posts).at(0).update((p) => ({ ...p, draft: false })); // edit from the old value
focusOn(state.posts).at(0).get("title").set("New");                 // edit one field
```

`set` aimed at the array element itself is the one that cannot say which you meant:

```tsx
focusOn(state.posts).at(0).set(edited);     // "here is that post, updated"
focusOn(state.posts).at(0).set(otherPost);  // "put a different post here"
```

Both are the same call. A lens is *handed* the value instead of deriving it, so it
cannot tell a corrected post from a different one — and giving a different post the
open editor of the post it replaced is the worse of the two mistakes. **So `set`
treats the value as something else, and the item is rebuilt.**

When you know it is the same item, say so:

```tsx
import { SAME_ITEM } from "@ramonda/core";

focusOn(state.posts).at(0).set(fromTheForm, SAME_ITEM);
```

Nothing about the new object has to resemble the old one — every field can differ,
the id included — because you said which item it is rather than leaving it to be
worked out.

**So reach for `merge` or `update` when you are editing an item**, and keep `set` on
an array element for what it says plainly: putting something else there. For a
property inside an item, `set` is unambiguous and is the right tool.

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
