---
title: Walking a path
description: get, at and where say where to go; nothing runs until a final operation does.
section: Immutable updates
order: 66
---

# Walking a path

A chain records hops — nothing is read or copied while you build it, so the whole
path is known before a single object is touched (which is what lets each level be
copied at most once).

| | |
|---|---|
| `.get(key)` | go into a property |
| `.at(index)` | go into one element (negative counts from the end) |
| `.where(pred)` | go into **every** element the predicate accepts |

The array hops (`at`, `where`) only exist when the focused value is an array, so
`.where()` on an object is a compile error, not a runtime miss.

## `where` matches all of them

```tsx
// every draft post gets the title, in ONE walk — `posts` is copied once,
// and the posts that didn't match keep their identity.
focusOn(state)
  .get("posts")
  .where((post) => post.draft)
  .get("title")
  .set("TODO");
```

`remove` follows the same rule — `where(…).remove()` drops every match in one pass.
Because it matches all of them, `where` can't stop early; when you know the position,
`at(i)` skips the scan.

## Stepping through optional values

A path steps *through* a nullable value instead of being stopped by it, so an optional
property in the middle doesn't make everything below it uncallable:

```tsx
interface State {
  profile: { name: string } | null;
}

focusOn(state).get("profile").get("name").set("Ada");
```

If `profile` really is `null` at runtime, nothing changes and development reports
which hop couldn't be reached.

## Narrowing a type

```tsx
focusOn(state)
  .get("values")
  .where<string>((value) => typeof value === "string")
  .update((value) => value.toUpperCase()); // value is string
```

Give `where` an explicit type argument to narrow.

## Reading

```tsx
focusOn(state).get("posts").where((p) => p.id === 102).get("title").value();
// "Second post" — or undefined if the path resolves to nothing

focusOn(state).get("posts").where(Boolean).get("title").values();
// ["First post", "Second post"]
```

`value()` is the first focused value, `values()` is all of them. Reads are silent —
asking for a path that doesn't exist is a fair question with a fair answer. It's
*writes* that report a miss, because there a miss means an edit didn't happen.

## Next

- [Updating](/lens/updating) — the operations, and forking a path with `and`.
