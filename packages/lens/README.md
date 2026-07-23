# @ramonda/lens

Immutable updates for deep objects, by describing a path instead of mutating a draft.

```ts
import { focusOn } from "@ramonda/lens";

const next = focusOn(state)
  .get("posts")
  .where((post) => post.id === 102)
  .get("tags")
  .where((tag) => tag === "draft")
  .set("published");
```

`state` is untouched. `next` shares every object that was not on the path — `state.users`,
`state.posts[0]`, the `"ssr"` tag — and has a new object for each of the four levels that
were: the root, `posts`, `posts[1]`, and `posts[1].tags`.

No proxies. Nothing is read, copied or wrapped until a terminal operation runs; the chain
only records where to go.

## Why the shape of the result matters

A consumer that compares with `===` — a VDOM diff, a memo, a store subscriber — can reject
an untouched branch without looking inside it. That only works if untouched really means
identical, which is the guarantee this package exists to provide:

```ts
next.users === state.users; // true
next.posts[0] === state.posts[0]; // true
next.posts[1] !== state.posts[1]; // it was edited
```

It holds in the other direction too. A write whose value is already there produces **no
copies at all** and returns the original root:

```ts
focusOn(state).get("title").set(state.title) === state; // true
```

So does a `merge` of unchanged fields, and an `update` that returns its input. A no-op
cannot invalidate the path above it.

Setting a key that is not there yet **creates it** — `draft?: boolean` is a key TypeScript
accepts, so refusing it at runtime would make the API disagree with its own types. A typo in the
MIDDLE of a path is still reported and still changes nothing, because there the value cannot be
descended into at all.

## API

Start with `focusOn(root)`, walk with `get` / `at` / `where`, finish with an operation.

**Walking**

| | |
|---|---|
| `.get(key)` | Descends into a property. |
| `.at(index)` | Descends into one element. Negative counts from the end. |
| `.where(pred)` | Descends into **every** element the predicate accepts. |

Array methods exist only when the focused value is an array, so `.where()` on an object is
a compile error at the call site rather than a runtime miss.

**Finishing**

| | |
|---|---|
| `.set(value)` | Replaces the focused value. |
| `.update(fn)` | Replaces it with `fn(current)`. |
| `.merge(partial)` | Copies the focused object and assigns over it. |
| `.remove()` | Drops the property or element from its container. |
| `.push(...items)` | Appends to the focused array. |
| `.insert(i, ...items)` | Inserts at a position. `i === length` appends. |
| `.and(...branches)` | Forks the path: several edits, one walk. |
| `.value()` / `.values()` | Reads: the first focused value, or all of them. |

Every write returns the new root.

### `where` matches all of them

This is the part that differs most from writing the update by hand:

```ts
// Every draft post gets the title, in ONE walk. `posts` is copied exactly once
// no matter how many matched, and the posts that did not match keep identity.
focusOn(state)
  .get("posts")
  .where((post) => post.draft)
  .get("title")
  .set("TODO");
```

`remove` follows the same rule — `where(…).remove()` drops every match in one pass.

Because it matches all, `where` cannot stop early. When you know the position, `at(i)` skips
the scan and is measurably cheaper on large arrays.

### Several edits in one pass

A chain describes one path. `and` forks it: each branch walks on from that value and returns the
new version of it.

```ts
focusOn(state)
  .get("posts")
  .where((post) => post.id === 102)
  .and(
    (post) => post.get("title").set("Renamed"),
    (post) => post.get("tags").push("published"),
  );
```

**Everything above the fork is copied once, not once per branch** — that is the reason it exists
rather than feeding each result into a new `focusOn`. Branches run in order and each sees the
previous one's result, so two branches may touch the same value without one silently winning.
Forks nest, and a fork under `where` applies to every match.

For several fields of the same object, `merge` is shorter. Reach for `and` when the branches go
to different depths, or need different operations.

### Narrowing is explicit

```ts
focusOn(state)
  .get("values")
  .where<string>((v) => typeof v === "string")
  .update((v) => v.toUpperCase()); // v is string
```

