---
"@ramonda/form": minor
---

`FormState` — a component that watches the form rather than a field

```tsx
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

**No props, at any depth.** The form publishes itself on the context — a provider mounted from inside
the hook, which is how `Router` carries its route state, and the only route available since
`GLOBAL_RUNTIME` is internal to `@ramonda/core`. Two forms nested behave the way you would want without
saying anything, because contexts are prototype-chained per component: a button watches the nearest form
above it. With no form above at all, every fact reads as its default and core reports RMD003 when the
component mounts, so this package writes no diagnostic of its own.

**It wakes on an answer that MOVED, not on an event.** A form invalid before a keystroke and invalid
after it has not changed its answer, so the button sleeps through the typing and wakes the moment
validity flips or a submit starts or ends. The form keeps the facts as last published and compares —
which is precisely what a form-wide counter cannot do. `isDirty` is the expensive one, a comparison of
the whole value against the baseline, and it is computed only while something reads it; that is
asserted.

`isValid` · `isDirty` · `isSubmitting` · `submitCount` · `formErrors` · `submit(event?)` · `reset()`.
`submit` is here so a button outside the `<form>` element can submit it without a handler passed down.

### Which completes the recipe for a big form

With the fields watched by their own components and the form-level facts by this one, the owner reads
**nothing** — so its render can be a `@compute` that is built once for the life of the form:

```tsx
@compute get body() {
  return (
    <form onSubmit={this.form.submit}>
      <Rows of={this.form.fields.contacts} />
      <SaveButton />
    </form>
  );
}

render() {
  return this.body;
}
```

Reaching `this.form.fields.contacts` is navigation through a proxy, not a read, so the compute depends
on nothing. The owner is still woken on every change — `@state` on a hook holds its rebuild and it
cannot opt out — but it hands the diff back the same tree and the diff stops there.

Measured at 300 rows, one keystroke: **45 ms** with no per-field subscription, **1.9 ms** with each row
watching its own field, **0.65 ms** with the container watching the array, **0.48 ms** with the body
cached. The last step is small only because that owner's render is two vnodes — for a render building
300 children inline it is 4.35 ms against 0.19 ms.
