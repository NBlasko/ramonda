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

Documentation: [Forms](https://ramonda.pages.dev/forms).

`create-ramonda` offers it as an add-on, so `npm create ramonda@latest` can scaffold a project with
it already installed.
