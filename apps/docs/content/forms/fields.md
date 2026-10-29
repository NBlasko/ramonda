---
title: Fields
description: The field tree — property access instead of string paths, everything behind $, and the attributes a control is written with.
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

// and, for a field one control holds, what that control is written with:
city.inputValue // the value as the control shows it
city.invalid    // whether it has a message, for aria-invalid
city.oninput    // the control's own handler, which writes the field
city.onblur     // marks it touched
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

## Writing a control

A control is written with five attributes, each by name:

```tsx
const email = f.email.$;

<input
  aria-label="Email"
  name={email.name}
  value={email.inputValue}
  oninput={email.oninput}
  onblur={email.onblur}
  aria-invalid={email.invalid}
/>;
```

`oninput` and `onblur` are built once per field and reused, so writing them on every render does not
re-attach a listener. Every attribute is there to read where the control is, and `@ramonda/check`
sees that none is missing.

**What you write follows the value's type:**

| the field holds | the control |
|---|---|
| `string` | `value={x.inputValue}` — any control but the two that hand back a number, a checkbox and a file input; `type="date"` for a date written as text, which starts at `""` |
| `number` | `type="number" value={x.inputValue}` — `""` for an emptied field; or `type="range"`, a slider |
| `boolean` | `type="checkbox" checked={x.value === true}` — a value not set yet, or cleared by a reset, is an unticked box |
| `Date` | `type="date" value={x.inputValue}` — the day, as `YYYY-MM-DD`; emptied, it holds nothing — `null` where the form was handed `null` for it |
| an object or a list | no control holds one: its `$` has no `oninput`, and writing it is a type error |

`inputValue` is typed by the value (`InputValue<T>`), so a `Date` handed to `value` directly is a
compile error rather than a field that shows nothing. A number shows as `FormNumber`, a date as
`FormDay` and text as `FormText` — a `number` and two `string`s, marked for `ramonda-check`, which
reads the mark below.

The `type` is what turns an edit back into the value: `type="number"` and `type="range"` hand back a
number — whatever the field held, as an empty field could be waiting for a number or text alike — a
checkbox true or false, `type="date"` what the next paragraph says, and any other control text. So the control has to match the field: a number field written
without its `type` fills the form with text, and a text field in a slider fills it with a number.
`ramonda-check` reports either before it ships, as [`form-value-in-the-wrong-control`](/reference/check),
and [`RMF005`](/reference/diagnostics/rmf005) reports them in a running page once the field holds a value.

`type="date"` serves two kinds of field, a `Date` and a date written as text (`"2026-10-29"`, a JSON
Schema `format: "date"`), and the value the field holds tells them apart: text gets the control's text
back, and a `Date` or nothing gets a day. So a date written as text starts at `""` — in `defaultValues`,
or in the row you `append` — and a `Date` emptied holds nothing rather than `""`. Where it starts is the
author's to write: neither `ramonda-check` nor `RMF005` can tell a date written as text that starts with
nothing from a `Date`, and it takes a day on the first pick.

### A choice lives on `<Select>`

Every other control holds its own value. A select's value is which of its **children** is chosen, so
`<select>` is a type error and you write `<Select>`. The options stay ordinary tags:

```tsx
import { Select } from "@ramonda/core";

<Select aria-label="Choice" value={this.choice} onchange={this.pick}>
  <option value="a">A</option>
  <option value="b">B</option>
</Select>;
```

`<Select>` takes everything a `<select>` takes — `className`, `disabled`, `name`, `data-`, `aria-`,
every event — and passes it straight through to the element.

The reason the plain tag is refused is that `selected` on an option does not say one thing. HTML
keeps the later of two `selected` options and gives a select with none the first option it holds, so
what the attribute means depends on the order the options reach the select. You never write that
order. `value` on the select is settled once the options are there and competes with nothing.

A `multiple` select takes a list, and keeps every value in it:

```tsx
import { Select } from "@ramonda/core";

<Select multiple aria-label="Tags" value={this.picked} onchange={this.pickMany}>
  {this.all.map((v) => (
    <option key={v} value={v}>
      {v}
    </option>
  ))}
</Select>;
```

