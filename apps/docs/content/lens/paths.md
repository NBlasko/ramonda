---
title: Walking a path
description: get, at and where describe where to go; nothing runs until a terminal operation does.
section: Immutable updates
order: 66
---

# Walking a path

A chain records hops. Nothing is read, copied or wrapped while you build it — the whole path is
known before a single object is touched, which is what lets one walk copy each level at most once.

| | |
|---|---|
| `.get(key)` | Descends into a property. |
| `.at(index)` | Descends into one element. Negative counts from the end. |
| `.where(pred)` | Descends into **every** element the predicate accepts. |

The array hops exist only when the focused value is an array, so `.where()` on an object is a
compile error at the call site rather than a runtime miss.

## `where` matches all of them

This is the part that differs most from writing the update by hand:

```tsx
// Every draft post gets the title, in ONE walk. `posts` is copied exactly once
// however many matched, and the posts that did not match keep their identity.
focusOn(state)
  .get("posts")
  .where((post) => post.draft)
  .get("title")
  .set("TODO");
```

`remove` follows the same rule — `where(…).remove()` drops every match in one pass.

Because it matches all of them, `where` **cannot stop early**. When you already know the position,
`at(i)` skips the scan, and on a long array that is the difference between a full pass and none.

## Narrowing is explicit

```tsx
focusOn(state)
  .get("values")
  .where<string>((value) => typeof value === "string")
  .update((value) => value.toUpperCase()); // value is string
```

There is deliberately no overload that infers a type guard from the predicate. Since TypeScript
5.5 a plain arrow gets a type predicate inferred for it, which made
`where((tag) => tag === "js")` on a `string[]` focus the literal type `"js"` — and the natural next
line, `.set("ts")`, failed to compile. The narrowing nobody asked for broke the write it was meant
to serve.

## Optional values on the way

A path steps **through** a nullable value rather than being stopped by one, so an optional
property in the middle does not make everything below it uncallable:

```tsx
interface State { profile: { name: string } | null }

focusOn(state).get("profile").get("name").set("Ada");
```

If `profile` really is `null` at runtime, nothing changes and development reports which hop could
not be reached.

## Reading

```tsx
focusOn(state).get("posts").where((p) => p.id === 102).get("title").value();
// "Second post" — or undefined if the path resolves to nothing

focusOn(state).get("posts").where(Boolean).get("title").values();
// ["First post", "Second post"]
```

`value()` is the first focused value, `values()` is all of them. Reads are **silent**: asking for a
path that does not exist is a fair question with a fair answer, so nothing is reported. Writes are
the ones that report a miss, because there the miss means an edit did not happen.

## Next

- [Updating](/lens/updating) — the operations, and forking a path with `and`.
