---
title: Array fields
description: Rows that keep their identity across an insert or a remove — so an error, a focus and a DOM node stay with the row they belong to.
section: Forms
order: 99.3
---

# Array fields

A list of tags, a table of line items, a set of contacts. The hard part is not adding rows —
it is that **a row's identity is not its index**.

Remove the first row and every index below it shifts by one. If a row's error message, its
focus, its scroll position or its DOM node are filed under the index, they all slide onto the
row beneath. Nothing throws. The page just quietly shows the wrong row's error.

So an array field hands out **rows**, and each row carries an id.

```tsx
const tags = this.form.fields.tags.$;

tags.length            // how many
tags.rows              // [{ id, index, field }, …]
tags.append("new")     // add at the end
tags.insert(1, "new")  // add at an index
tags.remove(0)         // drop one
tags.move(2, 0)        // reorder, identity and all
```

`move` is a method rather than something you write yourself, and the reason is the id. `remove` then
`insert` mints a **new** one, so the reconciler sees a different row, throws its element away and
builds another — losing the caret, the selection, and any scroll inside it. `move` carries the value
and the id together, in one operation.

Out of range is a no-op, and so is a move to the same index: a reorder that did not happen must not
cost every row its identity.

## Rendering rows

```tsx
<ul>
  {list(f.tags.$.rows, (row) => (
    <li key={row.id}>
      <input
        aria-label="Tag"
        name={row.field.$.name}
        value={row.field.$.inputValue}
        oninput={row.field.$.oninput}
        onblur={row.field.$.onblur}
        aria-invalid={row.field.$.invalid}
      />
      {row.field.$.error ? <em>{row.field.$.error}</em> : null}
    </li>
  ))}
</ul>
```

**No key.** A row object *is* rebuilt whenever its position changes, so the object alone cannot
say which row is which after an insert or a remove. `row.id` can — it is generated when the row
appears and stays with it — and [`list()`](/lists) finds it on its own: the incoming rows are
aligned against the ones on screen by what they still have in common, and the id is the thing
they have in common. `row.index` restates the position, so it is deliberately ignored.

The reconciler therefore keeps each surviving row's element, and with it whatever the browser was
holding: the caret position, the selection, an open datalist. Writing `key={row.id}` is still
allowed and does no harm; it is simply not needed here.

`row.field` is a field node like any other, so everything from [Fields](/forms/fields) applies:
`$.value`, `$.error`, `$.inputValue`, `$.oninput`, and further property access when the row is an object.

## Rows of objects

```tsx
interface Contact {
  kind: string;
  value: string;
}
```

```tsx
{list(f.contacts.$.rows, (row) => (
    <li key={row.id}>
      <input
        aria-label="Kind"
        name={row.field.kind.$.name}
        value={row.field.kind.$.inputValue}
        oninput={row.field.kind.$.oninput}
        onblur={row.field.kind.$.onblur}
        aria-invalid={row.field.kind.$.invalid}
      />
      <input
        aria-label="Value"
        name={row.field.value.$.name}
        value={row.field.value.$.inputValue}
        oninput={row.field.value.$.oninput}
        onblur={row.field.value.$.onblur}
        aria-invalid={row.field.value.$.invalid}
      />
      {row.field.value.$.error ? <em>{row.field.value.$.error}</em> : null}
    </li>
  ))}
```

`f.contacts[0].value` reaches the same field by index, and hands back the same node object —
`f.contacts.$.rows[0].field` and `f.contacts[0]` are one and the same.