On a server-rendered page the choice arrives as `selected` on the chosen option, because that is
where HTML keeps it and a select has no `value` attribute to carry. The reader sees the right option
before any script runs.

**`value` is the model's; `defaultValue` is where the field starts.** A field with `value` shows what
the model holds: its own handler writes the model, and the field shows the model again in the same
event, before the event bubbles to anything around it — so a handler that does not take an edit leaves the
field as it was, its caret and its selection where the edit found them, and a field with no handler of its
own cannot be changed. A word typed through an input method — Japanese, Chinese, an Android
keyboard, an accent on a Mac — reaches the handler at every step, `isComposing` saying it is not
finished, so a search typed on any device runs as the user types; the field is not written until the
word ends. A handler that waits for the finished word returns while `isComposing`, and is handed the
word once when it ends, in every browser. A field whose text is read when the form is sent, rather than held in state, takes
`defaultValue` instead: it shows that first and then belongs to the user, and a form's reset returns
to it.

```tsx
<TextArea aria-label="Draft" value={this.draft} oninput={this.onInput} />;   // held by the model
<TextArea aria-label="Notes" name="notes" defaultValue={this.saved} />;       // the user's, sent with the form
```

What a field shows is set through the model, never by sending the field an event. A value known at
the start is the field's initial state, `@state accepted = true`; one learned on mount is written in
`@mounted`, `this.draft = this.saved`. A field learns its model through render, and the work a
commit runs — `@mounted`, `@updated`, `render()` — is still running when an edit sent from there
arrives, so [`field-set-by-an-event`](/reference/check) reports one before it ships and
[`RMD062`](/reference/diagnostics/rmd062) when it runs.

### Refusing or rewriting an edit — the handler decides

A field's handler decides each edit by what it writes: the edit, to take it; something else, to
rewrite it; nothing, to refuse it. The field shows the model in the same event, before anything
around it reads it — so a refused keystroke is never drawn, and the caret and the selection go back
where the edit found them.

```tsx
import { Component, state, type EventOn } from "@ramonda/core";

class Phone extends Component {
  @state phone = "";

  typed(event: EventOn<HTMLInputElement, InputEvent>) {
    if (event.isComposing) return;
    const text = event.currentTarget.value;
    if (/^\d*$/.test(text)) this.phone = text;
  }

  render() {
    return <input aria-label="Phone" value={this.phone} oninput={this.typed} />;
  }
}
```

A handler that refuses or rewrites waits for the finished word: it returns while `isComposing`, and
is handed the word once, when it ends. One that took the first steps of a word and refused the rest
would keep a reading the input method had not finished — `abに` for `ab日本` — in the model.

The handler is handed the edit's own `input`. Typed `EventOn<HTMLInputElement, InputEvent>`, it reads
what the edit was — `event.inputType`: `insertText`, `deleteContentBackward`, `insertFromPaste` — and
where the caret is, `event.currentTarget.selectionStart`, which is what a mask needs. A rewrite that
keeps the text's length keeps the caret where it was; after one that changes the length, where the
caret belongs is the app's to say.

### `TextArea` — a `<textarea>` keeps its value inside the element

HTML gives a textarea no `value` attribute — the value is the element's **text** — so `<textarea>` is
a type error and you write `<TextArea>`:

```tsx
import { TextArea } from "@ramonda/core";

<TextArea aria-label="Draft" value={this.draft} oninput={this.onInput} />;
```

It renders `<textarea>a draft</textarea>`, so a server-rendered page shows the text before any script
runs, and it passes everything else through to the element.

### A checkbox's third state

`indeterminate` is a property and not an attribute — HTML has nowhere to write it — so it works on
the client and a server-rendered page cannot carry it:

```tsx
<input
  type="checkbox"
  aria-label="Select all"
  checked={this.all}
  indeterminate={this.some && !this.all}
  oninput={this.toggleAll}
/>
```

The box arrives unchecked and becomes mixed when the page hydrates. There is no way around that; it
is what HTML offers.

