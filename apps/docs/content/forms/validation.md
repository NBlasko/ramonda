---
title: Validation
description: Any Standard Schema library, when a message is ready to be seen, cross-field rules, and errors that only the server knows.
section: Forms
order: 99.2
---

# Validation

The form takes a **Standard Schema**. That is an interface, not a library — so bguard, zod,
valibot and arktype all work as they are, with no adapter and no dependency from this package
on any of them.

```tsx
import { object, string, email, minLength } from "bguard";

const schema = object({
  email: string().custom(email()),
  password: string().custom(minLength(8)),
});
```

```tsx
// zod, and the form code around it does not change
import { z } from "zod";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
```

Whatever you pass, `defaultValues` and the `values` handed to `onSubmit` are typed from it.

## Input and output are not the same type

A schema often *changes* what goes through it: a string becomes a number, an absent field
becomes a default, a date string becomes a `Date`. So the form distinguishes the two sides.

- **`defaultValues`** is the input side — what the fields hold while being edited.
- **`onSubmit(values)`** receives the output side — coerced, defaulted, and only ever called
  when the schema is satisfied.

Which is why `onSubmit` never has to re-check anything or narrow a type. If it ran, the values
are valid.

## When a message appears

A form that is red before it has been filled in is telling someone off for not having typed
yet. So the answer and the *display* of the answer are two different things.

Validation runs continuously — `isValid` is always the real answer. A field's `error` is held
back until one of these is true:

- the field has been **blurred**, or
- the field has been **edited**, or
- a **submit has been attempted** — which reveals messages on every field, including the ones
  nobody visited.

That is the default. `validateOn` moves when a field validates for the *first* time:

```tsx
this.use(Form<typeof schema>, { schema, defaultValues, onSubmit, validateOn: "blur" });
```

| | |
|---|---|
| `"change"` | As soon as it is edited. The default. |
| `"blur"` | When it loses focus. |
| `"submit"` | Only when submit is attempted. |

Once a field *has* an error, it revalidates on every change regardless — so a message
disappears the moment the value is fixed, rather than making someone tab away to find out.

## Whole-form and per-field

`error` is the first message for that field; `errors` is all of them.

```tsx
{f.email.$.error ? <em>{f.email.$.error}</em> : null}

<ul>{f.password.$.errors.map((message) => <li>{message}</li>)}</ul>
```

An issue whose path is empty belongs to no field. Those arrive as `formErrors`:

```tsx
{this.form.formErrors.length > 0 ? <p role="alert">{this.form.formErrors.join(", ")}</p> : null}
```

## Cross-field rules

"The passwords do not match" is a rule about two fields that has to appear under one of them.

The form re-runs the **whole schema** on every change, which is what makes this work: edit
`password` and the rule on `confirm` is asked again, so its message updates even though
`confirm` itself did not move.

In bguard the rule reads the other field through the context, and lands where it ran:

```ts
import type { InferType } from "bguard";
import type { ExceptionContext } from "bguard/core";

type Signup = InferType<typeof schema>;

const schema = object({
  password: string().custom(minLength(8)),
  confirm: string().custom((received: string, ctx: ExceptionContext) => {
    // A callback rather than a string: `root.pasword` would not compile, and the result comes
    // back typed instead of `unknown`.
    if (received !== ctx.ref((root: Signup) => root.password)) {
      ctx.addIssue("the same password", received, "u:mismatch");
    }
  }),
});
```

`addIssue` takes what was **expected**, what was **received**, and a message key — the key is what
a translation maps, and it is what to branch on rather than the message.

The message appears under `confirm`, which is the field the reader has to change. In zod the
equivalent is `.refine(…, { path: ["confirm"] })` — the same outcome, with the path written out
by hand.

**There is no option to narrow it**, and that was measured rather than assumed. On a bguard schema
with a `custom` per field plus one cross-field rule, a whole-form pass costs 3.3 µs at 11 fields,
14.9 µs at 31, 48.3 µs at 101 and 154.8 µs at 301 — a three-hundred-field form revalidates in a
hundredth of a 60fps frame.

A field-local pass could not do better anyway: a rule that reads another field is invisible to it,
so narrowing would trade a correct message for microseconds.

## A schema that changes

