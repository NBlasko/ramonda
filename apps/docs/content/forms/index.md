---
title: Forms
description: Typed field paths, validation from any Standard Schema library, and array rows that keep their identity across a splice.
section: Forms
order: 99
---

# Forms

A form is state, validation, and a hundred small decisions about when to show a message. The
state part Ramonda already does. `@ramonda/form` is the rest of it: one hook that holds the
values, runs the schema, decides when a message is ready to be seen, and hands each field
everything an `<input>` needs.

```sh
pnpm add @ramonda/form
```

A new project can take it at scaffold time — `npm create ramonda@latest` offers it as an add-on.

## The whole thing

```tsx
import { Component } from "@ramonda/core";
import { Form } from "@ramonda/form";
import { object, string, email, minLength } from "bguard";

const schema = object({
  email: string().custom(email()),
  password: string().custom(minLength(8)),
});

class SignupForm extends Component {
  private form = this.use(Form<typeof schema>, {
    schema,
    defaultValues: { email: "", password: "" },
    onSubmit: this.save,
  });

  async save(values: { email: string; password: string }) {
    await fetch("/api/signup", { method: "POST", body: JSON.stringify(values) });
  }

  render() {
    const f = this.form.fields;

    return (
      <form onSubmit={this.form.submit}>
        <label>
          Email
          <input {...f.email.$.bind} />
          {f.email.$.error ? <em>{f.email.$.error}</em> : null}
        </label>

        <label>
          Password
          <input type="password" {...f.password.$.bind} />
          {f.password.$.error ? <em>{f.password.$.error}</em> : null}
        </label>

        <button type="submit" disabled={this.form.isSubmitting}>
          Sign up
        </button>
      </form>
    );
  }
}
```

Four things are worth naming in that.

**`Form` is a hook, not a component.** `this.use(Form<typeof schema>, …)` adds no element, so
the `<form>` tag is yours — with your class names, your `noValidate`, your `onSubmit`. It also
means a form can live inside a `<fieldset>`, a `<tr>` or a `<td>`, where an extra wrapper
element would be invalid HTML.

**The schema is the types.** `defaultValues` and `onSubmit` are both typed from it. There is no
second place to describe the shape and no generic to write by hand.

**Fields are property access.** `f.email` is not a string path — it is a real property, so a
typo is a compile error and renaming a schema field breaks the render rather than silently
producing `undefined`. See [Fields](/forms/fields).

**`bind` is everything the input needs.** `name`, `value`, `onInput`, `onBlur`, and the right
`type` for what the field holds. Spread it and stop thinking about it.

## Try it

Everything below is live. Submit it empty to see when messages appear, remove a tag while its
neighbour has an error, and try `taken@example.com` to see a failure that only the server
could know about.

```demo:FormDemo
```

## `Form<typeof schema>` — why the pin

`this.use` infers a hook's props from the props object you pass it. That works everywhere
except one place: an inline callback whose parameter you have not annotated. `onSubmit: (values)
=> …` asks TypeScript to infer `values` from the same object it is currently inferring, and it
gives up and hands you `any`.

Writing `Form<typeof schema>` pins the schema first, so everything else follows from it. It is
the same restriction [`Query`](/query/queries#typing-the-callbacks) documents, for the same
reason.

```tsx
// Pinned: `values` is typed, and a wrong field name is an error.
this.use(Form<typeof schema>, { schema, defaultValues, onSubmit: (values) => … });

// Also fine, no pin needed: the method has its own annotation.
this.use(Form, { schema, defaultValues, onSubmit: this.save });
```

## What the form gives you

| | |
|---|---|
| `fields` | The field tree. [Fields](/forms/fields) |
| `values` | What the fields currently hold. |
| `formErrors` | Messages that belong to no single field. |
| `isValid` | Whether the schema is satisfied right now. |
| `isDirty` | Whether anything has been edited. |
| `isSubmitting` | True while `onSubmit` is in flight. |
| `submitCount` | How many times submit has been attempted. |
| `submit(event?)` | Hand it straight to `onSubmit={…}`; it calls `preventDefault`, and focuses the first invalid field. |
| `reset(values?)` | Back to the defaults, or to the values you pass. |
| `setError(path, message)` | A message from somewhere the schema cannot see — usually the server. |

## Editing a record you had to fetch

An "edit profile" page does not know its values at mount. It asks for them, and they arrive a moment
later. Move `defaultValues` when they land and the form follows:

```tsx
// A module constant, not a literal in the callback — see "one object, not a fresh one" below.
const BLANK = { name: "", email: "" };

class EditProfile extends Component<{ id: string }> {
  private profile = this.use(Query, (self: EditProfile) => ({
    key: ["profile", self.props.id],
    fetch: self.load,
  }));

  private form = this.use(Form<typeof schema>, (self: EditProfile) => ({
    schema,
    defaultValues: self.profile.data ?? BLANK,
    onSubmit: self.save,
  }));

  load() {
    return api.getProfile(this.props.id);
  }

  save(values: Profile) {
    return api.updateProfile(this.props.id, values);
  }
}
```

**A field the user has already typed in keeps what they typed.** Everything else takes the new value.
That is the whole rule, and it is the one that matters — a request coming back must never delete what
somebody is in the middle of writing, and a field nobody has touched has no reason to stay empty.

"Typed in" means edited, not visited: tabbing through a field and leaving it alone does not claim it.
A `reset()` hands every field back, so a form you reset is open to the next set of defaults again.

**Array fields.** Rows merge one by one while the length is unchanged. Once the count differs, the
array goes whole: your rows if you have added, removed or reordered any, the new ones if you have
not. Pairing rows by number across a length change would put one row's text onto another, which is
the failure row identities exist to prevent — see [Array fields](/forms/arrays).

**Use a props callback**, as above. A props object literal is evaluated once, so defaults written
that way can never move — that is the shape in [The whole thing](#the-whole-thing), and it is right
for a form whose defaults are constants.

### One object, not a fresh one

Hand `defaultValues` an object you already have — what the fetch returned, a module constant, a
field. Do not build it in the callback:

```tsx
defaultValues: self.profile.data ?? { name: "", email: "" },   // ✗ a new object per run
defaultValues: self.profile.data ?? BLANK,                     // ✓ one object
```

The callback runs whenever a signal it reads moves — for a form fed by a query, every time the
request settles or the key changes — and the first line builds a fresh object on each of those,
which [RMD022](/reference/diagnostics) reports in development once it has happened four times
running without the contents moving. Holding the object is the fix it names, and it is the right
one here: nothing is rebuilt, so there is nothing to report.

Declaring the prop stable — the other fix, for a hook you own — is deliberately **not** what
`@ramonda/form` does. That comparison is bounded (five levels deep, and anything wider than fifty
items is called different rather than compared), and a form's defaults are routinely past both, so
it would quietly stop helping. The form compares them itself, in full.

That comparison is the whole cost of defaults that did not move: around 2 µs on a ten-field form and
15 µs on a hundred-field one, per render of the owner, and no write and no render follow it.
`values` even stays the same object.

## Where to go next

- [Fields](/forms/fields) — the tree, `$`, `bind`, and nested objects
- [Validation](/forms/validation) — schemas, when messages appear, cross-field rules
- [Array fields](/forms/arrays) — rows that survive a splice
- [On the server](/forms/server) — what a form does during SSR, and what it does on hydration
- [The bguard submodule](/forms/bguard) — HTML attributes from the schema, and a check for typo'd cross-field rules
