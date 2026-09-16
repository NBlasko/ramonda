---
"@ramonda/css": minor
---

Completion after a `:` in a nested rule, and after a property's `:` where nothing is typed yet.

```
&:      hover, focus, first-child, …   (was: 828 property names)
&::     before, after, …               (was: 828 property names)
position:      static, relative, …     (was: 828 property names)
```

Asked for while using it. The pseudo-classes come from `SELECTORS`, the same table `unknown-selector`
reads, so what is offered and what is accepted cannot drift — asserted, not assumed.

A prelude is told from a declaration by the `&` at the head of the run, which `CssBlockShape`'s
`` `&${string}` `` key makes a fact. `&:hover { color: ` is still a value, because the `{` bounds the
run before the `&` is reached.

The empty-value case was a second fault found beside it: the caret after `position: ` mapped one
character short of the value, landing in the key position of the next declaration. So `position: stat`
worked and `position: ` did not — the answer arrived only once you had typed enough not to need it.
