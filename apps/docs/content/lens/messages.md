---
title: Messages you might see
description: Every development message lens prints, what caused it, and what to do about it.
section: Immutable updates
order: 93
---

# Messages you might see

Every message carries a **code** and looks like this:

```
[Ramonda lens RML001] .profile is undefined, so .profile.city could not be reached. Nothing was changed.

→ Only the LAST hop creates what it names, so a gap before it cannot be walked through. Set the
  intermediate value first, or `merge` the whole object into place.
```

Search this page for the part you saw; the code links to
[the reference](/reference/diagnostics), which explains the cause in full. One
code covers a fault *class*, so several messages share one — `at` on an object and
`where(…).remove()` on an object are the same mistake with the same fix.

Three things to know before reading them:

- **A message means the write did nothing.** The value you got back is the original root,
  unchanged — not a partial edit. Structural sharing does the rest: nothing was copied either.
- **Messages repeat.** They are not deduplicated, because a miss here depends on the data: the
  same line can miss for one record and land for the next, and collapsing those would hide the
  case that matters. Repetition is the signal.
- **The severity says whether the code can be right.** An **error** means it cannot be, whatever
  the data holds — a wrong kind of value, a refused key, a branch that returns nothing; those
  print with `console.error`. A **warning** means it may well be, and the data was simply empty
  or absent. A devtools panel or [any other collector](/reference/diagnostics#capturing-them)
  receives every one of them as a record.

The path in a message is written the way you wrote it — `.posts.where(…).tags` — and stops at
the hop that failed, so the last thing in it is the thing to look at. A path with no hops at all
prints as `(root)`.

Reads never print anything. `value()` and `values()` on a path that resolves to nothing are a
fair question with a fair answer, and the answer is `undefined` or `[]`.

## The path couldn't be reached

```tsx
focusOn(state).get("profile").get("city").set("Niš");
// [Ramonda lens RML001] .profile is undefined, so .profile.city could not be reached.
```

| Code | Message | What it means, and what to do |
|---|---|---|
| [RML001](/reference/diagnostics#rml001-a-path-that-could-not-be-reached) | ``… is undefined, so … could not be reached`` | A hop before the last one is `undefined` or `null`. Only the **last** hop creates what it names. Set the intermediate value first, or `merge` the whole object into place. |
| [RML001](/reference/diagnostics#rml001-a-path-that-could-not-be-reached) | ``… is 42, so … could not be reached`` (any JSON value) | A hop before the last one holds a primitive, so there is nothing to descend into. Usually a path one hop too long, or a key that names a leaf. |
| [RML002](/reference/diagnostics#rml002-a-path-into-a-map-set-or-date) | ``… is a Map`` (also `Set`, `Date`, `WeakMap`, `WeakSet`) | A path tried to descend *into* one of these. Their contents live in internal slots a copy can't reach. Read the value out, rebuild it, and `set` the result: `focusOn(state).get("byId").set(new Map(next))`. |
| [RML007](/reference/diagnostics#rml007-nothing-to-remove) | ``… is not a container, so there is nothing to remove from`` | `remove()` was aimed at a property of something that isn't an object or array. Check the hop before the one being removed. |

## The value isn't the kind the operation needs

| Code | Message | What it means, and what to do |
|---|---|---|
| [RML003](/reference/diagnostics#rml003-an-array-hop-on-something-that-is-not-an-array) | ``… is not an array, so `at` cannot be used`` | `at(i)` on a value that isn't an array. TypeScript refuses this, so it comes from JavaScript or a cast. Use `get(key)` for an object. |
| [RML003](/reference/diagnostics#rml003-an-array-hop-on-something-that-is-not-an-array) | ``… is not an array, so `where` cannot be used`` | Same, for `where`. |
| [RML006](/reference/diagnostics#rml006-an-operation-that-needs-a-different-kind-of-value) | ``… is not an array, so `push` did nothing`` | The value is there and is not an array — a number, a string, an object. A missing or `null` array is *not* this case: those are created. Check what the key really holds. |
| [RML006](/reference/diagnostics#rml006-an-operation-that-needs-a-different-kind-of-value) | ``… is not an array, so `insert` did nothing`` | Same, for `insert`. |
| [RML006](/reference/diagnostics#rml006-an-operation-that-needs-a-different-kind-of-value) | ``… is not an object, so `merge` did nothing`` | `merge` needs an object to copy, and it doesn't create one — a `Partial` can't fill a whole object. Use `set` where the object itself may be missing. |
| [RML003](/reference/diagnostics#rml003-an-array-hop-on-something-that-is-not-an-array) | ``… is not an array, so `at(…).remove()` cannot be used`` | `at(i).remove()` on a non-array. |
| [RML003](/reference/diagnostics#rml003-an-array-hop-on-something-that-is-not-an-array) | ``… is not an array, so `where(…).remove()` cannot be used`` | `where(…).remove()` on a non-array. |

## Nothing was there to change

| Code | Message | What it means, and what to do |
|---|---|---|
| [RML005](/reference/diagnostics#rml005-a-predicate-that-matched-nothing) | ``… .where(…) matched no element`` | The predicate accepted nothing, so the write had no target. Often a stale id, or a comparison against the wrong field. Reading the same path with `values()` shows what's actually there. |
| [RML005](/reference/diagnostics#rml005-a-predicate-that-matched-nothing) | ``… .where(…) matched no element, so nothing was removed`` | The same, for `remove()`. |
| [RML004](/reference/diagnostics#rml004-an-index-outside-the-array) | ``… has 3 element(s), so index 9 is out of range`` | `at(i)` outside `-length … length - 1`. Negative counts from the end, so `at(-1)` is the last element. |
| [RML004](/reference/diagnostics#rml004-an-index-outside-the-array) | ``… has 3 element(s), so index 9 cannot be removed`` | The same, for `remove()`. |
| [RML004](/reference/diagnostics#rml004-an-index-outside-the-array) | ``… has 3 element(s), so 9 is not a valid insertion point`` | `insert(i, …)` outside `-length … length`. `length` itself is valid — that's an append. `push` when you mean the end. |
| [RML007](/reference/diagnostics#rml007-nothing-to-remove) | ``… has no property "draft", so nothing was removed`` | `remove()` named a key the object doesn't have. Nothing to do — but check the spelling, because a typo reads the same way. |

## A fork didn't do what it looked like

```tsx expect-error
focusOn(state)
  .get("posts")
  .at(0)
  .and((post) => {
    post.get("title").set("Renamed");
  });
// [Ramonda lens RML008] .posts[0].and(…) — a branch returned undefined, so it was skipped.
```

| Code | Message | What it means, and what to do |
|---|---|---|
| [RML008](/reference/diagnostics#rml008-a-fork-branch-that-returned-nothing) | ``… .and(…) — a branch returned undefined, so it was skipped`` | A branch used a block body and didn't `return`. What a branch returns *is* the new value of the forked node. Use the expression form: `(post) => post.get("title").set("Renamed")`. See [forking a path](/lens/updating#several-edits-in-one-pass). |

## A key a write is refused for

| Code | Message | What it means, and what to do |
|---|---|---|
| [RML009](/reference/diagnostics#rml009-a-key-a-write-is-refused-for) | ``… targets "__proto__"`` (also `constructor`, `prototype`) | A path named one of those keys. Assigning to `__proto__` doesn't create a property — it replaces the copy's prototype. If the key came from data, that's the guard doing its job. Filter the key before building the path. |
| [RML009](/reference/diagnostics#rml009-a-key-a-write-is-refused-for) | ``… — `merge` skipped "__proto__"`` | A `merge` partial carried one of those keys — an object literal can't, but a parsed one can. The rest of the partial was written normally. |

This is the one check that is **not** compiled out of the production build; only its message
is. A guard that ran solely in development would protect the one build that was never exposed
to a request.

## The two that throw

These are errors rather than warnings, because in both cases carrying on would produce a
plausible-looking result that is quietly wrong. Both throw in development and do nothing at
all in production, so neither is control flow to rely on.

| Code | Message | What it means, and what to do |
|---|---|---|
| [RML010](/reference/diagnostics#rml010-a-chain-written-through-twice) | `This chain has already been written through` | A second write through one `focusOn`. It would compute from the original root and silently drop the first edit. Feed the result back in: `focusOn(next).…`. Or make one `and` of the edits. See [one chain, one write](/lens/updating#one-chain-one-write). |
| [RML011](/reference/diagnostics#rml011-remove-at-the-root) | ``focusOn(root).remove() has nothing to remove from`` | `remove()` with no hops. Removal needs the container holding the value, and the root has none. Focus the property or element to drop: `focusOn(state).get("home").remove()`. |

## Next

- [Walking a path](/lens/paths) — `get`, `at`, `where`, and reading.
- [Updating](/lens/updating) — the operations, and forking a path with `and`.
