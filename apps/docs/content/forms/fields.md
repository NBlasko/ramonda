---
title: Fields
description: The field tree — property access instead of string paths, everything behind $, and bind for the control.
section: Forms
order: 99.1
---

# Fields

`this.form.fields` is the shape of your values, walked by property access.

```tsx
const f = this.form.fields;

f.email;                 // a field
f.address.city;          // a field, one level down
f.contacts[0].value;     // a field inside a row
```

Nothing there is a string. `f.adress.city` is a compile error, and renaming `city` in the
schema breaks the render rather than quietly reading `undefined`.

## Everything is behind `$`

A field node is two things at once: a place to keep walking, and a thing with an API. `$`
separates them.

```tsx
f.address;         // keep walking
f.address.$;       // the API for the address object itself
f.address.city.$;  // the API for the city field
```

Which means the API is always exactly one token away, and it is the same token everywhere:

```tsx
const city = f.address.city.$;

city.value      // what it holds
city.error      // the first message, or undefined
city.errors     // all of them
city.touched    // has it been blurred
city.dirty      // has it been edited
city.path       // "address.city"
city.name       // the same, for the input's name attribute
city.set(next)  // write it
city.reset()    // back to its default
city.bind       // the attributes for a control
```

### Why one token instead of eleven names

The first version of this API was flat — `f.address.city.value`, `f.address.city.error`. It
collides with your data. A form with `contacts: { kind, value }[]` cannot say
`f.contacts[0].value`, because `value` is both a field of yours and a property of the API. So
would `name` on a person, `errors` on a report, `path` on a file picker.

Flat means eleven chances to collide, one for every member. `$` means one. And if you do have a
field literally called `$`, the type tells you so by name and `at("$")` is the way through.

```tsx
f.settings.at("$");              // a field actually named "$"
f.settings.at(keyFromRuntime);   // a key not known until runtime
```

## `bind` — the attributes for the control

```tsx
<input {...f.email.$.bind} />
```

That spread supplies `name`, `value`, `onInput`, `onBlur` and `aria-invalid`. The handlers are
built once per field and reused, so spreading it on every render does not re-attach a listener.

**The shape follows the value's type**, so `checked` and `value` cannot be swapped by accident:

| the field holds | what `bind` gives |
|---|---|
| `string` | `value` |
| `number` | `value`, `type="number"` |
| `boolean` | `checked`, `type="checkbox"` |
| `Date` | `value` as `YYYY-MM-DD`, `type="date"` |
| an object or a list | nothing — `bind` is `never`, and spreading it is a type error |

The last row is deliberate: no single control holds an object, so asking for one is a mistake
worth catching at compile time.

**What `bind` cannot check** is which element you spread it onto. `<select {...bind} />` and
`<textarea {...bind} />` both type-check, because the attributes are the same and a type cannot
see the tag. Either is fine when the field holds a string.

### Writing your own attributes

`bind` is a plain object, so anything after the spread wins:

```tsx
<input {...f.email.$.bind} className="wide" placeholder="you@example.com" autoComplete="email" />
<input {...f.age.$.bind} min={0} max={120} />
```

To do something extra on an event, call the bound handler yourself:

```tsx
<input
  {...f.email.$.bind}
  onInput={(event) => {
    f.email.$.bind.onInput(event);
    this.searchAsYouType(event);
  }}
/>
```

## Fields without `bind`

`bind` is a convenience, not a requirement. A custom control — a date picker, a rich text
editor, a set of radio buttons — reads `value` and calls `set`:

```tsx
<ColourPicker value={f.theme.$.value} onPick={(next) => f.theme.$.set(next)} />
```

`set` is the only way to write a field. Assigning to `value` throws
([RMF001](/reference/diagnostics#rmf001-a-field-was-assigned-to)) — a field node is a proxy
over a path, not a place values live, so an assignment would land nowhere and the next read
would hand back the old value.

## Labels, ids and accessibility

`bind` supplies `name`, which is what a form posts under and what a `<label for>` cannot use.
The simplest correct thing is to wrap the input:

```tsx
<label>
  Email
  <input {...f.email.$.bind} />
</label>
```

A wrapping label needs no `id` at all. If your design cannot wrap, add an `id` and a
`htmlFor` yourself — the form does not generate them, because an id has to be unique across the
whole page and only you know what else is on it.

`aria-invalid` comes from `bind` and follows the same rule the visible message does: it is set
only once the message is ready to be seen. To connect the message itself, add
`aria-describedby` pointing at your own element.
