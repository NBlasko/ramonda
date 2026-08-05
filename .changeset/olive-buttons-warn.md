---
"@ramonda/core": minor
---

A hook's props callback knows what its parameter is

```tsx
private user = this.use(Query, (self) => ({ key: ["user", self.id], fetch: self.load }));
```

`self` is now typed as the class the `use()` is written in, so a name that is not there is a compile
error that says which:

```
Property 'load' does not exist on type 'Panel'.
```

Before, the parameter was `never` and had to be annotated — `(self: Panel)` — to be usable at all.
That worked, and left a hole: `never` accepts any function, so a callback written once and shared
compiled against a class it did not fit, and failed at runtime instead. Now the annotation is
checked, which makes a shared callback worth annotating rather than necessary to annotate.

Existing code is unaffected: every annotation that was right stays right, and `() => ({ … })` using
`this` never used the parameter. Verified against every package, playground and docs example in the
repository.
