---
"@ramonda/core": minor
---

A hook's `label` names it in devtools: `Form (Sign Up)`

The component tree names a hook by its class, and a class name is shared by every instance — so two
`this.use(Form, …)` in one component are two nodes both called `Form`, and nothing on screen says which
is the signup. A hook cannot answer this itself: `this.constructor.name` is `Form` for all of them, and
`createContext` solves the same problem by renaming its classes, which cannot work here because the
options arrive per `use()`.

So `label` is a reserved hook option. A hook opts in by declaring `label?: string` in its own props, and
the inspector shows the class **and** the label:

```tsx
private signup = this.use(Form<typeof schema>, { schema, defaultValues, onSubmit, label: "signup" });
// the tree shows: Form (signup)
```

**Added to the name, not substituted for it**, and that is the decision rather than the mechanism. The
class says what the node is — the first thing a reader needs, and the one thing a label cannot recover.
The label says which one it is, which the class cannot give. The first version replaced the class and
read worse: a tree of `signup` and `login` no longer says either of them is a form.

A label that is blank, that is not a string, or that only repeats the class is ignored, so a hook with
other plans for the word keeps them and nothing earns a bare pair of brackets.

Cosmetic and development-only. Nothing reads it but the inspector.
