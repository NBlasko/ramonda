# @ramonda/form

Forms for Ramonda: typed field paths, Standard Schema validation, and rows that keep their
identity.

> **Working, and not published yet.** Values, validation, submit and array fields all run,
> with 38 tests behind them. The package stays `private` until it has documentation pages,
> a bundle budget and a `@ramonda/form/bguard` submodule.

## What it looks like

```tsx
import { Component } from "@ramonda/core";
import { Form } from "@ramonda/form";
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
  private form = this.use(Form, {
    schema: signupSchema,
    defaultValues: { email: "", password: "", confirm: "" },
    onSubmit: this.save,
  });

  save(values: InferType<typeof signupSchema>) {
    return api.signup(values);
  }

  render() {
    const email = this.form.fields.email.$;
    return (
      <form onSubmit={this.form.submit}>
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
TypeScript natively — no recursive `Path<T>`, no depth limit, and no slow language server,
which is the tax React Hook Form pays for `register("address.street")`.

**The field API lives behind `$`.** Navigation owns the property names, so the API cannot
have any of its own. A flat API was written first and `value` collided with an ordinary
`contacts: { kind, value }[]`. One reserved token costs one collision instead of eleven, and
it keeps the API as an object you can name: `const email = form.fields.email.$`.

**A row's identity is not its index.** Array fields hand out `rows` with a generated `id`
that survives insert, remove and reorder, for `list({ each, key: (row) => row.id })`, so the
reconciler keeps each row's DOM node and its focus. A splice drops what was recorded against
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

## What is left

Documentation pages and a bundle budget, then publishing. And a `@ramonda/form/bguard`
submodule for what Standard Schema cannot express: `pick` for O(field) validation instead
of O(form), and `toJSONSchema` for HTML validation attributes derived from the schema.
