---
"@ramonda/form": minor
---

The FORMS tab names a form from its `use()` metadata

```tsx
private signup = this.use(Form<typeof schema>, { schema, defaultValues, onSubmit }, { label: "Sign Up" });
```

The tab and the component tree then call it **`Form (Sign Up)`** instead of `Form 2`. Which mattered as
soon as the tab started grouping: a header reading `Form 2` frames a form's broken fields correctly and
still does not say which form it is, and the number is only the order it mounted in.

Read off the instance under `Symbol.for("ramonda.hook.meta")` — a documented key, no import, and no
payload on the announce event. That event fires once at mount while every other field in this tab is
read live, and a name taken from it would have been one frozen field among current ones.

Unlabelled forms keep the number, so a page with one form is unchanged.