Sometimes the rules depend on something: a business account needs a tax number and a personal one
does not, a country decides what a postcode looks like, an "advanced" toggle turns extra checks on.

**Hold the schema in a `@compute`.** It is a value like any other, and the props callback is cached
on the signals it reads — so a compute means the schema is rebuilt when what it depends on moves,
and not otherwise:

```tsx
class Signup extends Component {
  @state accountType: "personal" | "business" = "personal";

  @compute get schema(): StandardSchemaV1<Signup, Signup> {
    return this.accountType === "business" ? businessSchema : personalSchema;
  }

  private form = this.use(Form, (self: Signup) => ({
    schema: self.schema,
    defaultValues: BLANK,
    onSubmit: self.save,
  }));

  chooseBusiness(): void {
    this.accountType = "business";
  }
}
```

Two module constants here, which is the cheapest form. When the schema has to be *built* from the
value — a country's postcode rule — build it in the compute; it runs when `country` moves and not
on every render.

**Do not build it in the props callback.** `schema: makeSchema(self.country)` builds a new schema
object every time the callback runs, and a schema is usually the most expensive thing in the bag to
construct.

**A new schema applies from the next validation, not on arrival.** The form validates on the events
you asked for, and a schema changing is not one of them — so what is on screen is what the previous
schema said. Switch to a stricter schema and the form still reads valid until the next input or
submit.

That is usually what you want: the schema changed because the reader picked something, and putting
fresh errors on fields they have not reached yet is what `validateOn: "submit"` exists to avoid.

**Two things happen in order, and the order matters if you validate by hand.** Writing the state
schedules a render; the props callback runs as part of it. So a `submit()` in the same handler runs
*before* the form has the new schema, and validates against the old one:

```tsx
// ✗ submits against the schema it is replacing
switchToBusiness(): void {
  this.accountType = "business";
  this.form.submit();
}
```

```tsx
// ✓ the state change is all it takes — the next submit uses the new rules
switchToBusiness(): void {
  this.accountType = "business";
}
```

If a toggle really has to show its effect immediately, put the validation after the commit with
[`@updated`](/concepts/lifecycle), which runs once the render has landed.

## Async schemas

A Standard Schema may return a promise, and the form stays synchronous when the schema is —
nothing is deferred, no microtask is introduced, and a form with a synchronous schema behaves
exactly as if async validation did not exist.

When a schema *is* async, the form keeps the answers in order: a slow validation that finishes
after a newer one has already answered is dropped rather than overwriting it.

## Errors the schema cannot know

"That address is already registered" lives on the server. `setError` puts one on a field:

```tsx
async save(values: Signup) {
  const answer = await register(values);
  if (!answer.ok) this.form.setError("email", "that address is already registered");
}
```

The path is a string here, because the message often comes back from an API that names fields
as strings. It is cleared by the next validation of that field — which is what you want: the
message goes away as soon as the reader changes the thing it is about.

If `onSubmit` throws instead of handling its own failure, the form reports
[RMF003](/reference/diagnostics#rmf003-onsubmit-threw) in development and leaves `isSubmitting`
behind it. The form cannot know whether a network error should become a message, a retry or a
redirect, so it does not guess.

## Submitting

```tsx
<form onSubmit={this.form.submit}>
```

`submit` calls `preventDefault`, marks every field so held-back messages appear, validates, and
calls `onSubmit` only if the schema is satisfied. `isSubmitting` is true while an async handler
is in flight, and `submitCount` counts attempts — including the ones that failed validation,
which is what you want for "why is this button not doing anything".

### A failed submit moves the caret

When validation fails, the **first invalid field takes focus** — first in the order on screen, not
the order the validator happened to report.

Without it a submit does nothing visible when the messages are below the fold: the reader presses the
button again, and again. For someone using a screen reader there is no signal at all, which makes
this accessibility rather than polish.

Three things follow from how it is scoped:

- **It stays inside the form the submit came from**, so a page with two forms cannot pull focus into
  the other one.
- **A disabled control is skipped**, because `focus()` on one silently does nothing and would leave
  the form looking as inert as before.
- **A programmatic `form.submit()` moves nothing.** No event, no element — and the right boundary
  anyway: your code called it, so your code decides where the reader should be looking.
