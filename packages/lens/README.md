# @ramonda/lens

Immutable updates for deep objects, by describing a path instead of mutating a draft.

[readme:start]: #

[![npm](https://img.shields.io/npm/v/%40ramonda%2Flens)](https://www.npmjs.com/package/@ramonda/lens)
[![license](https://img.shields.io/npm/l/%40ramonda%2Flens)](https://github.com/NBlasko/ramonda/blob/main/LICENSE)

> **Status: `0.x`.** The API changes freely between releases while the design is
> being explored; from `1.0` the interfaces hold. See the
> [root README](https://github.com/NBlasko/ramonda#readme).

```sh
npm install @ramonda/lens
```

Documentation: **[ramonda.dev/lens](https://ramonda.dev/lens)**

[readme:end]: #

No dependencies, and nothing in it knows about Ramonda — it is a standalone package for immutable
updates, usable in any TypeScript or JavaScript project, in the browser or on the server.

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

## The result shares objects with the input — do not mutate either one

That sharing is the feature, and it has one consequence worth being explicit about: an
untouched branch of the result is **the same object** as in the input. So mutating one of them
mutates the other.

```ts
const next = focusOn(state).get("home").get("city").set("Niš");

next.posts.push({ id: 1, title: "x", draft: false, tags: [], author: { name: "a" } });
// `posts` was off the path, so `next.posts` IS `state.posts` — that push just
// changed the value you thought you had left behind.
```

Treat both values as read-only and go through `focusOn` for every change. The rule is the
same one that makes the `===` comparison above trustworthy: if nothing is ever mutated in
place, then a reference that did not change really does mean a value that did not change.

```ts
// what the push above should have been
const withPost = focusOn(next)
  .get("posts")
  .push({ id: 1, title: "x", draft: false, tags: [], author: { name: "a" } });
```

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
| `.set(value, opts?)` | Replaces the focused value. See *Hidden data on a value* for `opts`. |
| `.update(fn)` | Replaces it with `fn(current)`. |
| `.merge(partial)` | Copies the focused object and assigns over it. |
| `.remove()` | Drops the property or element from its container. |
| `.push(...items)` | Appends to the focused array. |
| `.insert(i, ...items)` | Inserts at a position. `i === length` appends; negative counts from the end. |
| `.and(...branches)` | Forks the path: several edits, one walk. |
| `.value()` / `.values()` | Reads: the first focused value, or all of them. |

Every write returns the new root. With no hops at all, that root is the focused value, so
`focusOn(state).set(other)` returns `other` and `focusOn(state).merge({ … })` rewrites the top
level — the whole tree is a legitimate target.

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

**A branch has to RETURN.** What a branch returns *is* the new value of the forked node, so a
block body without `return` hands back `undefined` and the branch is skipped:

```ts expect-error
focusOn(state)
  .get("posts")
  .at(0)
  .and((post) => {
    post.get("title").set("Renamed"); // ✗ nothing is returned, so nothing happens
  });
```

TypeScript rejects that, and development reports it if the types were loose enough to let it
through. The fix is the expression form — `(post) => post.get("title").set("Renamed")`.

For the same reason, a branch that ends in a **read** replaces the node with what it read.
`(post) => post.get("title").value()` returns a `string` where a `Post` was expected, so the
types normally catch it; when the focused value and the value read happen to have the same type,
they cannot. Branches are for writing.

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

### Writing where there is nothing yet

An optional property is a property TypeScript accepts, and the operations offered on it write
where nothing is:

```ts
focusOn(state).get("posts").at(0).get("labels").push("todo"); // labels?: string[] → ["todo"]
focusOn(state).get("posts").at(0).get("draft").set(true); // an absent key is created
```

`set`, `update`, `push` and `insert` all create what the last hop names — a missing or `null`
array counts as an empty one. `merge` is the exception, and the line between them is what the
operation can supply: `push` hands over a complete array, while `merge` has only a `Partial`, so
creating from it would mint a half-built object typed as a whole one.

A typo in the **middle** of a path is still reported and still changes nothing, because there the
value cannot be descended into at all. Pushing *nothing* creates nothing either: `push()` with no
items is a no-op, not an empty array.

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

## Reading

```ts
focusOn(state).get("posts").where((p) => p.id === 102).get("title").value();
// "Second post" — or undefined if the path resolves to nothing

focusOn(state).get("posts").where(Boolean).get("title").values();
// ["First post", "Second post"]
```

`value()` answers with `undefined` both when the path resolved to nothing and when it resolved
to a property that is present and holds `undefined`; the two are indistinguishable in its
result. When the difference matters, ask the container: `values().length` is `0` for a miss and
`1` for a present `undefined`.

## Diagnostics

In development, a path that cannot be reached reports itself and changes nothing — a missing
property, a `null` on the way down, an index out of range, a `where` that matched nothing.
Reads stay silent: asking for a path that does not exist is a fair question with a fair
answer.

All of it is compiled out of the production build. That covers **behaviour**, not just
messages: the double-write guard and `focusOn(root).remove()` throw in development and are a
silent no-op in production, so neither is control flow you can rely on — do not write a `try`
around either one expecting to catch something in a shipped build.

Every report also exists as a **record**, so a devtools panel, a test or a log collector can group
and filter reports instead of parsing prose. A collector installs one function; with nothing
installed the call is a single property read:

```ts
globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => {
  // { code: "RML004", scope: "ramonda/lens", severity: "warn", message, fix, data, time }
  if (record.severity === "error") myCollector.alert(record);
};
```

`globalThis` rather than an event on `window`, so it works in the browser, in Node, in a worker and
during a server render. The shape and the rules are at
[ramonda.dev/reference/diagnostics](https://ramonda.dev/reference/diagnostics#capturing-them).

### Messages you might see

Every message carries a code — `[Ramonda lens RML004] …` — followed by what to do about it. The path
in it is written the way you wrote it, `.posts.where(…).tags`, and points at the hop that failed
rather than at the whole chain. One code covers a fault *class*, so several messages share one.

| Code | Message | What happened |
|---|---|---|
| `RML001` | ``… is undefined, so … could not be reached`` | A hop mid-path is `undefined` or `null`. Only the last hop creates; a gap before it cannot be walked through. |
| `RML002` | ``… is a Map`` (or `Set`, `Date`, `WeakMap`, `WeakSet`) | A path tried to descend *into* one. Read it out, rebuild it, and `set` the result. |
| `RML005` | ``… .where(…) matched no element`` | The predicate accepted nothing, so the write had no target. |
| `RML006` | ``… is not an array, so `push` did nothing`` | The value there is not an array and is not empty either — a number, a string, an object. |
| `RML004` | ``… has N element(s), so I is not a valid insertion point`` | `insert` was given an index outside `-length … length`. |
| `RML004` | ``… has N element(s), so index I is out of range`` | `at` was given an index outside `-length … length - 1`. |
| `RML006` | ``… is not an object, so `merge` did nothing`` | `merge` needs an object to copy; it does not create one. |
| `RML008` | ``… .and(…) — a branch returned undefined`` | A branch used a block body and forgot to `return`. |
| `RML009` | ``… targets "__proto__"`` (or `constructor`, `prototype`) | A key a write is refused for — see below. |
| `RML010` | ``This chain has already been written through`` | A second write through one `focusOn`. Feed the result back in. Throws. |
| `RML011` | ``focusOn(root).remove() has nothing to remove from`` | The root has no container above it. Focus the property or element to drop. Throws. |

The full list, with what to do about each, is on
[Messages you might see](https://ramonda.dev/lens/messages).

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

## Hidden data on a value

Something may have attached a **non-enumerable symbol** to one of your objects — a cache
tagging an entry, a renderer marking a list item. That is the one way to attach something to an
object without colliding with the fields, appearing in `Object.keys`, or reaching
`JSON.stringify`. It also means a spread drops it, and a spread is what every hop here does.

So a write carries those symbols onto the copy. That is right for an **edit**: `merge`,
`update`, and a write aimed deeper all derive the new value from the old one, and something
attached to the value describes the value, not the object holding it at the time.

`set` is the exception. It is handed a value rather than deriving one, so it cannot tell a
corrected value from a different one, and giving a different thing the tag of the thing it
replaced is the worse of the two mistakes. **`set` keeps nothing unless you say so:**

```ts
focusOn(items).at(0).set(other);                            // a different value
focusOn(items).at(0).set(rebuilt, { keepSymbols: true });   // the same one, rebuilt
focusOn(items).at(0).set(rebuilt, { keepSymbols: [MINE] }); // only this one
```

`true` keeps every hidden symbol; an array keeps exactly those and drops the rest. The option
applies only to the value `set` lands on — everything above it on the path is being edited and
keeps its symbols regardless.

Enumerable symbols are not touched here: a spread already copies them, so they were never at
risk. Nothing is carried onto a frozen value; there is no way to, and that was the caller's
choice.

## Keys a write is refused for

`get` takes a `string | number`, so a key can come from data — a field name, a key off a parsed
request body — and every write ends in an assignment into the copy. `__proto__`, `constructor`
and `prototype` are refused there, in `remove`, and in a `merge` partial: assigning to
`__proto__` does not create a property at all, it runs the setter `Object.prototype` provides
and replaces the copy's prototype.

This one guard is **not** compiled out of production, unlike the diagnostics — only its message
is. A check that ran solely in development would protect the one build that was never exposed to
a request.

## Size and speed

1.50 KB gzipped, no dependencies.

`pnpm bench`, against the production build. Trials are interleaved and the median reported —
running each shape to completion in turn produced numbers that got *better* as the state got
bigger, which was the JIT, not the code.

```
three edits to one record — 5000 posts
  .and                           7.46 µs/op    1.00x
  three chains                  21.26 µs/op    2.85x

object path — 5 levels deep, 10 sibling keys per level
  set                            1.48 µs/op

object path — 5 levels deep, 100 sibling keys per level
  set                            7.54 µs/op

array path — one deep edit
  100 posts     where            1.33 µs/op
                at(i)            0.79 µs/op
  1000 posts    where            6.51 µs/op
                at(i)            1.86 µs/op
  5000 posts    where           30.38 µs/op
                at(i)            6.83 µs/op
```

What to take from it when writing your own updates:

- **Fork instead of chaining.** Three separate `focusOn` calls for three edits to one record cost
  2.85x what `and` costs, because each one re-walks and re-copies the whole prefix and throws two
  of the three results away.
- **`where` has no early exit**, by design — it matches every element. That scan is most of the
  cost on a large array: 30 µs against 7 µs on 5000 posts. When you already know the position,
  `at(i)` skips it, and the gap grows with the array.
- **Depth is cheap; width is what costs.** Five levels deep is 1.5 µs when each level has ten
  keys and 7.5 µs when each has a hundred — the copying is per level, and a level's cost is its
  own size. Nothing off the path is ever touched, at any depth.

The bigger practical difference is the one the numbers do not show: nothing here is a proxy,
so there is no draft that can escape its producer, and no finalize pass over the result.

## License

[MIT](../../LICENSE) © Nikola Blagojević