Note what this shape would have cost with a flat API: `value` is a field of `Contact` **and**
would have been a member of the field API. That collision is the reason everything sits behind
[`$`](/forms/fields#everything-is-behind).

## Where the ids come from

They are generated and held alongside the data, then spliced with it — not derived from the
values.

Deriving them cannot work. A `WeakMap` cannot key a primitive, so `["a", "b", "a"]` has no
identity to borrow, and using the value itself makes the two `"a"` rows the same row. Using the
index is the failure this whole page is about.

Each array numbers its own rows, so an id does not depend on which array you happened to read
first. That matters for [server rendering](/forms/server): the server and the browser have to
agree on every key, or hydration throws the rows away and rebuilds them.

## Handlers per row

A handler built from an index points at the wrong row one render later. Build it from the id:

```tsx
@memoized
removeTag(id: string) {
  return () => {
    const rows = this.form.fields.tags.$.rows;
    const index = rows.findIndex((row) => row.id === id);
    if (index >= 0) this.form.fields.tags.$.remove(index);
  };
}
```

`@memoized` caches by arguments, so the same row gets the same function every render and
the listener is never re-attached.

## A rule about one row

A validation rule inside a row often needs another field of *that same row* — "if `kind` is an email,
`value` has to look like one". In bguard that is `ctx.sibling`, which asks the parent rather than
naming the way back down to it:

```ts
contacts: array(
  object({
    kind: string(),
    value: string().custom((received, ctx) => {
      if (ctx.sibling((row: Contact) => row.kind) === "email" && !received.includes("@")) {
        ctx.addIssue("an email address", received, "u:not-email");
      }
    }),
  }),
),
```

The row's index never appears, so the rule is right whatever position the row is at and stays right
when rows move. The message lands on `value`, which is the field the reader has to fix.

**What it saves you from is `ctx.ref("contacts." + index + ".kind")`** — an absolute path rebuilt by
hand, which means reading the row's position out of the rule's own internals, interpolating it into a
string, and having nothing check the result. `sibling` takes the same two forms as
[`ref`](/forms/validation#cross-field-rules): a callback the compiler checks, or a string for a name
known only at runtime. Either way it records the absolute path it resolved to, so a read of `kind`
from row 0 is `contacts.0.kind` — exactly what the rebuilt version would have produced, and it flows
through [`unknownRefPaths`](/forms/bguard) the same way.

## A rule about the whole list

"At least two players" is a rule about the list, not about any row, so it goes on the array, and its
message is read off the array's own `$`:

```tsx
import { Component } from "@ramonda/core";
import { Form } from "@ramonda/form";
import { array, object, string } from "bguard";

const schema = object({
  players: array(string()).custom((received, ctx) => {
    if (received.length < 2) ctx.addIssue("at least two players", received, "u:too-few");
  }),
});

class Entry extends Component {
  form = this.use(Form<typeof schema>, () => ({
    schema,
    defaultValues: { players: [] },
    onSubmit: () => {},
  }));

  render() {
    const players = this.form.fields.players.$;
    return (
      <form onsubmit={this.form.submit}>
        <button type="button" onclick={this.add}>Add a player</button>
        {players.error ? <p role="alert">{players.error}</p> : null}
        <button type="submit">Start</button>
      </form>
    );
  }

  add(): void {
    this.form.fields.players.$.append("");
  }
}
```

An array has `error`, `errors` and `issues` like any field, and no `invalid` — that one is a
control's `aria-invalid`, and a list is not a control. Its message waits like a leaf's does, and
adding or removing a row does not count as touching it: measured, `error` stays empty through an
`append` and appears on the first submit.

## `rows` is stable until the list changes

`rows` hands back the same array until something structural happens — an append, an insert, a
remove, a bulk write. It is not rebuilt per render.

That is deliberate. `list()`'s `each` is what
[RMD020](/reference/diagnostics/rmd020)
compares, and a freshly built array on every render is a changed value: every row would be
re-keyed and the identity the ids exist to protect would be lost to the thing meant to preserve
it.

## Writing the array as a whole

```tsx
f.tags.$.set(["a", "b", "c"]);
```

Rows that were already there keep their ids; the array is topped up rather than renumbered, so
a bulk write does not make surviving rows look new.

## An absent list

A field whose value is `undefined` or `null` reads as an empty list — `length` is `0` and
`rows` is empty — so a form whose defaults have not filled in an optional array renders zero
rows instead of throwing. `append` on it builds the array.

A field that holds something that is *not* a list is a mistake worth hearing about: see
[RMF002](/reference/diagnostics/rmf002).

## Next

- [Forms on the server](/forms/server) — why a row's identity has to match on both sides, and how
  it does.
- [Rendering lists](/lists) — the same identity question outside a form.
