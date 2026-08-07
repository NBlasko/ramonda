---
"@ramonda/core": minor
---

`use()` takes a third argument: metadata about the hook

```tsx
private signup = this.use(Form<typeof schema>, { schema, defaultValues, onSubmit }, { label: "Sign Up" });
```

Devtools then calls that hook **`Form (Sign Up)`** — its class plus its label. The class says what the
node is, which a label cannot recover; the label says which one it is, which the class cannot give,
because `this.constructor.name` is `Form` for every form on the page and two `this.use(Form, …)` in one
component are otherwise two nodes with one name.

**Why a third argument and not a prop.** A hook's props belong to whoever wrote the hook. A framework
that reserved a word in there would collide with a real one eventually — and on a form it collides
immediately, since a form is full of labels and `label` reads as the visible text of a field. So this is
metadata *about* the hook rather than input *to* it, and the hook never sees it. The first attempt at
this did reserve the prop, and that is why it was reverted rather than shipped.

A propless hook takes the placeholder: `this.use(Poll, undefined, { label: "prices" })`. Deliberate — an
overload taking metadata in the props position would be ambiguous, because `{ label: "…" }` is a
perfectly good props bag for some hook somewhere.

The shape is published as `HookMeta`. An inline `{ label: "Sign Up" }` needs nothing imported, since the
argument is structural — the name is there for a helper that builds one, or a wrapper that passes one
along.

The metadata is parked on the instance under `Symbol.for("ramonda.hook.meta")` and read from there by
core's own inspector and by `@ramonda/form`'s panel — a documented key rather than an import, so neither
package depends on the other to pass a name along. The same contract shape as the diagnostics sink.

Development-only. A production build stores none of it, and a label that is blank, is not a string, or
only repeats the class is ignored.

A hook that calls `Object.freeze(this)` keeps working and keeps its class name in the panel. Such a
hook works everywhere else in this package, and `Object.defineProperty` on a frozen object throws —
from a field initializer, before the component exists, and **only in development**, since production
never stores the metadata. A cosmetic label is what gives way.
