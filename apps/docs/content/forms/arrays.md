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
```

## Rendering rows

```tsx
<ul>
  {list({
    each: f.tags.$.rows,
    key: (row) => row.id,
    render: (row) => (
      <li>
        <input {...row.field.$.bind} />
        {row.field.$.error ? <em>{row.field.$.error}</em> : null}
      </li>
    ),
  })}
</ul>
```

`key: (row) => row.id` is the whole point. The id is generated when the row appears and stays
with it through every insert and remove, so the reconciler keeps that row's element — and with
it, whatever the browser was holding: the caret position, the selection, an open datalist.

`row.field` is a field node like any other, so everything from [Fields](/forms/fields) applies:
`$.value`, `$.error`, `$.bind`, and further property access when the row is an object.

## Rows of objects

```tsx
interface Contact {
  kind: string;
  value: string;
}
```

```tsx
{list({
  each: f.contacts.$.rows,
  key: (row) => row.id,
  render: (row) => (
    <li>
      <input {...row.field.kind.$.bind} />
      <input {...row.field.value.$.bind} />
      {row.field.value.$.error ? <em>{row.field.value.$.error}</em> : null}
    </li>
  ),
})}
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
@memoizedHandler
removeTag(id: string) {
  return () => {
    const rows = this.form.fields.tags.$.rows;
    const index = rows.findIndex((row) => row.id === id);
    if (index >= 0) this.form.fields.tags.$.remove(index);
  };
}
```

`@memoizedHandler` caches by arguments, so the same row gets the same function every render and
the listener is never re-attached.

## `rows` is stable until the list changes

`rows` hands back the same array until something structural happens — an append, an insert, a
remove, a bulk write. It is not rebuilt per render.

That is deliberate. `list()`'s `each` is what
[RMD020](/reference/diagnostics#rmd020-render-produced-a-different-value-the-second-time)
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
[RMF002](/reference/diagnostics#rmf002-the-list-members-were-used-on-a-field-that-is-not-a-list).
