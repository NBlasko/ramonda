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

class Signup extends Component {
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
| `submit(event?)` | Hand it straight to `onSubmit={…}`; it calls `preventDefault` for you. |
| `reset(values?)` | Back to the defaults, or to the values you pass. |
| `setError(path, message)` | A message from somewhere the schema cannot see — usually the server. |

## Where to go next

- [Fields](/forms/fields) — the tree, `$`, `bind`, and nested objects
- [Validation](/forms/validation) — schemas, when messages appear, cross-field rules
- [Array fields](/forms/arrays) — rows that survive a splice
- [On the server](/forms/server) — what a form does during SSR, and what it does on hydration