### Writing your own attributes

Everything else is written beside the five, as on any element:

```tsx
const email = f.email.$;
const age = f.age.$;

<input
  aria-label="Email"
  name={email.name}
  value={email.inputValue}
  oninput={email.oninput}
  onblur={email.onblur}
  aria-invalid={email.invalid}
  className="wide"
  placeholder="you@example.com"
  autocomplete="email"
/>;
<input
  aria-label="Age"
  type="number"
  name={age.name}
  value={age.inputValue}
  oninput={age.oninput}
  onblur={age.onblur}
  aria-invalid={age.invalid}
  min={0}
  max={120}
/>;
```

To do something extra on an event, call the field's handler from a method of your own:

```tsx
class SignupForm extends Component {
  private form = this.use(Form<typeof schema>, () => ({ schema, defaultValues, onSubmit }));

  onEmailInput(event: Event): void {
    this.form.fields.email.$.oninput(event);
    this.searchAsYouType(event);
  }

  searchAsYouType(event: Event): void {
    // your own work, after the field has taken the value
  }

  render() {
    const email = this.form.fields.email.$;
    return (
      <input
        aria-label="Email"
        name={email.name}
        value={email.inputValue}
        oninput={this.onEmailInput}
        onblur={email.onblur}
        aria-invalid={email.invalid}
      />
    );
  }
}
```

A method rather than an inline arrow, because methods are auto-bound: the identity never changes, so
the listener is not removed and re-added on every render. An arrow here would be reported by
[RMD020](/reference/diagnostics/rmd020).

### The node types — `LeafNode`, `ObjectNode` and `ArrayNode`

A node's shape follows the value's, and each carries a different `$`.

| the value | the node | its `$` |
|---|---|---|
| a string, number, boolean or `Date` | `LeafNode<T>` | `LeafApi<T>` — a `FieldApi` plus `inputValue`, `invalid`, `oninput`, `onblur` |
| an object | `ObjectNode<T>` | `FieldApi<T>`, with the properties beside it |
| an array | `ArrayNode<E, T>` | `ArrayApi<E, T>` — a `FieldApi` plus `length` and `rows` |

