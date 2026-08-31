---
title: Walking a path
description: get, at and where say where to go; nothing runs until a final operation does.
section: Immutable updates
order: 91
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

If `profile` really is `null` at runtime, **nothing changes**. Development reports which hop could
not be reached, names the whole path, and says what to do instead — only the LAST hop creates what it
names, so a gap before it cannot be walked through.

**A published build says nothing.** Every lens diagnostic is behind `__DEV__`, so the check still
runs and the write still does nothing, but there is no message and no record — deliberately: the text
is bytes an app ships to nobody, and a devtools collector that happens to be loaded should receive
silence rather than a stream to filter.

That is the shape to know about. An update through a gap is not an error your users see; it is an
update that does not happen. Two ways to keep it from reaching production unnoticed:

- **Read the warning in development.** It names the exact hop, so it is one line to fix.
- **Set the intermediate value first**, or `merge` the object into place, whenever the middle of a
  path is genuinely optional rather than merely typed that way.

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

`value()` answers `undefined` both for a path that resolved to nothing and for a property
that is there and holds `undefined` — its result can't tell them apart. When the difference
matters, count instead: `values().length` is `0` for a miss and `1` for a present
`undefined`.

## Next

- [Updating](/lens/updating) — the operations, and forking a path with `and`.
- [Messages you might see](/lens/messages) — every development message, and its cause.
