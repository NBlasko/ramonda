---
title: watchProp
description: Run a method when a prop you name changes — before the render, so what it derives is on screen in the same pass.
section: Reference
order: 121
---

# `@watchProp`

Some values have to be *worked out* from a prop rather than read from it: a draft that resets when
the record changes, a request that starts over when the id does. `@watchProp` names the prop and
runs a method when it moves.

## The situation it is for

A note editor. Its parent hands it a different `userId` when the reader picks another colleague —
the same component instance, a new subject:

```tsx
class Editor extends Component<{ userId: string }> {
  @state draft = "";

  @watchProp((p: { userId: string }) => p.userId)
  reset() {
    this.draft = "";
  }
}
```

Without the watcher the draft survives the switch, and the reader sees the note they were writing
about someone else under the new name. The method runs **before the render**, so the empty box is
what reaches the page — there is no pass where the two are on screen together.

## What the selector is

A function from props to the value you care about, not a string — so it can go as deep as you like
and the compiler checks every step:

```tsx
class Results extends Component<{ filters: { value: string }[] }> {
  @state query = "";

  @watchProp((p: { filters: { value: string }[] }) => p.filters[0].value)
  onValue(next: readonly [string]) {
    this.query = next[0];
  }
}
```

**It is typed from the class the decorator sits on**, so `p.usreId` is a compile error that names
the typo.

The method's own parameters are a **`readonly` tuple** — one slot per selector, in the order they
were written — and they still need annotating: a decorator cannot type the signature it decorates.
Take only what you use; a method that reads neither declares neither.

## Watching several props

The method runs **once** when any of them moves, and both arrays carry every value:

```tsx
class Rows extends Component<{ userId: string; page: number }> {
  @state page = 1;

  @watchProp(
    (p: { userId: string }) => p.userId,
    (p: { page: number }) => p.page,
  )
  refetch(next: readonly [string, number], previous: readonly [string, number]) {
    if (next[0] !== previous[0]) this.page = 1;
  }
}
```

A selector whose value did not move keeps it in **both** arrays, so `previous[i] === next[i]` is how
the method tells which one changed.

Do not reach for one selector returning an array to get the same effect. Comparison is `Object.is`,
so a fresh array is never equal to the last one and the method would fire on every props change with
`next` and `previous` holding the same contents.

## It does not run at mount

The values are recorded when the component mounts, and compared from then on. So a watcher fires on
the first *change*, never on the first render — which is what makes it safe to write a reset in one.
Work that has to happen at mount belongs in [`@created`](/concepts/lifecycle).

## What it refuses

**No selectors.** `@watchProp()` is a compile error, because the type takes a non-empty list. In a
build with no types it throws instead, naming what to write.

**Anything but a method.** It reacts by calling something; a field has nothing to call.

**A selector that fails.** A selector runs on every props change and has to be total — no assertions,
no lookup that can throw. One that throws is reported as
[`RMD038`](/reference/diagnostics/rmd038) and returns `undefined`, which the watcher then reads as a
change that never happened. Guard the path as you drill into it: `p.foo?.[5]?.bar`.

## What it costs, and when not to reach for it

Comparison is `Object.is` per selector and nothing is compared deeply, so the cost is one identity
check per selector per props change. That is also the limit: select the *value*, not an object
around it.

Reach for something else in three cases:

- **You want a derived value, not an action.** [`@compute`](/concepts/compute) gives you one that
  caches on what it read, with no method and no state to keep in step.
- **You want to touch the DOM after the page updated.** That is
  [`@updated`](/concepts/lifecycle) — `@watchProp` runs before the render, so the DOM it would see
  is the old one.
- **The value is not a prop.** `@watchProp` sees props and nothing else. For state or a hook's
  value, `@updated` plus one comparison is the answer.

**On a hook it watches the HOOK's props** — the bag its `this.use()` callback produced, not the
props of the component that mounted it.

## Next

- [Props](/concepts/props) — where props come from, and why every one is a signal.
- [`@compute`](/concepts/compute) — the derived value, when you do not need a method.
- [Lifecycle](/concepts/lifecycle) — `@created`, `@mounted`, `@updated`, `@destroyed`, and why there
  is no post-commit `@watchProp`.
