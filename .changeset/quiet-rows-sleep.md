---
"@ramonda/form": minor
---

A watcher hears only about WHAT it reads, not merely where

`Field` records which of its members a component actually read, and a poke about anything else is
ignored. The case it exists for is a list: a component rendering `rows` shows each row's `id`, `index`
and `field`, and none of them move when a value inside a row does — so it now **sleeps through a
keystroke** in any of its rows, and each row wakes on its own.

Which makes the container worth watching too:

```tsx
class Rows extends Component<{ of: FieldNode<Contact[]> }> {
  f = this.use(Field<Contact[]>, () => ({ of: this.props.of }));

  render() {
    return <div>{list({ each: this.f.rows, key: (row) => row.id, as: Line })}</div>;
  }
}
```

Measured at 300 rows, one keystroke: **45 ms and every row rebuilt** with no per-field subscription,
**1.9 ms and one row** once each row watched its own field, **0.6 ms** with the container watching the
array as well — because then the three hundred list items are never diffed.

Four kinds of change, as a bitmask rather than a set of strings, since a wake happens per keystroke and
the test is a single `&`: a value moved, a touch or edit mark changed, the messages changed, or an
array changed length or order. `error` reads two of them — a message is held back until the field has
been touched, so a blur reveals one without any message having moved, and that is asserted.

The mask is never cleared, and that is what makes it sound rather than sloppy: reading a member for the
first time takes a render, and that render came from something already subscribed or from the
component's own state — so a member not in the mask cannot be affecting what is on screen.

Two corrections that came out of measuring it:

**`rows` and the array members are typed from the element now.** `Field<Contact[]>` answers
`Row<Contact>[]`, so `list({ each: f.rows, as: Line })` type-checks against a component taking
`Row<Contact>`; it was `Row<unknown>` and every call site needed a cast. `append` and `insert` take a
`Contact`, and `at(key)` answers the child's own type.

**And the docs were wrong about why the owner re-renders.** It is not "because it read `form.fields`" —
`@state` on a hook holds the owning component's rebuild from the moment the signal is built, whatever
that component goes on to read, so the owner wakes on every change and cannot opt out. What the read of
`version` inside the form actually reaches is a `@compute` deriving from a field and a `list()` item,
which are the two scopes that record a dependency.
