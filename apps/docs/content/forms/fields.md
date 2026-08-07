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

A flat API — `f.address.city.value`, `f.address.city.error` — collides with your data. A form
with `contacts: { kind, value }[]` could not say `f.contacts[0].value`, because `value` would be
both a field of yours and a property of the API. The same goes for `name` on a person, `errors`
on a report, `path` on a file picker.

Flat is eleven chances to collide, one per member. `$` is one. And if you do have a field
literally called `$`, the type says so by name and `at("$")` is the way through.

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

To do something extra on an event, call the bound handler from a method of your own:

```tsx
class SignupForm extends Component {
  private form = this.use(Form<typeof schema>, () => ({ schema, defaultValues, onSubmit }));

  onEmailInput(event: Event): void {
    this.form.fields.email.$.bind.onInput(event);
    this.searchAsYouType(event);
  }

  searchAsYouType(event: Event): void {
    // your own work, after the field has taken the value
  }

  render() {
    return <input {...this.form.fields.email.$.bind} onInput={this.onEmailInput} />;
  }
}
```

A method rather than an inline arrow, because methods are auto-bound: the identity never changes, so
the listener is not removed and re-added on every render. An arrow here would be reported by
[RMD020](/reference/diagnostics#rmd020-render-produced-a-different-value-the-second-time).

## Fields without `bind`

`bind` is a convenience, not a requirement. A custom control — a date picker, a rich text
editor, a set of radio buttons — reads `value` and calls `set`:

```tsx
class Editor extends Component {
  private form = this.use(Form<typeof schema>, () => ({ schema, defaultValues, onSubmit }));

  pickTheme(next: string): void {
    this.form.fields.theme.$.set(next);
  }

  render() {
    return <ColourPicker value={this.form.fields.theme.$.value} onPick={this.pickTheme} />;
  }
}
```

`set` is the only way to write a field. **`value` is `readonly`**, so an assignment is a compile
error before it is anything else:

```
Cannot assign to 'value' because it is a read-only property. ts(2540)
```

It also throws at runtime ([RMF001](/reference/diagnostics#rmf001-a-field-was-assigned-to)), which
is what catches it in JavaScript and in a file the checker is not covering. A field node is a proxy
over a path rather than a place values live, so an assignment would land nowhere and the next read
would hand back the old value.

## A field in its own component

A design system does not want `{...f.email.$.bind}` written at every call site — it wants a
`<TextField>` that carries the label, the message and the class that turns red. A component that
takes a field needs one thing from the form, and `Field` is it:

```tsx
import { Field, type FieldNode } from "@ramonda/form";

@Host("label", (self: TextField) => ({ className: self.f.error ? "field field--invalid" : "field" }))
class TextField extends Component<{ of: FieldNode<string>; label: string }> {
  f = this.use(Field<string>, () => ({ of: this.props.of }));

  render() {
    return [<span className="field__label">{this.props.label}</span>, <input {...this.f.bind} />, this.f.error];
  }
}
```

And the call site hands over one prop, typed by the schema:

```tsx
<TextField of={f.email} label="E-mail" />
<TextField of={f.address.street} label="Street" />
```

**`Field` is required, not an optimisation.** Without it such a component never re-renders: a field
node is one cached object for the life of the form — deliberately, so `bind.onInput` keeps its
identity — so the component's props never change and the diff skips it. Its message would never
appear, and a write from anywhere else would never reach its input.

`Field` answers everything a node's `$` does — `value`, `error`, `errors`, `touched`, `dirty`, `name`,
`bind`, `set`, `reset`, and the list members for an array field — so a component written against
`FieldApi<T>` needs nothing new to learn. Name the type at the `use`: `FieldNode<T>` is a conditional
type, so `T` cannot be recovered from it by inference, and `Field<string>` is the same pin
`Query<Todo>` takes.

### The host element is the wrapper you were going to write

`@Host("label", …)` makes the component's own element the field's wrapper, so there is no extra node
in the DOM. The markup that comes out is what you would have written by hand:

```html
<label class="field">
  <span class="field__label">E-mail</span>
  <input name="email" value="">
</label>
```

That is where the class, the label and the message belong anyway, and the host props callback runs on
every render, so the class follows the message without any work.

### Defaults and variants come from the class

There is no `defaultProps`, and none is needed — a getter with a fallback is one, and a subclass
specialises it:

```tsx
class TextField extends Component<{ of: FieldNode<string>; label?: string }> {
  protected get labelText(): string {
    return this.props.label ?? "Field";
  }
}

class EmailField extends TextField {
  protected override get labelText(): string {
    return this.props.label ?? "E-mail";
  }
}
```

`@Host` is read off the class through the static chain, so a subclass inherits the wrapper and may
declare its own to restyle it.

### One keystroke, one field

Because the subscription is per path, an edit wakes the fields that changed and no others. Measured
over 300 rows through `list()`, one keystroke: **every row rebuilt, 45 ms**, before this existed;
**one row** after. Inside a list the node arrives already — `list({ as })` hands each row its own —
so a row component is the same shape:

```tsx
import { Field, type Row } from "@ramonda/form";

class Line extends Component<{ item: Row<Contact> }> {
  f = this.use(Field<string>, () => ({ of: this.props.item.field.value }));

  render() {
    return <input {...this.f.bind} />;
  }
}
```

What still re-renders on every change is the component that OWNS the form, because reaching into
`form.fields` is asking about the form. Keep that component thin — the fields, the list, the submit
button — and the work per keystroke is one field's.

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
