# @ramonda/form 🌸

Forms for [Ramonda](https://ramonda.dev): typed field paths, Standard Schema validation,
and rows that keep their identity.

[readme:start]: #

[![npm](https://img.shields.io/npm/v/%40ramonda%2Fform)](https://www.npmjs.com/package/@ramonda/form)
[![license](https://img.shields.io/npm/l/%40ramonda%2Fform)](https://github.com/NBlasko/ramonda/blob/main/LICENSE)

> **Status: `0.x`.** The API changes freely between releases while the design is
> being explored; from `1.0` the interfaces hold. A breaking change ships as a
> **minor** until then — see [Upgrading](https://ramonda.dev/reference/upgrading)
> for what that means for a version range, and the
> [root README](https://github.com/NBlasko/ramonda#readme).

```sh
npm install @ramonda/form
```

Documentation: **[ramonda.dev/forms](https://ramonda.dev/forms)**

[readme:end]: #

## What it looks like

```tsx
import { Component } from "@ramonda/core";
import { Form, type InferOut } from "@ramonda/form";
import { object, string } from "bguard";
import { email } from "bguard/string/email";
import { minLength } from "bguard/string/minLength";

const signupSchema = object({
  email: string().custom(email()),
  password: string().custom(minLength(12)),
  confirm: string().custom((received, ctx) => {
    if (received !== ctx.ref("password")) ctx.addIssue("the same password", received, "u:mismatch");
  }),
});

class Signup extends Component {
  private form = this.use(Form, () => ({
    schema: signupSchema,
    defaultValues: { email: "", password: "", confirm: "" },
    onSubmit: this.save,
  }));

  save(values: InferOut<typeof signupSchema>) {
    return api.signup(values);
  }

  render() {
    const email = this.form.fields.email.$;
    return (
      <form onsubmit={this.form.submit}>
        <input {...email.bind} />
        {email.error && <span>{email.error}</span>}
        <button disabled={this.form.isSubmitting}>Sign up</button>
      </form>
    );
  }
}
```

## The four decisions behind it

**Validation is Standard Schema, so there is no adapter to write.** bguard implements it, and
so do zod, valibot and arktype. The cross-field rule above lands on `confirm` rather than at
the root, because `ctx.ref` reads a sibling from within the field's own context.

**A field path is property access, not a string.** `fields.address.street` is checked by
TypeScript natively: renaming `street` in the schema breaks the render rather than quietly
reading `undefined`, and the compiler does it with the machinery it already has — no recursive
type walking a string apart, so no depth limit and no language server slowing down as a schema
grows.

**The field API lives behind `$`.** Navigation owns the property names, so the API cannot
have any of its own. A flat API was written first and `value` collided with an ordinary
`contacts: { kind, value }[]`. One reserved token costs one collision instead of eleven, and
it keeps the API as an object you can name: `const email = form.fields.email.$`.

**A row's identity is not its index.** Array fields hand out `rows` with a generated `id`
that survives insert, remove and reorder, so the
reconciler keeps each row's DOM node and its focus. `move(from, to)` is a method for that
reason: `remove` then `insert` mints a new id, and the row loses its element and whatever the
browser was holding in it. A splice drops what was recorded against
the indexes it moved and re-validates, so a message ends up on the row it is about rather
than on whatever slid into its place.

## What re-renders

One `@state` counter on the hook, so a keystroke re-renders the component that owns the
form — the framework's model, and what `Mutation` does with its own `version`. A form big
enough for that to matter is split the way any other page is: a fieldset in its own
component re-renders alone.

## When a message appears

A field validates on change by default, and its message is held back until the field has
been edited or blurred — so live feedback starts with the first keystroke in a field and
never before it. A submit reveals everything, including on fields nobody visited.
`validateOn: "blur"` and `"submit"` move the first check later; a field that is already
showing a message always re-answers on change.

## A failed submit moves the caret

The first invalid field takes focus — first in the order on screen, not the order the
validator reported. Without it, pressing the button does nothing visible when the messages
are below the fold, and for someone using a screen reader there is no signal at all.

It stays inside the form the submit came from, skips a disabled control, and a programmatic
`form.submit()` moves nothing: your code called it, so your code decides where the reader
looks.

## `@ramonda/form/bguard`

An optional submodule for the two things Standard Schema cannot express, because neither is
about validating a value. bguard is an optional peer dependency and the main entry never
reaches this module, so a form over zod pulls in nothing from it.

- **`htmlConstraints(schema)`** derives `required`, `minlength`, `maxlength`, `pattern`,
  `min`, `max` and `type` from the schema. It already says `minLength(3)`; writing
  `minlength={3}` beside it is the same fact twice, and the two drift.
- **`unknownRefPaths(schema, values)`** finds a cross-field rule pointing at nothing.
  `ctx.ref('pasword')` returns `undefined` for ever and the comparison quietly succeeds or
  quietly fails. It belongs in a test.

**Per-field validation via `pick` is deliberately not here.** It was the original plan, and it
was measured first: on a bguard schema with a `custom` per field plus one cross-field rule, a
whole-form pass costs 3.3 µs at 11 fields, 14.9 µs at 31, 48.3 µs at 101 and 154.8 µs at 301.
A three-hundred-field form revalidates in a hundredth of a 60fps frame, so there is no problem
to solve — and the fast path carried three ways to show a wrong or stale message.

## In the devtools

The panel shows a form's values, messages, touched fields and flags under **Holds**, through
core's `INSPECT` symbol. Without it the row reads `{ version: n }` and props that never change,
because a form's values are plain fields rather than `@state` — see "What re-renders".

## License

[MIT](../../LICENSE) © Nikola Blagojević