There is deliberately no overload that infers a type guard from the predicate. Since
TypeScript 5.5 a plain arrow gets a type predicate inferred for it, which made
`where(tag => tag === "js")` on a `string[]` focus the literal type `"js"` — and the natural
next line, `.set("ts")`, failed to compile. The narrowing nobody asked for broke the write it
was meant to serve.

## One chain, one write

Hops return new chain objects, so sharing a prefix to **read** is fine:

```ts
const posts = focusOn(state).get("posts");
posts.where((p) => p.draft).values();
posts.where((p) => p.id === 1).value();
```

Writing through the same `focusOn` twice is not, and throws in development:

```ts
const posts = focusOn(state).get("posts");
posts.at(0).get("title").set("one");
posts.at(1).get("title").set("two"); // throws
```

`focusOn(root)` captures `root` once, so the second write is computed from the **original**
value and silently discards the first edit. The result looks plausible and is missing a
change, which is much harder to find than a throw. Feed the result back in instead:

```ts
const afterFirst = focusOn(state).get("posts").at(0).get("title").set("one");
const afterSecond = focusOn(afterFirst).get("posts").at(1).get("title").set("two");
```

## Diagnostics

In development, a path that cannot be reached reports itself and changes nothing — a missing
property, a `null` on the way down, an index out of range, a `where` that matched nothing.
Reads stay silent: asking for a path that does not exist is a fair question with a fair
answer.

All of it is compiled out of the production build, along with the double-write guard.

## Class instances, and what cannot be traversed

Copies preserve the prototype and copy descriptors, so a class instance stays an instance and
a getter stays a getter:

```ts
focusOn(state).get("settings").get("theme").set("light");
// state.settings is still a Settings, and settings.describe() still works
```

`Map`, `Set` and `Date` are fine as **values** — `set(new Date())` stores one like any other
leaf. Paths cannot descend *into* one: their contents live in internal slots that a copy
cannot reach, so a chain that tries reports it and changes nothing.

## Size and speed

1.19 KB gzipped, no dependencies.

`node bench/against-immer.mjs`, against the production build. Trials are interleaved and the
median reported — running each contender to completion in turn produced numbers that got
*better* as the state got bigger, which was the JIT, not the code.

```
three edits to one record — 5000 posts
  focusOn .and                   7.95 µs/op    1.00x
  focusOn x3 chains             21.68 µs/op    2.73x
  immer                         14.49 µs/op    1.82x

object path — 5 levels deep, 10 sibling keys per level
  focusOn                        1.58 µs/op    1.00x
  immer                          4.93 µs/op    3.11x

object path — 5 levels deep, 100 sibling keys per level
  focusOn                        8.06 µs/op    1.00x
  immer                         10.58 µs/op    1.31x

array path — 5000 posts x 20 tags, one deep edit
  focusOn (where)               30.63 µs/op    1.00x
  focusOn (index known)          7.00 µs/op    0.23x
  immer (index known)           10.99 µs/op    0.36x
  immer (.find)               1804.57 µs/op   58.91x
```

Read those honestly:

- **`and` closes the one gap immer had.** Several edits in one pass was the thing a single chain
  could not express, and doing it with three chains cost 2.7x — worse than immer. Forking is
  1.8x faster than immer instead, because the prefix is walked once.
- **On like-for-like paths the gap is modest** — 1.3x to 3.1x on deep objects, 1.6x on a large
  array when both sides know the index. Both libraries copy only what is on the path, so the
  copying costs the same; what differs is per-hop overhead.
- **The 66x row is not "immer is slow"** — it is the cost of scanning *through* a proxy.
  `draft.posts.find(…)` drafts every element it touches, so a 5000-element search allocates
  5000 proxies. It is the idiom a person naturally reaches for, which is what makes it worth
  showing, but the comparison it belongs to is the `index known` row above it.
- **`where` has no early exit**, by design — it matches all elements. On 5000 posts that scan
  is most of the 28 µs; `at(i)` costs 7 µs.

The bigger practical difference is the one the numbers do not show: nothing here is a proxy,
so there is no draft that can escape its producer, and no finalize pass over the result.