`FieldTarget<T>` is the smallest of them: anything with a `$`. Take it when you write a component
that accepts a field without caring which kind — that is what
[a field in its own component](#a-field-in-its-own-component) does.

**A schema with a property named `$` gets `Collision` instead of a node**, and the type carries its
own explanation so the compiler prints it: the error names `.$.at('$')` and the option of renaming,
rather than saying that some property does not exist on some type.

## Controls that are not an `<input>`

A custom control — a date picker, a rich text editor, a set of radio buttons — reads `value` and
calls `set`:

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

It also throws at runtime ([RMF001](/reference/diagnostics/rmf001)), which
is what catches it in JavaScript and in a file the checker is not covering. A field node is a proxy
over a path rather than a place values live, so an assignment would land nowhere and the next read
would hand back the old value.

## A field in its own component

A design system does not want the five attributes written at every call site — it wants a
`<TextField>` that carries them once, with the label, the message and the class that turns red. A component that
takes a field needs one thing from the form, and `Field` is it:

```tsx
import { Field, type FieldNode } from "@ramonda/form";

class TextField extends Component<{ of: FieldNode<string>; label: string }> {
  f = this.use(Field<string>, () => ({ of: this.props.of }));

  render() {
    return (
      <label className={this.f.error ? "field field--invalid" : "field"}>
        <span className="field__label">{this.props.label}</span>
        <input
          name={this.f.name}
          value={this.f.inputValue}
          oninput={this.f.oninput}
          onblur={this.f.onblur}
          aria-invalid={this.f.invalid}
        />
        {this.f.error}
      </label>
    );
  }
}
```

And the call site hands over one prop, typed by the schema:

```tsx
<TextField of={f.email} label="E-mail" />
<TextField of={f.address.street} label="Street" />
```

**`Field` is required, not an optimisation.** Without it such a component never re-renders: a field
node is one cached object for the life of the form — deliberately, so `oninput` keeps its
identity — so the component's props never change and the diff skips it. Its message would never
appear, and a write from anywhere else would never reach its input.

`Field` answers everything a node's `$` does — `value`, `error`, `errors`, `touched`, `dirty`, `name`,
`inputValue`, `invalid`, `oninput`, `onblur`, `set`, `reset`, and the list members for an array field — so a component written against
`FieldApi<T>` needs nothing new to learn. Name the type at the `use`: `FieldNode<T>` is a conditional
type, so `T` cannot be recovered from it by inference, and `Field<string>` is the same pin
`Query<Todo>` takes.

### The wrapper is the one you were going to write

The `<label>` is the component's own markup, so there is no extra node in the DOM. What comes out is
what you would have written by hand:

```html
<label class="field">
  <span class="field__label">E-mail</span>
  <input name="email" value="">
</label>
```

That is where the class, the label and the message belong anyway — and the class sits on the element
it styles, so it follows the message on every render without any work.

### Defaults come from the class, variants from a component

There is no `defaultProps`, and none is needed — a getter with a fallback is one:

```tsx
class TextField extends Component<{ of: FieldNode<string>; label?: string }> {
  protected get labelText(): string {
    return this.props.label ?? "Field";
  }
}
```

A **variant** is a component that fills the props in, and it costs nothing: what lands on the page
is what `TextField`'s render returned, with no wrapper element around it.

```tsx
class EmailField extends Component<{ of: FieldNode<string> }> {
  render() {
    return <TextField of={this.props.of} label="E-mail" />;
  }
}
```

### One keystroke, one field

Because the subscription is per path, an edit wakes the fields that changed and no others. Measured
over 300 rows, one keystroke rebuilds **one row**; without a per-field subscription the same
keystroke rebuilds all 300, at **45 ms**. Inside a list the node arrives already —
`list(rows, (item) => <Row item={item} />)` hands each row its own — so a row component is the same
shape:

```tsx
import { Field, type Row } from "@ramonda/form";

class Line extends Component<{ item: Row<Contact> }> {
  f = this.use(Field<string>, () => ({ of: this.props.item.field.value }));

  render() {
    return (
      <input
        aria-label="Contact"
        name={this.f.name}
        value={this.f.inputValue}
        oninput={this.f.oninput}
        onblur={this.f.onblur}
        aria-invalid={this.f.invalid}
      />
    );
  }
}
```

### A watcher hears only about what it reads

`Field` records which members you actually read and ignores anything else. A component rendering a
list reads `rows` — and a row's `id`, `index` and `field` do not move when a value inside that row
does, so it **sleeps through a keystroke** in any of its rows. Each row watches its own field and
wakes on its own.

That is what makes the container worth watching too:

```tsx
import { Field, type FieldNode, type Row } from "@ramonda/form";

/** One row, watching its own field — the same shape as `TextField` above. */
declare class Line extends Component<{ item: Row<Contact> }> {}

class Rows extends Component<{ of: FieldNode<Contact[]> }> {
  f = this.use(Field<Contact[]>, () => ({ of: this.props.of }));

  render() {
    return <div>{list(this.f.rows, (item) => <Line key={item.id} item={item} />)}</div>;
  }
}
```

It wakes when a row is added, removed or moved, and not otherwise. Measured at 300 rows, one
keystroke: **45 ms and every row rebuilt** with no per-field subscription at all, **1.9 ms and one
row** once each row watched its own field, **0.6 ms** once the container watched the array as well —
because then the three hundred list items are never diffed.

`error` is the one that reads two things: a message is held back until the field has been touched, so
it wakes on a blur as well as on a message. Nothing is lost by not reading a member — the first render
that does read it subscribes from then on.

### The owner cannot opt out

The component that owns the form re-renders on **every** change, and not because of anything it
reads: `@state` on a hook holds the owning component's rebuild from the moment it is created. So keep
that component thin — hand the fields out and let it build a handful of vnodes whose props have not
changed. The diff stops there.

## A button that watches the form

`isValid`, `isSubmitting` and `submitCount` belong to the form rather than to any field, and reading
one in the owner's render is what ties the owner to every keystroke. `FormState` is the hook for them,
and it takes **no props** — the form publishes itself on the context, so this works at any depth,
through layouts that know nothing about forms:

```tsx
import { FormState } from "@ramonda/form";

class SaveButton extends Component {
  private form = this.use(FormState);

  render() {
    return (
      <button disabled={!this.form.isValid || this.form.isSubmitting}>
        {this.form.isSubmitting ? "Saving…" : "Save"}
      </button>
    );
  }
}
```

**It wakes on an answer that MOVED, not on an event.** A form that was invalid before a keystroke and
invalid after it has not changed its answer, so the button sleeps through the typing and wakes the
moment validity flips or a submit starts or ends. `isDirty` is the expensive one — a comparison of the
whole value against the baseline — and the form computes it only while something reads it.

Two forms nested behave the way you would want without saying anything: the button watches the nearest
form above it.

**Two forms side by side are two components**, and that is the only way to write them: a component
publishes the form context once, so a second `Form` on the same component throws
([`RMD056`](/reference/diagnostics/rmd056)) rather
than quietly handing every button below it the second form. Give each form the subtree it belongs to —
a component that renders `this.props.children` is enough — and a plain `this.use(FormState)` inside
each finds its own with nothing passed down. See
[Context](/composition/context#two-of-one-context-a-scope-per-subtree).

With no form above it at all, every fact reads as its default and core reports
[`RMD003`](/reference/diagnostics/rmd003) when the component mounts.

## The recipe for a big form

Put together, the three pieces mean the owner of the form reads **nothing** — and then its render can
be cached:

```tsx
/** The two from above: one watches an array, the other watches the form. */
declare class Rows extends Component<{ of: FieldNode<Contact[]> }> {}
declare class SaveButton extends Component {}

class Page extends Component {
  private form = this.use(Form<typeof schema>, () => ({ schema, defaultValues, onSubmit }));

  @compute get body() {
    return (
      <form onsubmit={this.form.submit}>
        <Rows of={this.form.fields.contacts} />
        <SaveButton />
      </form>
    );
  }

  render() {
    return this.body;
  }
}
```

`this.form.fields.contacts` is navigation through a proxy, not a read, so the `@compute` depends on
nothing and is **built once for the life of the form**. The owner is still woken on every change — it
cannot opt out — but it hands the diff back the same tree, and the diff stops immediately.

Measured at 300 rows, one keystroke: **45 ms** with no per-field subscription, **1.9 ms** with each row
watching its own field, **0.65 ms** with the container watching the array, **0.48 ms** with the body
cached. The last step is small here because the owner's render is two vnodes; it is worth much more when
a render builds a lot inline — 4.35 ms against 0.19 ms for one building 300 children.

A `@compute` body pays off only while it reads nothing that moves. Any field read inside it — a
`disabled={!this.form.isValid}` written there instead of in a button — puts the form's counter in its
dependencies, and it is rebuilt on every keystroke again.

## Labels, ids and accessibility

`name` is what a form posts under, and what a `<label for>` cannot use. The simplest correct thing is
to wrap the input:

```tsx
const email = f.email.$;

<label>
  Email
  <input
    name={email.name}
    value={email.inputValue}
    oninput={email.oninput}
    onblur={email.onblur}
    aria-invalid={email.invalid}
  />
</label>;
```

A wrapping label needs no `id` at all. If your design cannot wrap, add an `id` and a
`htmlFor` yourself — the form does not generate them, because an id has to be unique across the
whole page and only you know what else is on it.

`aria-invalid={x.invalid}` follows the same rule the visible message does: it is `true` only once the
message is ready to be seen. To connect the message itself, add
`aria-describedby` pointing at your own element.

## Next

- [Validation](/forms/validation) — the errors a field shows, and the moment they appear.
- [Array fields](/forms/arrays) — the same tree where a row can be inserted or removed.
- [Refs](/concepts/refs) — for reaching the element itself.
