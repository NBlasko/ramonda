---
"@ramonda/form": minor
"create-ramonda": minor
---

`@ramonda/form` — the first release

Forms as a hook: `this.use(Form<typeof schema>, { schema, defaultValues, onSubmit })`. It adds no
element, so the `<form>` tag stays yours — with your class names, your `noValidate`, and the freedom
to put a form inside a `<fieldset>` or a `<tr>` where a wrapper would be invalid HTML.

- **Validation is Standard Schema v1**, so bguard, zod, valibot and arktype all work as they are,
  with no adapter and no dependency from this package on any of them. `defaultValues` and the values
  handed to `onSubmit` are both typed from the schema, and the input and output sides are kept apart
  — a schema that coerces a string to a number is honoured on both.
- **Fields are property access, not string paths** — `f.address.street`. A typo is a compile error,
  and renaming a schema field breaks the render instead of quietly reading `undefined`.
- **The whole field API sits behind one token**: `f.address.street.$.error`. A flat API was tried
  first and `value` collided with an ordinary `contacts: { kind, value }[]`; one collision chance
  instead of eleven, and it measured cheaper on a deep schema.
- **`bind` is everything a control needs** — `name`, `value`, `onInput`, `onBlur`, `aria-invalid`,
  and the right `type` for what the field holds. The handlers are built once per field, so spreading
  it every render re-attaches nothing.
- **Array rows carry a generated id**, per array rather than per form, so a row keeps its element,
  its message and its caret across an insert or a remove — and a server render and its hydration
  agree on every `list()` key.
- **Messages stay hidden until they are ready to be seen**: a field must be blurred, edited, or the
  form submitted. `isValid` always reports the real answer underneath.
- **Server rendering needs nothing wired up.** `name` and `value` reach the HTML, so the page is a
  real form before any JavaScript runs.
- **A failed submit puts the caret in the first invalid field**, first in the order on screen rather
  than the order the validator reported. Without it, pressing the button does nothing visible when
  the messages are below the fold — and for someone using a screen reader, no signal at all. Scoped
  to the form the submit came from, so a page with two forms cannot steal focus into the other; a
  disabled control is skipped; a programmatic `submit()` moves nothing, since your code called it and
  your code decides where the reader looks.
- **`move(from, to)` on an array field** reorders a row and carries its identity with it. `remove`
  then `insert` mints a new id, so the reconciler drops the row's element and builds another, losing
  the caret and the selection — which is exactly what row ids exist to prevent, so the library does
  it rather than every app.

### `@ramonda/form/bguard`

A second entry point for the two things Standard Schema cannot express, because they are not about
validating a value. bguard is an **optional** peer dependency and the main entry never reaches this
module, so a form over zod pulls in nothing from it. It imports no `@ramonda/core` either, so it runs
in a bare Node process with no DOM.

- **`htmlConstraints(schema)`** derives the HTML validation attributes — `required`, `minlength`,
  `maxlength`, `pattern`, `min`, `max`, and `type` from a format. The schema already says
  `minLength(3)`; writing `minlength={3}` beside it is the same fact twice, and the two drift.
  Answers are cached per path, because RMD020 compares attributes key by key and a fresh object would
  be reported for every input on the page. An exclusive bound is left out rather than reported one
  short, and `uuid` produces nothing, since no `<input type>` means it.
- **`unknownRefPaths(schema, values)`** finds a cross-field rule that points at nothing.
  `ctx.ref('pasword')` returns `undefined` for ever and the comparison quietly succeeds or quietly
  fails; it is the shape of bug that survives a review because the line reads correctly. It belongs in
  a test. It needs values because a `custom` is opaque — a rule that does not run reads nothing, so it
  cannot be checked, which is stated rather than hidden. `ctx.sibling` is covered too, which is where
  it earns most: its string form is the one the compiler cannot check. One rule is one entry however
  many rows it ran on, with the index shown as `*` — reported per row, a single typo on a fifty-row
  list produced fifty entries.

`revalidateAll` is **removed** from `FormProps`. It was declared and documented as the escape hatch
for a form big enough that whole-form revalidation would hurt, and it was never read — an option that
did nothing, which is worse than one that is missing. It is gone rather than implemented, because the
case does not exist: measured on a bguard schema with a `custom` per field plus a cross-field rule,
a whole-form pass costs 3.3 µs at 11 fields, 14.9 µs at 31, 48.3 µs at 101 and 154.8 µs at 301 — a
three-hundred-field form revalidates in a hundredth of a 60fps frame.

`pick`-based per-field validation was the original plan for the submodule and is deliberately absent
for the same reason, plus three hazards it carried: `pick` brings the source's object-level assertions
along, so a whole-form rule would run against a partial value and invent an issue; it reaches
top-level keys only; and the dependency graph is discovered by running rules rather than known up
front. Each shows a wrong or stale message, to save ten microseconds.

Documentation: [Forms](https://ramonda.pages.dev/forms).

`create-ramonda` offers it as an add-on, so `npm create ramonda@latest` can scaffold a project with
it already installed.
