---
"@ramonda/form": minor
---

`label` names a form in devtools

```tsx
private signup = this.use(Form<typeof schema>, { schema, defaultValues, onSubmit, label: "signup" });
```

The `FORMS` tab and the component tree then call it **`Form (signup)`** instead of `Form 2`. Which
mattered as soon as the tab started grouping: a group header reading `Form 2` frames a form's broken
fields correctly and still does not say which form it is, and the number is the order it mounted in —
the wrong half of what a reader wanted.

Unlabelled forms keep the number, so nothing changes for a page with one form. A blank label is no
label.

**Read live, not carried on the announce event.** A label may be computed in the props callback —
`label: \`order ${self.id}\`` — which re-runs when the signals it reads move. The event that tells the
panel a form exists fires once, at mount, so a name taken from it would be the name that form had when
it appeared while every other field in the tab was current. The panel reads the label through the same
live view it reads values and errors through, and a test moves a signal to prove the name follows.
