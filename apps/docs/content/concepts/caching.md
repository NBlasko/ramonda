---
title: One per component, or one per item
description: "`@compute` and `@memoized` both cache, and both watch the same signals. The difference is the key."
section: Lifecycle and subscriptions
order: 33
---

# One per component, or one per item

Two decorators cache a value for you, and they hold it the same way: both hand back what they
handed back last time, until a signal their body read has moved.

**`@compute` holds one value for the component.** A total, a filtered list, a flag — anything there
is exactly one of. You write it as a getter and read it as a value.

**`@memoized` holds one value per argument.** A handler for row 7, a config for the column you
hovered — anything there is one of PER ITEM. You write it as a method and call it with the id.

The difference is the **key**: `@compute` has none, `@memoized` has its arguments.

| | `@compute` | `@memoized` |
|---|---|---|
| keyed by | nothing | its arguments |
| how many values | **one per component** | **one per argument, per component** |
| you write | a getter, or a method — with no arguments | a method that takes arguments and returns the value |
| you read it as | as written — `this.total` or `this.total()` | a call — `this.rowConfig(id)` |
| when it recomputes | a signal its body read has changed | the same, and only that entry is dropped |
| when it is dropped | never, while the component lives | when a render stops asking for that argument |

## The question that decides it

**Is there one of this value per component, or one per item?**

That is the whole decision, and it has no grey area:

```tsx
class Board extends Component {
  @state rows: RowItem[] = [];
  @state filter = "";

  // ONE per component: a single number derived from the list.
  @compute
  get total() {
    return this.rows.filter((row) => row.name.includes(this.filter)).length;
  }

  // ONE PER ROW: a different handler for each id.
  @memoized
  removeFor(id: string) {
    return () => {
      this.rows = this.rows.filter((row) => row.id !== id);
    };
  }
}
```

A `@compute` cannot do the second, and not because it would be slow: it belongs to the
component, so it has exactly one slot. There is nowhere to put a value per row.

## The compiler already knows

A `@compute` caches one value per component, so it has no key and nothing can pass it an
argument. Both of its forms refuse one:

```tsx
class Board extends Component {
  @state factor = 2;

  // ✗ refused in every build: one value per component means the argument is ignored
  // @compute times(n: number) { return n * this.factor }

  // ✓ arguments are what @memoized is keyed by
  @memoized
  times(n: number) {
    return n * this.factor;
  }
}
```

`ramonda-check` reports it before the build as `compute-takes-no-arguments`, and the framework
throws when the class definition runs. The mistake this page exists for is the other direction:
writing a fresh object per row, and reaching for neither.

## `@memoized` caches a value, not only a handler

The commonest per-item value is a handler, which is why it is introduced with
[events](/concepts/events#a-handler-or-a-value-per-item). It is not limited to one. A row
that needs a stable object has the same problem and the same answer:

```tsx
import { Component, list, memoized, state } from "@ramonda/core";

class Board extends Component {
  @state rows: RowItem[] = [];

  @memoized
  configFor(id: string) {
    return { id, href: `/rows/${id}` };
  }

  render() {
    return <ul>{list(this.rows, (row) => <RowView key={row.id} cfg={this.configFor(row.id)} />)}</ul>;
  }
}
```

Written inline, that object is new on every render, so `RowView` re-renders every time and
a development build reports it (`RMD020`, and `RMD022` for the same thing in a hook's props
callback). Their advice names `@memoized` for exactly this case, because nothing else
reaches it: a `@compute` is one per component, and a field or a module constant cannot vary
per row.

## What they share

**Both watch the signals their body read.** Whatever a `@compute` getter or a `@memoized`
builder reads while it runs is recorded, and a write to any of it invalidates what was
built from it — a `@compute` recomputes, and `@memoized` drops that one entry so the next
call builds it again.

This is the part that makes them feel like one thing. It is machinery they happen to share,
not what tells them apart.

**Both freeze what they captured.** A value read *before* the return is closed into the
result:

```tsx
@memoized
removeFor(id: string) {
  const mode = this.mode;              // read while BUILDING
  return () => this.apply(mode, id);   // frozen into this handler
}
```

That is watched, so it is not stale — but it is worth knowing which reads count as the
builder's. [What the cache is allowed to remember](/concepts/events#what-the-cache-is-allowed-to-remember)
has the detail.

## The arguments have to be keyable

`@memoized` builds its key from the arguments, so they must be strings, numbers or
booleans. An object has no stable form to build a key out of, and a development build
throws rather than silently giving up the memoisation. Pass the id, or the index the
list's mapper already hands you.

## When neither

A value that never varies is not a cache problem. A field, or a module constant, says so
more plainly and costs nothing:

```tsx
const COLUMNS = ["name", "email", "role"];
```

## Next

- [Derived values](/concepts/compute) — `@compute` on its own.
- [A handler, or a value, per item](/concepts/events#a-handler-or-a-value-per-item) — `@memoized` on its own.
