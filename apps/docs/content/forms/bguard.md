---
title: The bguard submodule
description: HTML validation attributes derived from the schema, and a check that every cross-field rule points at a real field.
section: Forms
order: 99.5
---

# The bguard submodule

The form needs nothing bguard-specific — [Standard Schema](/forms/validation) is the whole contract,
which is why bguard, zod, valibot and arktype all work with no adapter.

`@ramonda/form/bguard` is for two things that are not in that contract, because they are not about
validating a value:

- **the constraints, as HTML attributes.** The schema already says `minLength(3)`. Writing
  `minlength={3}` next to it is the same fact twice, and the two drift.
- **whether a cross-field rule points at a real field.** `ctx.ref('pasword')` returns `undefined`
  for ever and reports nothing, so the rule quietly passes.

bguard is an **optional peer dependency**. Importing `@ramonda/form` never reaches this module, so a
form over zod pulls in nothing from here.

```sh
pnpm add bguard
```

## HTML attributes from the schema

```tsx
import { htmlConstraints } from "@ramonda/form/bguard";

// Built once, outside render.
const html = htmlConstraints(signupSchema);

class SignupForm extends Component {
  private form = this.use(Form<typeof signupSchema>, () => ({ schema: signupSchema, defaultValues, onSubmit }));

  render() {
    const f = this.form.fields;

    return (
      <form noValidate onsubmit={this.form.submit}>
        <label>
          Nickname
          <input {...f.nick.$.bind} {...html("nick")} />
        </label>
      </form>
    );
  }
}
```

`html("nick")` returns `{ required: true, minlength: 3, maxlength: 20 }` — read off the schema, so it
cannot disagree with what the validator will actually enforce.

What is derived:

| The schema says | The attribute |
|---|---|
| the property is required | `required` |
| `minLength` / `maxLength` | `minlength` / `maxlength` |
| `regExp` | `pattern` |
| `min` / `max` | `min` / `max` |
| `email` | `type="email"` |
| `validUrl` | `type="url"` |
| `isValidDate` · `isValidTime` · `isValidDateTime` | `type="date"` · `type="time"` · `type="datetime-local"` |

**An exclusive bound is left out.** HTML has no exclusive form, so `minExcluded(0)` produces no
`min`: reporting `0` would let the browser accept a value the schema rejects, and reporting `1` would
reject `0.5`, which it accepts. A constraint that cannot be stated exactly is not stated.

**`uuid` produces nothing** either. It is a real JSON Schema format and no `<input type>` means it;
approximating it with a `pattern` would be inventing a rule the schema did not write.

### Paths, nesting and rows

Paths are the form's own, so a field's `path` goes straight in:

```tsx
<input {...f.address.city.$.bind} {...html("address.city")} />
<input {...row.field.$.bind} {...html(row.field.$.path)} />
```

An array index resolves to the item schema, so every row of a list gets the same constraints — and
an array **item is never `required`**, because the row exists only because the array holds it.

A path the schema has nothing at returns `{}` rather than throwing. A form outlives a schema change,
and an input whose field has gone should render plainly instead of breaking the page.

### Answers are cached, and that matters

The same path returns the **same object** every render. That is not a micro-optimisation:
[RMD020](/reference/diagnostics#rmd020-render-produced-a-different-value-the-second-time) compares a
vnode's attributes key by key, so a freshly built object would be reported for every input on the
page. Build the lookup once, outside `render`.

### `required` and `type` change what the browser does

They are real HTML validation. Without `noValidate`, the browser checks them **before** your
`onSubmit` runs and shows its own bubble instead — so the schema's messages never appear. Decide
which validation the reader sees:

- **`<form noValidate>`** keeps the schema's messages, and the attributes still earn their place: a
  screen reader announces a required field, and a mobile keyboard follows `type="email"`.
- **Without it**, the browser answers first. Reasonable if you want native behaviour and treat the
  schema as the server-side truth.

Spread `bind` first and these second, so a `type` derived from the schema wins over the one `bind`
inferred from the value.

## Cross-field rules that point at nothing

```ts
import { unknownRefPaths } from "@ramonda/form/bguard";

test("every cross-field rule points at a real field", () => {
  expect(unknownRefPaths(signupSchema, DEFAULTS)).toEqual([]);
});
```

`ctx.ref('pasword')` yields `undefined` for ever. The comparison against it then quietly succeeds or
quietly fails — whichever the typo happens to produce — and nothing anywhere says so. It is the shape
of bug that survives a review, because the line reads correctly.

A problem names both ends: `{ to: "pasword", from: "confirm" }`.

**A test is the natural home**, because it holds for good rather than only while someone is looking.

**It needs values**, and that is the honest limit. A `custom` is an opaque function, so which paths it
reads can depend on what it was given — the reads are recorded from a real parse rather than derived
from the schema. Pass your `defaultValues`, and pass a filled-in set too if a rule returns early on an
empty value: **a rule that does not run reads nothing, so it cannot be checked.**

Whether the values are valid is not the question. Every issue the parse reports is ignored.

**Array paths resolve.** `ref` splits on dots and then indexes plainly, and a JavaScript array indexes
by string — so `ref("contacts.0.kind")` reaches the first row's `kind`, and `ref("rows.length")` reads
the count, which is what "at least one row" is written as. Both are accepted. A name an array does not
have — `ref("rows.title")` — is still reported, because that is the silent `undefined` this is for.

**One rule is one entry.** A rule inside a list runs once per row, and the problem is the rule rather
than the row it happened to be on, so an array index appears as `*`:

```ts
[{ to: "contacts.*.kynd", from: "contacts[*].value" }]
```

Reported per row, a single typo on a fifty-row list produced fifty entries — measured, and an answer
nobody reads. The cost of collapsing them is small and worth knowing: a constant index written by
hand, `ref("rows.0.id")`, is also shown as `rows.*.id`.

**`ctx.sibling` is checked too.** It resolves to an absolute path, so it flows through the same
recording — which matters because its *string* form is the one the compiler cannot check:

```ts expect-error
ctx.sibling((row: Contact) => row.kynd);  // a compile error
ctx.sibling("kynd");                      // not — and this is what catches it
```

## Validation is always whole-form

Every keystroke runs the whole schema, and that is affordable. Measured on a bguard schema with a
`custom` per field plus one cross-field rule:

| fields | whole-form validation |
|---|---|
| 11 | 3.3 µs |
| 31 | 14.9 µs |
| 101 | 48.3 µs |
| 301 | 154.8 µs |

A three-hundred-field form revalidates in a hundredth of a 60fps frame.

It is also the only thing that is correct. A cross-field rule reads a value the form did not just
change, so validating one field in isolation would leave a stale message under the field that
depends on it — and which fields those are is only knowable by running the rules, since a `custom`
is an opaque function.
